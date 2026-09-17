import { z } from 'zod';
import { PaginationSchema } from '../common/pagination.js';

// actorId is not a UuidSchema: AuditEventPayload.actorId is a plain `string | null`
// (e.g. a system actor like 'system' or a non-UUID legacy identifier), matching the
// audit_event.actor_id column (VarChar(100), unconstrained format).
export const AuditQuerySchema = PaginationSchema.extend({
  actorId: z.string().max(100).optional(),
  objectType: z.string().max(100).optional(),
  objectId: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AuditQueryDto = z.infer<typeof AuditQuerySchema>;

export const VerifyQuerySchema = z.object({
  from: z.coerce.number().int().min(1).optional(),
  to: z.coerce.number().int().min(1).optional(),
});
export type VerifyQueryDto = z.infer<typeof VerifyQuerySchema>;
