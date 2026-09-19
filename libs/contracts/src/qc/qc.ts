import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

export const TemplateCategorySchema = z.enum(['QUALITY', 'EHS', 'OTHER']);
export const ResponseTypeSchema = z.enum(['RESULT_ONLY', 'TEXT', 'NUMBER', 'BOOLEAN', 'SELECT']);
export const VerdictSchema = z.enum(['PASS', 'FAIL', 'NA']);

export const ChecklistItemInputSchema = z.object({
  number: z.string().trim().min(1).max(30), requirementText: z.string().trim().min(1).max(5000),
  severity: z.enum(['NORMAL', 'CRITICAL']).default('NORMAL'), responseType: ResponseTypeSchema.default('RESULT_ONLY'),
  requiresPhoto: z.boolean().default(false), minPhotos: z.number().int().min(0).max(20).default(0), maxPhotos: z.number().int().min(0).max(20).default(0),
  allowsNa: z.boolean().default(false), isRequired: z.boolean().default(true), guidanceText: z.string().max(2000).optional(), order: z.number().int().min(0),
}).refine((item) => item.maxPhotos >= item.minPhotos, { message: 'maxPhotos must be at least minPhotos', path: ['maxPhotos'] });
export const ChecklistSectionInputSchema = z.object({ number: z.string().trim().min(1).max(30), title: z.string().trim().min(1).max(300), order: z.number().int().min(0), items: z.array(ChecklistItemInputSchema).min(1) });
export const CreateTemplateSchema = z.object({ projectId: UuidSchema, code: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/), name: z.string().trim().min(1).max(250), category: TemplateCategorySchema, sections: z.array(ChecklistSectionInputSchema).min(1) }).strip();
export type CreateTemplateDto = z.infer<typeof CreateTemplateSchema>;

export const ItemResponseInputSchema = z.object({
  itemId: UuidSchema, selfCheckResult: VerdictSchema, selfCheckDescription: z.string().max(5000).optional(), textValue: z.string().max(5000).optional(), numberValue: z.number().optional(), booleanValue: z.boolean().optional(), selectValue: z.string().max(500).optional(), photoMediaIds: z.array(UuidSchema).max(20).default([]),
}).strip();
export const CreateSubmissionSchema = z.object({ taskId: UuidSchema, siteId: UuidSchema, projectId: UuidSchema, templateId: UuidSchema, idempotencyKey: z.string().trim().min(8).max(255), deviceId: z.string().max(255).optional(), responses: z.array(ItemResponseInputSchema).min(1) }).strip();
export type CreateSubmissionDto = z.infer<typeof CreateSubmissionSchema>;
export const ReviewSubmissionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT_REWORK']), comment: z.string().trim().max(5000).optional(), itemReviews: z.array(z.object({ itemId: UuidSchema, result: z.enum(['APPROVED', 'REJECTED', 'NA']), description: z.string().max(5000).optional() })).min(1) }).refine((data) => data.decision === 'APPROVE' || Boolean(data.comment), { message: 'A rework decision requires a comment', path: ['comment'] });
export type ReviewSubmissionDto = z.infer<typeof ReviewSubmissionSchema>;
