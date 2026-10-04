import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

export const VerdictSchema = z.enum(['PASS', 'FAIL', 'NA']);

export const MAX_MEDIA_PER_ITEM = 25;
export const DRAFT_MAX_BYTES = 262_144;
export const DRAFTABLE_STATUSES = ['NOT_STARTED', 'ONGOING', 'RECTIFYING'] as const;

/** `details.reason` of a 409, for clients to branch on without reading the message. */
export const REFUSAL_REASONS = {
  MEDIA_NOT_READY: 'MEDIA_NOT_READY',
  DRAFT_HELD_ELSEWHERE: 'DRAFT_HELD_ELSEWHERE',
  DRAFT_STALE: 'DRAFT_STALE',
  WORK_ORDER_CLOSED: 'WORK_ORDER_CLOSED',
} as const;

const MediaIdsSchema = z.array(UuidSchema).max(MAX_MEDIA_PER_ITEM);

/** Mobile builds before QC evidence send `photoMediaIds`; read it as `mediaIds` for one release. */
const withMediaIds = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object' || 'mediaIds' in raw || !('photoMediaIds' in raw)) return raw;
  const { photoMediaIds, ...rest } = raw as Record<string, unknown>;
  return { ...rest, mediaIds: photoMediaIds };
};

export const ItemResponseInputSchema = z.preprocess(withMediaIds, z.object({
  itemId: UuidSchema, selfCheckResult: VerdictSchema, selfCheckDescription: z.string().max(5000).optional(), textValue: z.string().max(5000).optional(), numberValue: z.number().optional(), booleanValue: z.boolean().optional(), selectValue: z.string().max(500).optional(), mediaIds: MediaIdsSchema.default([]),
}).strip());

export const DraftItemResponseSchema = z.object({
  itemId: UuidSchema, selfCheckResult: VerdictSchema.optional(), selfCheckDescription: z.string().max(5000).optional(), textValue: z.string().max(5000).optional(), numberValue: z.number().optional(), booleanValue: z.boolean().optional(), selectValue: z.string().max(500).optional(), mediaIds: MediaIdsSchema.default([]),
}).strip();
export type DraftItemResponse = z.infer<typeof DraftItemResponseSchema>;

const DeviceSchema = { deviceId: z.string().trim().min(1).max(255), deviceLabel: z.string().trim().min(1).max(100) };
export const SaveDraftSchema = z.object({ ...DeviceSchema, baseVersion: z.number().int().min(0), responses: z.array(DraftItemResponseSchema).max(1000) }).strip();
export type SaveDraftDto = z.infer<typeof SaveDraftSchema>;
export const TakeoverDraftSchema = z.object(DeviceSchema).strip();
export type TakeoverDraftDto = z.infer<typeof TakeoverDraftSchema>;

export interface WorkOrderDraftView {
  workOrderId: string;
  /** 0 for the unsaved rework pre-fill. */
  version: number;
  deviceId: string | null;
  deviceLabel: string | null;
  updatedAt: string | null;
  responses: DraftItemResponse[];
}
export const CreateSubmissionSchema = z.object({ taskId: UuidSchema, siteId: UuidSchema, projectId: UuidSchema, templateVersionId: UuidSchema, idempotencyKey: z.string().trim().min(8).max(255), deviceId: z.string().max(255).optional(), latitude: z.number().gte(-90).lte(90).optional(), longitude: z.number().gte(-180).lte(180).optional(), responses: z.array(ItemResponseInputSchema).min(1) }).strip();
export type CreateSubmissionDto = z.infer<typeof CreateSubmissionSchema>;
export const ReviewSubmissionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT_REWORK']), comment: z.string().trim().max(5000).optional(), itemReviews: z.array(z.object({ itemId: UuidSchema, result: z.enum(['APPROVED', 'REJECTED', 'NA']), description: z.string().max(5000).optional() })).min(1) }).refine((data) => data.decision === 'APPROVE' || Boolean(data.comment), { message: 'A rework decision requires a comment', path: ['comment'] });
export type ReviewSubmissionDto = z.infer<typeof ReviewSubmissionSchema>;
