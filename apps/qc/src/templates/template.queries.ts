import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma-clients/qc';
import type { ListTemplatesQueryDto } from '@ipms/contracts';
import { TREE_INCLUDE } from './document.js';

export interface TemplateListEntry {
  id: string; code: string; name: string; category: string; disabledAt: Date | null;
  current: { version: number; publishedAt: Date | null; publishedBy: string | null; sectionCount: number; itemCount: number; criticalCount: number } | null;
  draft: { version: number; revision: number; updatedAt: Date; source: string } | null;
}

const VERSION_SELECT = {
  id: true, version: true, status: true, revision: true, source: true, createdBy: true,
  createdAt: true, updatedAt: true, publishedAt: true, publishedBy: true, retiredAt: true,
} satisfies Prisma.TemplateVersionSelect;

const TAB_WHERE: Record<ListTemplatesQueryDto['tab'], Prisma.ChecklistTemplateWhereInput> = {
  enabled: { currentVersionId: { not: null }, disabledAt: null },
  draft: { versions: { some: { status: 'DRAFT' } } },
  disabled: { disabledAt: { not: null } },
};

interface CountRow { versionId: string; sections: number; items: number; critical: number }

@Injectable()
export class TemplateQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: ListTemplatesQueryDto): Promise<TemplateListEntry[]> {
    const templates = await this.prisma.checklistTemplate.findMany({
      where: {
        ...TAB_WHERE[query.tab],
        ...(query.category ? { category: query.category } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: 'insensitive' } }, { name: { contains: query.q, mode: 'insensitive' } }] } : {}),
      },
      include: {
        currentVersion: { select: { id: true, version: true, publishedAt: true, publishedBy: true } },
        versions: { where: { status: 'DRAFT' }, select: { version: true, revision: true, updatedAt: true, source: true } },
      },
      orderBy: { code: 'asc' },
    });
    const currentIds = templates.flatMap((t) => (t.currentVersion ? [t.currentVersion.id] : []));
    const counts = new Map((await this.countTrees(currentIds)).map((row) => [row.versionId, row]));
    return templates.map((t) => {
      const count = t.currentVersion ? counts.get(t.currentVersion.id) : undefined;
      const draft = t.versions[0];
      return {
        id: t.id, code: t.code, name: t.name, category: t.category, disabledAt: t.disabledAt,
        current: t.currentVersion ? {
          version: t.currentVersion.version, publishedAt: t.currentVersion.publishedAt, publishedBy: t.currentVersion.publishedBy,
          sectionCount: count?.sections ?? 0, itemCount: count?.items ?? 0, criticalCount: count?.critical ?? 0,
        } : null,
        draft: draft ? { version: draft.version, revision: draft.revision, updatedAt: draft.updatedAt, source: draft.source } : null,
      };
    });
  }

  async get(id: string) {
    const template = await this.prisma.checklistTemplate.findUnique({
      where: { id }, include: { versions: { orderBy: { version: 'desc' }, select: VERSION_SELECT } },
    });
    if (!template) throw new NotFoundException('Checklist template not found');
    return template;
  }

  async getVersion(id: string, version: number) {
    const template = await this.prisma.checklistTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Checklist template not found');
    const found = await this.prisma.templateVersion.findUnique({
      where: { templateId_version: { templateId: id, version } }, include: TREE_INCLUDE,
    });
    if (!found) throw new NotFoundException('Template version not found');
    return { template, version: found };
  }

  async currentTree(templateId: string) {
    const template = await this.prisma.checklistTemplate.findUnique({ where: { id: templateId } });
    if (!template) return null;
    const version = template.currentVersionId
      ? await this.prisma.templateVersion.findUnique({ where: { id: template.currentVersionId }, include: TREE_INCLUDE })
      : null;
    return { template, version };
  }

  private async countTrees(versionIds: string[]): Promise<CountRow[]> {
    if (versionIds.length === 0) return [];
    return this.prisma.$queryRaw<CountRow[]>`
      SELECT s."versionId" AS "versionId",
             count(DISTINCT s."id")::int AS "sections",
             count(i."id")::int AS "items",
             (count(i."id") FILTER (WHERE i."severity" = 'CRITICAL'))::int AS "critical"
      FROM "checklist_section" s
      LEFT JOIN "checklist_item" i ON i."sectionId" = s."id"
      WHERE s."versionId" = ANY(${versionIds}::uuid[])
      GROUP BY s."versionId"`;
  }
}
