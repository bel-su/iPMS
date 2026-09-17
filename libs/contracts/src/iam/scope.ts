import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';
import { PermissionCodeSchema } from './role.js';

// Convention: every request DTO in this file strips unknown keys rather than
// rejecting, so an out-of-date offline client cannot be hard-failed by a
// field it does not know about.

export const EffectSchema = z.enum(['ALLOW', 'DENY']);
export type Effect = z.infer<typeof EffectSchema>;

export const CreateOverrideSchema = z.object({
  permissionCode: PermissionCodeSchema,
  effect: EffectSchema,
  projectId: UuidSchema.optional(),
  siteId: UuidSchema.optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  reason: z.string().min(1).max(1000),
}).strip();
export type CreateOverrideDto = z.infer<typeof CreateOverrideSchema>;

export const PermissionSourceSchema = z.enum(['ROLE', 'OVERRIDE_ALLOW', 'OVERRIDE_DENY']);

export const EffectivePermissionSchema = z.object({
  code: PermissionCodeSchema,
  granted: z.boolean(),
  source: PermissionSourceSchema,
  sourceDetail: z.string(),
  scopeLevel: z.enum(['GLOBAL', 'PROJECT', 'SITE', 'ASSIGNED_RESOURCE']),
});
export type EffectivePermission = z.infer<typeof EffectivePermissionSchema>;

export const AccessCheckSchema = z.object({
  userId: UuidSchema,
  permissionCode: PermissionCodeSchema,
  resourceType: z.string().min(1).optional(),
  resourceId: UuidSchema.optional(),
}).strip();
export type AccessCheckDto = z.infer<typeof AccessCheckSchema>;

export const AccessCheckResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  checks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    detail: z.string().optional(),
  })),
});
export type AccessCheckResult = z.infer<typeof AccessCheckResultSchema>;
