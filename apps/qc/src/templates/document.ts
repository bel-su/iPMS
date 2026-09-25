import { Prisma } from '@prisma-clients/qc';
import { uuidv7, type TemplateDocument } from '@ipms/contracts';

// A full PrismaClient is assignable to this too, so helpers work inside and outside a transaction.
export type Tx = Prisma.TransactionClient;

export const TREE_INCLUDE = {
  sections: { orderBy: { order: 'asc' }, include: { items: { orderBy: { order: 'asc' } } } },
} as const satisfies Prisma.TemplateVersionInclude;

export type VersionWithTree = Prisma.TemplateVersionGetPayload<{ include: typeof TREE_INCLUDE }>;

export function toDocument(version: VersionWithTree): TemplateDocument {
  return {
    sections: version.sections.map((section) => ({
      number: section.number,
      title: section.title,
      items: section.items.map((item) => ({
        number: item.number,
        requirementText: item.requirementText,
        severity: item.severity as 'NORMAL' | 'CRITICAL',
        responseType: item.responseType as TemplateDocument['sections'][number]['items'][number]['responseType'],
        selectOptions: item.selectOptions,
        minPhotos: item.minPhotos,
        maxPhotos: item.maxPhotos,
        allowsNa: item.allowsNa,
        isRequired: item.isRequired,
        ...(item.guidanceText === null ? {} : { guidanceText: item.guidanceText }),
      })),
    })),
  };
}

export async function clearTree(tx: Tx, versionId: string): Promise<void> {
  await tx.checklistSection.deleteMany({ where: { versionId } });
}

export async function writeTree(tx: Tx, versionId: string, doc: TemplateDocument): Promise<void> {
  for (const [sectionOrder, section] of doc.sections.entries()) {
    const sectionId = uuidv7();
    await tx.checklistSection.create({ data: { id: sectionId, versionId, number: section.number, title: section.title, order: sectionOrder } });
    if (section.items.length === 0) continue;
    await tx.checklistItem.createMany({
      data: section.items.map((item, itemOrder) => ({
        id: uuidv7(), sectionId, number: item.number, requirementText: item.requirementText,
        severity: item.severity, responseType: item.responseType, selectOptions: item.selectOptions,
        minPhotos: item.minPhotos, maxPhotos: item.maxPhotos, allowsNa: item.allowsNa,
        isRequired: item.isRequired, guidanceText: item.guidanceText ?? null, order: itemOrder,
      })),
    });
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
