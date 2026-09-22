import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

export const VerdictSchema = z.enum(['PASS', 'FAIL', 'NA']);

export const ItemResponseInputSchema = z.object({
  itemId: UuidSchema, selfCheckResult: VerdictSchema, selfCheckDescription: z.string().max(5000).optional(), textValue: z.string().max(5000).optional(), numberValue: z.number().optional(), booleanValue: z.boolean().optional(), selectValue: z.string().max(500).optional(), photoMediaIds: z.array(UuidSchema).max(20).default([]),
}).strip();
export const CreateSubmissionSchema = z.object({ taskId: UuidSchema, siteId: UuidSchema, projectId: UuidSchema, templateVersionId: UuidSchema, idempotencyKey: z.string().trim().min(8).max(255), deviceId: z.string().max(255).optional(), latitude: z.number().gte(-90).lte(90).optional(), longitude: z.number().gte(-180).lte(180).optional(), responses: z.array(ItemResponseInputSchema).min(1) }).strip();
export type CreateSubmissionDto = z.infer<typeof CreateSubmissionSchema>;
export const ReviewSubmissionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT_REWORK']), comment: z.string().trim().max(5000).optional(), itemReviews: z.array(z.object({ itemId: UuidSchema, result: z.enum(['APPROVED', 'REJECTED', 'NA']), description: z.string().max(5000).optional() })).min(1) }).refine((data) => data.decision === 'APPROVE' || Boolean(data.comment), { message: 'A rework decision requires a comment', path: ['comment'] });
export type ReviewSubmissionDto = z.infer<typeof ReviewSubmissionSchema>;
