import { z } from 'zod';

export const TEMPLATE_MAX_SECTIONS = 100;
export const TEMPLATE_MAX_ITEMS = 1000;
export const TEMPLATE_IMPORT_FILE_BYTES = 5_242_880;

export const TemplateCategorySchema = z.enum(['QUALITY', 'EHS', 'OTHER']);
export const ResponseTypeSchema = z.enum(['RESULT_ONLY', 'TEXT', 'NUMBER', 'BOOLEAN', 'SELECT']);
export const SeveritySchema = z.enum(['NORMAL', 'CRITICAL']);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;
export type ResponseType = z.infer<typeof ResponseTypeSchema>;
export type Severity = z.infer<typeof SeveritySchema>;

export const TemplateCodeSchema = z.string().trim().min(1).max(50)
  .regex(/^[A-Z0-9_-]+$/, 'Use upper case letters, digits, dash or underscore');

export const TemplateItemInputSchema = z.object({
  number: z.string().trim().min(1).max(30),
  requirementText: z.string().trim().min(1).max(5000),
  severity: SeveritySchema.default('NORMAL'),
  responseType: ResponseTypeSchema.default('RESULT_ONLY'),
  selectOptions: z.array(z.string().trim().min(1).max(100)).default([]),
  minPhotos: z.number().int().min(0).max(20).default(0),
  maxPhotos: z.number().int().min(0).max(20).default(0),
  allowsNa: z.boolean().default(false),
  isRequired: z.boolean().default(true),
  guidanceText: z.string().trim().max(2000).optional(),
}).strip();

export const TemplateSectionInputSchema = z.object({
  number: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(300),
  items: z.array(TemplateItemInputSchema),
}).strip();

type ParsedItem = z.infer<typeof TemplateItemInputSchema>;
type ParsedSection = z.infer<typeof TemplateSectionInputSchema>;

function checkItem(item: ParsedItem, path: (string | number)[], ctx: z.RefinementCtx): void {
  if (item.maxPhotos < item.minPhotos) {
    ctx.addIssue({ code: 'custom', path: [...path, 'maxPhotos'], message: `Must be at least Min Photos (${item.minPhotos})` });
  }
  if (item.responseType !== 'SELECT') {
    if (item.selectOptions.length > 0) {
      ctx.addIssue({ code: 'custom', path: [...path, 'selectOptions'], message: 'Only Select items have options' });
    }
    return;
  }
  const options = item.selectOptions;
  let problem: string | null = null;
  if (options.length < 2 || options.length > 50) problem = 'A Select item needs 2 to 50 options';
  else if (options.some((option) => option.includes(';'))) problem = 'Options cannot contain ";"';
  else if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) problem = 'Options must be unique';
  if (problem) ctx.addIssue({ code: 'custom', path: [...path, 'selectOptions'], message: problem });
}

function checkDocument(doc: { sections: ParsedSection[] }, ctx: z.RefinementCtx): void {
  const total = doc.sections.reduce((sum, section) => sum + section.items.length, 0);
  if (total > TEMPLATE_MAX_ITEMS) {
    ctx.addIssue({ code: 'custom', path: ['sections'], message: `A template can hold at most ${TEMPLATE_MAX_ITEMS} items` });
  }
  const sectionNumbers = new Set<string>();
  doc.sections.forEach((section, s) => {
    if (sectionNumbers.has(section.number)) {
      ctx.addIssue({ code: 'custom', path: ['sections', s, 'number'], message: `Section number ${section.number} is used twice` });
    }
    sectionNumbers.add(section.number);
    const itemNumbers = new Set<string>();
    section.items.forEach((item, i) => {
      if (itemNumbers.has(item.number)) {
        ctx.addIssue({ code: 'custom', path: ['sections', s, 'items', i, 'number'], message: `Item number ${item.number} is used twice in this section` });
      }
      itemNumbers.add(item.number);
      checkItem(item, ['sections', s, 'items', i], ctx);
    });
  });
}

export const TemplateDocumentSchema = z.object({
  sections: z.array(TemplateSectionInputSchema).max(TEMPLATE_MAX_SECTIONS),
}).strip().superRefine(checkDocument);

export const PublishableDocumentSchema = TemplateDocumentSchema.superRefine((doc, ctx) => {
  if (doc.sections.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['sections'], message: 'Add at least one section' });
  }
  doc.sections.forEach((section, s) => {
    if (section.items.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['sections', s, 'items'], message: 'Every section needs at least one item' });
    }
  });
});

export type TemplateDocument = z.infer<typeof TemplateDocumentSchema>;
export type TemplateDocumentInput = z.input<typeof TemplateDocumentSchema>;

const NameSchema = z.string().trim().min(1).max(250);

export const CreateTemplateSchema = z.object({
  code: TemplateCodeSchema, name: NameSchema, category: TemplateCategorySchema,
}).strip();
export type CreateTemplateDto = z.infer<typeof CreateTemplateSchema>;
export type TemplateMetadata = CreateTemplateDto;

export const UpdateTemplateSchema = z.object({
  name: NameSchema.optional(), category: TemplateCategorySchema.optional(),
}).strip().refine((dto) => dto.name !== undefined || dto.category !== undefined, { message: 'Nothing to update' });
export type UpdateTemplateDto = z.infer<typeof UpdateTemplateSchema>;

export const SaveDraftSchema = z.object({
  revision: z.number().int().min(1),
  document: TemplateDocumentSchema,
}).strip();
export type SaveDraftDto = z.infer<typeof SaveDraftSchema>;

export const ImportCommitSchema = z.object({
  code: TemplateCodeSchema, name: NameSchema, category: TemplateCategorySchema,
  document: PublishableDocumentSchema,
  expectedDraftRevision: z.number().int().min(1).optional(),
}).strip();
export type ImportCommitDto = z.infer<typeof ImportCommitSchema>;

export const TemplateTabSchema = z.enum(['enabled', 'draft', 'disabled']);
export const ListTemplatesQuerySchema = z.object({
  tab: TemplateTabSchema.default('enabled'),
  category: TemplateCategorySchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
}).strip();
export type ListTemplatesQueryDto = z.infer<typeof ListTemplatesQuerySchema>;

export const VersionNumberSchema = z.coerce.number().int().min(1);

export interface ImportRowError { row: number | null; column: string | null; message: string }

export type ImportTarget =
  | { kind: 'NEW' }
  | {
      kind: 'EXISTING'; templateId: string; name: string; category: TemplateCategory;
      replacesDraft: { version: number; revision: number } | null; nextVersion: number;
    };

export interface TemplateImportPreview {
  metadata: TemplateMetadata | null;
  target: ImportTarget | null;
  warnings: string[];
  errors: ImportRowError[];
  document: TemplateDocument | null;
  summary: { sections: number; items: number; critical: number; withPhotos: number } | null;
}
