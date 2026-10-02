import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

/** Who holds `permission` with reach to `projectId`, for service-to-service callers with no user token. */
export const HoldersRequestSchema = z.object({
  permission: z.string().min(1).max(100),
  projectId: UuidSchema,
});
export type HoldersRequest = z.infer<typeof HoldersRequestSchema>;

export const HoldersResultSchema = z.object({ userIds: z.array(z.string()) });
export type HoldersResult = z.infer<typeof HoldersResultSchema>;
