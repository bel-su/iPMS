import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/qc';
import type { ImportCommitDto, ImportTarget, TemplateCategory, TemplateImportPreview } from '@ipms/contracts';
import { parseWorkbook } from './excel/parse.js';
import type { CreatedDraft, TemplateService } from './template.service.js';

@Injectable()
export class TemplateImportService {
  constructor(private readonly prisma: PrismaClient, private readonly templates: TemplateService) {}

  async preview(buffer: Buffer): Promise<TemplateImportPreview> {
    const parsed = await parseWorkbook(buffer);
    if (parsed.errors.length > 0 || !parsed.metadata || !parsed.document) {
      return { metadata: parsed.metadata, target: null, warnings: [], errors: parsed.errors, document: null, summary: null };
    }
    const { metadata, document } = parsed;
    const existing = await this.prisma.checklistTemplate.findUnique({
      where: { code: metadata.code }, include: { versions: { select: { version: true, status: true, revision: true } } },
    });
    const warnings: string[] = [];
    let target: ImportTarget = { kind: 'NEW' };
    if (existing) {
      const draft = existing.versions.find((version) => version.status === 'DRAFT');
      const latest = Math.max(0, ...existing.versions.map((version) => version.version));
      target = {
        kind: 'EXISTING', templateId: existing.id, name: existing.name, category: existing.category as TemplateCategory,
        replacesDraft: draft ? { version: draft.version, revision: draft.revision } : null,
        nextVersion: draft ? draft.version : latest + 1,
      };
      if (existing.name !== metadata.name) {
        warnings.push(`The file names this template "${metadata.name}", but it is called "${existing.name}". An import never renames a template; rename it on the template page.`);
      }
      if (existing.category !== metadata.category) {
        warnings.push(`The file's category (${metadata.category}) differs from the template's (${existing.category}). An import never changes the category.`);
      }
      if (draft) warnings.push(`This replaces the current v${draft.version} draft.`);
    }
    const items = document.sections.flatMap((section) => section.items);
    return {
      metadata, target, warnings, errors: [], document,
      summary: {
        sections: document.sections.length, items: items.length,
        critical: items.filter((item) => item.severity === 'CRITICAL').length,
        withPhotos: items.filter((item) => item.maxPhotos > 0).length,
      },
    };
  }

  async commit(dto: ImportCommitDto, actorId: string): Promise<CreatedDraft> {
    const existing = await this.prisma.checklistTemplate.findUnique({ where: { code: dto.code } });
    if (!existing) {
      return this.templates.createFromImport({ code: dto.code, name: dto.name, category: dto.category }, dto.document, actorId);
    }
    return this.templates.importIntoDraft(existing.id, dto.document, dto.expectedDraftRevision, actorId);
  }
}
