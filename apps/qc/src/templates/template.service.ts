import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient, TemplateVersion } from '@prisma-clients/qc';
import {
  PublishableDocumentSchema, uuidv7, type CreateTemplateDto, type SaveDraftDto, type TemplateDocument,
  type TemplateMetadata, type UpdateTemplateDto,
} from '@ipms/contracts';
import type { JsonObject } from '@ipms/persistence';
import { recordAudit } from './audit.js';
import { TREE_INCLUDE, clearTree, isUniqueViolation, toDocument, writeTree, type Tx } from './document.js';

export interface DraftSummary { id: string; version: number; revision: number; source: string; updatedAt: Date }
export interface CreatedDraft { templateId: string; draft: DraftSummary }

const STALE_SAVE = 'Someone else saved this draft. Reload to see their changes.';
const STALE_IMPORT = "This template's draft changed since the preview. Preview the file again.";

const summary = (version: TemplateVersion): DraftSummary => ({
  id: version.id, version: version.version, revision: version.revision, source: version.source, updatedAt: version.updatedAt,
});

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(dto: CreateTemplateDto, actorId: string): Promise<CreatedDraft> {
    return this.createTemplate(dto, { sections: [] }, 'WEB', actorId);
  }

  async createFromImport(meta: TemplateMetadata, doc: TemplateDocument, actorId: string): Promise<CreatedDraft> {
    return this.createTemplate(meta, doc, 'EXCEL_IMPORT', actorId);
  }

  async rename(id: string, dto: UpdateTemplateDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTemplate(tx, id);
      const template = await this.requireTemplate(tx, id);
      const updated = await tx.checklistTemplate.update({
        where: { id },
        data: { ...(dto.name === undefined ? {} : { name: dto.name }), ...(dto.category === undefined ? {} : { category: dto.category }) },
      });
      const previousState: JsonObject = {};
      const newState: JsonObject = {};
      if (dto.name !== undefined) { previousState['name'] = template.name; newState['name'] = updated.name; }
      if (dto.category !== undefined) { previousState['category'] = template.category; newState['category'] = updated.category; }
      await recordAudit(tx, { actorId, action: 'qc_template.updated', objectId: id, previousState, newState });
      return updated;
    });
  }

  async startDraft(id: string, actorId: string): Promise<CreatedDraft> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTemplate(tx, id);
        await this.requireTemplate(tx, id);
        const existing = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'DRAFT' } });
        if (existing) throw new ConflictException(`A draft (v${existing.version}) already exists`);
        const current = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'PUBLISHED' }, include: TREE_INCLUDE });
        if (!current) throw new ConflictException('This template has nothing published to copy');
        const draft = await this.createDraftVersion(tx, id, 'WEB', actorId);
        await writeTree(tx, draft.id, toDocument(current));
        return { templateId: id, draft: summary(draft) };
      });
    } catch (error) {
      // The loser of two concurrent starts hits the one-draft-per-template index instead of the pre-check.
      if (isUniqueViolation(error)) throw new ConflictException('A draft already exists');
      throw error;
    }
  }

  async saveDraft(id: string, dto: SaveDraftDto): Promise<DraftSummary> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTemplate(tx, id);
        const draft = await this.requireDraft(tx, id);
        const saved = await this.replaceDraftTree(tx, draft.id, dto.revision, dto.document, {}, STALE_SAVE);
        return summary(saved);
      });
    } catch (error) {
      // Two saves that both passed the revision check collide on the tree's unique numbers.
      if (isUniqueViolation(error)) throw new ConflictException(STALE_SAVE);
      throw error;
    }
  }

  async importIntoDraft(id: string, doc: TemplateDocument, expectedRevision: number | undefined, actorId: string): Promise<CreatedDraft> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTemplate(tx, id);
        await this.requireTemplate(tx, id);
        const existing = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'DRAFT' } });
        let draft: TemplateVersion;
        if (existing) {
          if (expectedRevision !== existing.revision) throw new ConflictException(STALE_IMPORT);
          draft = await this.replaceDraftTree(tx, existing.id, existing.revision, doc, { source: 'EXCEL_IMPORT' }, STALE_IMPORT);
        } else {
          draft = await this.createDraftVersion(tx, id, 'EXCEL_IMPORT', actorId);
          await writeTree(tx, draft.id, doc);
        }
        await recordAudit(tx, {
          actorId, action: 'qc_template.imported', objectId: id,
          previousState: existing ? { draftVersion: existing.version } : {},
          newState: { draftVersion: draft.version, source: 'EXCEL_IMPORT' },
        });
        return { templateId: id, draft: summary(draft) };
      });
    } catch (error) {
      // The loser of two concurrent imports with no existing draft hits the one-draft-per-template index.
      if (isUniqueViolation(error)) throw new ConflictException(STALE_IMPORT);
      throw error;
    }
  }

  async discardDraft(id: string, actorId: string): Promise<{ templateDeleted: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTemplate(tx, id);
      // Re-read under the lock: a concurrent publish may have just filled currentVersionId.
      const template = await this.requireTemplate(tx, id);
      const draft = await this.requireDraft(tx, id);
      const templateDeleted = template.currentVersionId === null;
      const removed = await tx.templateVersion.deleteMany({ where: { id: draft.id, status: 'DRAFT' } });
      if (removed.count === 0) throw new ConflictException('This template has no draft');
      await recordAudit(tx, { actorId, action: 'qc_template.draft_discarded', objectId: id, previousState: { version: draft.version }, newState: {} });
      if (templateDeleted) await tx.checklistTemplate.delete({ where: { id } });
      return { templateDeleted };
    });
  }

  async publish(id: string, actorId: string): Promise<TemplateVersion> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTemplate(tx, id);
      const template = await this.requireTemplate(tx, id);
      if (template.disabledAt) throw new ConflictException('Enable this template before publishing');
      const draft = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'DRAFT' }, include: TREE_INCLUDE });
      if (!draft) throw new ConflictException('This template has no draft');
      const checked = PublishableDocumentSchema.safeParse(toDocument(draft));
      // Thrown as-is so the exception filter renders field paths as a 422.
      if (!checked.success) throw checked.error;
      const now = new Date();
      const previous = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'PUBLISHED' } });
      if (previous) await tx.templateVersion.update({ where: { id: previous.id }, data: { status: 'RETIRED', retiredAt: now } });
      const published = await tx.templateVersion.update({
        where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: now, publishedBy: actorId },
      });
      await tx.checklistTemplate.update({ where: { id }, data: { currentVersionId: published.id } });
      await recordAudit(tx, {
        actorId, action: 'qc_template.published', objectId: id,
        previousState: { version: previous?.version ?? null }, newState: { version: published.version },
      });
      return published;
    });
  }

  async disable(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTemplate(tx, id);
      const template = await this.requireTemplate(tx, id);
      if (template.disabledAt) throw new ConflictException('This template is already disabled');
      if (!template.currentVersionId) throw new ConflictException('Only a published template can be disabled');
      const updated = await tx.checklistTemplate.update({ where: { id }, data: { disabledAt: new Date() } });
      await recordAudit(tx, { actorId, action: 'qc_template.disabled', objectId: id, previousState: { disabledAt: null }, newState: { disabledAt: updated.disabledAt!.toISOString() } });
      return updated;
    });
  }

  async enable(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTemplate(tx, id);
      const template = await this.requireTemplate(tx, id);
      if (!template.disabledAt) throw new ConflictException('This template is not disabled');
      const updated = await tx.checklistTemplate.update({ where: { id }, data: { disabledAt: null } });
      await recordAudit(tx, { actorId, action: 'qc_template.enabled', objectId: id, previousState: { disabledAt: template.disabledAt.toISOString() }, newState: { disabledAt: null } });
      return updated;
    });
  }

  private async createTemplate(meta: TemplateMetadata, doc: TemplateDocument, source: 'WEB' | 'EXCEL_IMPORT', actorId: string): Promise<CreatedDraft> {
    const duplicate = () => new ConflictException(`A template with code ${meta.code} already exists`);
    if (await this.prisma.checklistTemplate.findUnique({ where: { code: meta.code } })) throw duplicate();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const template = await tx.checklistTemplate.create({
          data: { id: uuidv7(), code: meta.code, name: meta.name, category: meta.category, createdBy: actorId },
        });
        const draft = await this.createDraftVersion(tx, template.id, source, actorId);
        await writeTree(tx, draft.id, doc);
        await recordAudit(tx, source === 'WEB'
          ? { actorId, action: 'qc_template.created', objectId: template.id, previousState: {}, newState: { code: meta.code, name: meta.name, category: meta.category } }
          : { actorId, action: 'qc_template.imported', objectId: template.id, previousState: {}, newState: { draftVersion: draft.version, source } });
        return { templateId: template.id, draft: summary(draft) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicate();
      throw error;
    }
  }

  private async createDraftVersion(tx: Tx, templateId: string, source: 'WEB' | 'EXCEL_IMPORT', actorId: string): Promise<TemplateVersion> {
    const latest = await tx.templateVersion.aggregate({ where: { templateId }, _max: { version: true } });
    return tx.templateVersion.create({
      data: { id: uuidv7(), templateId, version: (latest._max.version ?? 0) + 1, status: 'DRAFT', revision: 1, source, createdBy: actorId },
    });
  }

  /**
   * The conditional update takes the row lock, so a concurrent save at the same
   * revision waits, re-reads the row, and matches nothing.
   */
  private async replaceDraftTree(
    tx: Tx, versionId: string, revision: number, doc: TemplateDocument,
    data: { source?: 'EXCEL_IMPORT' }, staleMessage: string,
  ): Promise<TemplateVersion> {
    const bumped = await tx.templateVersion.updateMany({
      where: { id: versionId, status: 'DRAFT', revision },
      data: { revision: { increment: 1 }, ...data },
    });
    if (bumped.count === 0) throw new ConflictException(staleMessage);
    await clearTree(tx, versionId);
    await writeTree(tx, versionId, doc);
    return tx.templateVersion.findUniqueOrThrow({ where: { id: versionId } });
  }

  // Serializes mutations of one template; the partial unique indexes on templateVersion are the backstop.
  private async lockTemplate(tx: Tx, id: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "checklist_template" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }

  private async requireTemplate(tx: Tx, id: string) {
    const template = await tx.checklistTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Checklist template not found');
    return template;
  }

  private async requireDraft(tx: Tx, id: string): Promise<TemplateVersion> {
    const draft = await tx.templateVersion.findFirst({ where: { templateId: id, status: 'DRAFT' } });
    if (draft) return draft;
    await this.requireTemplate(tx, id);
    throw new ConflictException('This template has no draft');
  }
}
