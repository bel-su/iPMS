import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';
import { PaginationSchema } from '../common/pagination.js';
import { RoleCodeSchema } from './role.js';

// Convention: every request DTO in this file strips unknown keys rather than
// rejecting, so an out-of-date offline client cannot be hard-failed by a field
// it does not know about — and a client-supplied `isActive` or
// `mustChangePassword` is discarded rather than reaching the handler.

/**
 * Lowercased before the pattern is applied, so `Ann.Lee` and `ann.lee` cannot
 * become two accounts that look identical in every list.
 *
 * Two characters minimum: the seeded `qc` account is two, and a policy the
 * repository's own seed violates is the wrong policy.
 */
export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9._-]{1,149}$/,
    'Username must start with a letter and contain only letters, digits, dots, underscores or hyphens',
  );

/**
 * Twelve characters for anything set through the API. `LoginSchema` stays at
 * eight on purpose: raising it would lock out every account created under the
 * old policy, which is a migration, not this change.
 */
export const NewPasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200);

export const CreateUserSchema = z.object({
  username: UsernameSchema,
  email: z.email().max(255),
  fullName: z.string().trim().min(1).max(200),
  employeeCode: z.string().trim().min(1).max(50).optional(),
  password: NewPasswordSchema,
  roleCodes: z.array(RoleCodeSchema).default([]),
}).strip();
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

/**
 * Deliberately without `username` or `password`.
 *
 * `username` is the login identifier and it appears in audit ledger entries
 * written before any rename, so changing it silently rewrites who those entries
 * appear to be about. Changing a username means creating an account.
 *
 * `password` has its own endpoint because a credential change must revoke the
 * target's sessions, and folding that into a general-purpose PATCH makes it
 * easy to forget.
 */
export const UpdateUserSchema = z.object({
  email: z.email().max(255).optional(),
  fullName: z.string().trim().min(1).max(200).optional(),
  employeeCode: z.string().trim().min(1).max(50).nullable().optional(),
}).strip();
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

/**
 * The complete desired set, not a delta.
 *
 * An add/remove API needs the client to know the current state, and makes two
 * concurrent edits silently merge into a set neither editor asked for. Sending
 * the whole set makes the write idempotent and the audit entry a complete
 * before-and-after.
 */
export const AssignRolesSchema = z.object({
  roleCodes: z.array(RoleCodeSchema),
}).strip();
export type AssignRolesDto = z.infer<typeof AssignRolesSchema>;

export const ResetPasswordSchema = z.object({ password: NewPasswordSchema }).strip();
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;

/** `currentPassword` is only ever compared against a stored hash, so it carries no length policy. */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: NewPasswordSchema,
}).strip();
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

export const UserStatusFilterSchema = z.enum(['ACTIVE', 'INACTIVE', 'ALL']);
export type UserStatusFilter = z.infer<typeof UserStatusFilterSchema>;

export const UserListQuerySchema = PaginationSchema.extend({
  /** Matched against username, email and full name, case-insensitively. */
  search: z.string().trim().min(1).max(150).optional(),
  status: UserStatusFilterSchema.default('ALL'),
  role: RoleCodeSchema.optional(),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

export const UserRoleSummarySchema = z.object({
  code: RoleCodeSchema,
  name: z.string(),
});

/** Never carries `passwordHash`, and never gains a field by being spread from a row. */
export const UserResponseSchema = z.object({
  id: UuidSchema,
  username: z.string(),
  email: z.string(),
  fullName: z.string(),
  employeeCode: z.string().nullable(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  roles: z.array(UserRoleSummarySchema),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;
