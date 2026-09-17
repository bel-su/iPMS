import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

// Convention: every request DTO in this file strips unknown keys rather than
// rejecting, so an out-of-date offline client cannot be hard-failed by a
// field it does not know about.

export const RoleCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,49}$/, 'Code must be UPPER_SNAKE_CASE');
export const PermissionCodeSchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'Code must be dot.separated.lowercase');

export const CreateRoleSchema = z.object({
  name: z.string().min(1).max(100),
  code: RoleCodeSchema,
  description: z.string().max(1000).default(''),
  permissionCodes: z.array(PermissionCodeSchema),
}).strip();
export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = CreateRoleSchema.partial().omit({ code: true });
export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;

export const CloneRoleSchema = z.object({
  name: z.string().min(1).max(100),
  code: RoleCodeSchema,
  sourceRoleId: UuidSchema,
}).strip();
export type CloneRoleDto = z.infer<typeof CloneRoleSchema>;

export const RoleResponseSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  code: RoleCodeSchema,
  description: z.string(),
  isSystemRole: z.boolean(),
  isActive: z.boolean(),
  permissionCodes: z.array(PermissionCodeSchema),
  userCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type RoleResponse = z.infer<typeof RoleResponseSchema>;

export const ScopeLevelSchema = z.enum(['GLOBAL', 'PROJECT', 'SITE', 'ASSIGNED_RESOURCE']);
export type ScopeLevel = z.infer<typeof ScopeLevelSchema>;

export const GrantScopeSchema = z
  .object({
    level: ScopeLevelSchema,
    projectId: UuidSchema.optional(),
    siteId: UuidSchema.optional(),
  })
  .refine((v) => v.level !== 'PROJECT' || v.projectId !== undefined, {
    message: 'projectId is required when level is PROJECT', path: ['projectId'],
  })
  .refine((v) => v.level !== 'SITE' || v.siteId !== undefined, {
    message: 'siteId is required when level is SITE', path: ['siteId'],
  });
export type GrantScopeDto = z.infer<typeof GrantScopeSchema>;
