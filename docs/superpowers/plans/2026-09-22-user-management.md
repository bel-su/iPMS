# User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `iam` a users module — list, create, edit, deactivate, assign roles, reset passwords — with administrators able to manage anyone and project managers able to manage only field engineers and QC managers, surfaced in the web app and its navigation.

**Architecture:** Two orthogonal gates. The existing permission catalog (`user.view`, `user.create`, `user.update`, `user.deactivate`, `role.assign`) is the *verb* gate, enforced by `@RequirePermission` as everywhere else. A new declarative table in `@ipms/authz` is the *object* gate, answering which roles an actor may confer and therefore which users they may touch. A newly created user holds a creator-set temporary password and is issued an authority-free token until they change it, so every existing `AuthzGuard` refuses them with no new enforcement code.

**Tech Stack:** TypeScript 5.9 (ESM, `.js` import specifiers), NestJS 12 + Fastify, Prisma 7 (per-app generated client at `@prisma-clients/iam`), Zod 4.6, Next.js 16 (App Router, Server Actions, `proxy.ts` not `middleware.ts`), Vitest 4, pnpm workspaces + Nx.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-22-user-management-design.md`. Every decision below is justified there; read it before starting.
- **No new permission codes.** The catalog in `libs/authz/src/permissions.ts` is unchanged by this plan. Its closing comment forbids codes that guard nothing.
- **No `user.delete`.** `DELETE /users/:id` deactivates. Hard deletion is deliberately unreachable.
- **Every HTTP boundary parses with a Zod schema from `@ipms/contracts`.** Never a hand-rolled check, never a bare cast.
- **Every request DTO uses `.strip()`,** never `z.strictObject()` — see the comment at the top of `libs/contracts/src/iam/auth.ts`.
- **`passwordHash` is never selected into a response,** and never appears in an audit payload. Build responses from an explicit `select`, never by spreading a row.
- **Imports inside `apps/iam` and `libs/*` carry the `.js` extension** (`./users.service.js`), because the packages are ESM. Web app imports do not.
- **Prisma client import in `iam` is `@prisma-clients/iam`,** never `@prisma/client` — see the `output` comment in `apps/iam/prisma/schema.prisma`.
- **Services are registered in `app.module.ts` through a factory with an explicit `inject` list,** never as a bare class. Their constructors take `import type` parameters, which TypeScript erases; a bare class entry makes Nest fail at bootstrap with an unresolvable token.
- **Token revocation uses `revokeTokens(tx, userId)`:** the row update inside the caller's transaction, the publish inside the same callback before commit. That order is fail-closed. Do not "fix" it by publishing after commit.
- **Run tests from the repo root** with `pnpm vitest run <path>` (the root config declares the projects) or per app with `pnpm --filter <app> test`.
- **Commit after every task.** End commit messages with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `libs/authz/src/assignable-roles.ts` | The role-assignment authority table and its three query functions |
| `libs/authz/src/assignable-roles.spec.ts` | Its tests |
| `libs/contracts/src/iam/user.ts` | Request and response schemas for the users module |
| `libs/contracts/src/iam/user.spec.ts` | Its tests |
| `apps/iam/prisma/migrations/<ts>_add_must_change_password/migration.sql` | The one new column |
| `apps/iam/src/users/users.service.ts` | All user reads and writes, transactional, audited |
| `apps/iam/src/users/users.service.spec.ts` | Its tests |
| `apps/iam/src/users/users.controller.ts` | HTTP surface, permission decorators, schema parsing |
| `apps/iam/src/users/users.controller.spec.ts` | Its tests |
| `apps/iam/prisma/last-super-admin.integration.spec.ts` | The one rule that needs a real database |
| `apps/web/app/lib/settle.ts`, `apps/web/app/lib/form-state.ts` | Moved from `app/projects/` |
| `apps/web/app/lib/user-api.ts` | The users surface as reached through the gateway |
| `apps/web/app/users/page.tsx` | List with search, status and role filters |
| `apps/web/app/users/new/page.tsx` | Create form |
| `apps/web/app/users/[id]/page.tsx` | Detail: edit, roles, deactivate/reactivate, reset password |
| `apps/web/app/users/forms.tsx` | The client components those pages render |
| `apps/web/app/users/actions.ts` | One Server Action per mutation |
| `apps/web/app/users/actions.spec.ts` | Its tests |
| `apps/web/app/change-password/page.tsx` + `form.tsx` | Forced and voluntary password change |

**Modified:**

| Path | Change |
|---|---|
| `libs/authz/src/index.ts` | Export the new module |
| `libs/authz/src/token.ts` | `TokenClaims` and `signToken` carry `mustChangePassword` |
| `libs/authz/src/types.ts` | `AuthzUser.mustChangePassword?` |
| `libs/authz/src/nest/jwt-user.guard.ts` | Copy the claim onto `request.user` |
| `libs/contracts/src/index.ts` | Export `iam/user.js` |
| `libs/contracts/src/iam/auth.ts` | `TokenPayloadSchema` and `TokenPairSchema` gain the optional field |
| `apps/iam/prisma/schema.prisma` | `User.mustChangePassword` |
| `apps/iam/prisma/seed.ts` | `PROJECT_MANAGER` gains four permissions |
| `apps/iam/src/app.module.ts` | Register `UsersController` and `UsersService` |
| `apps/iam/src/auth/token.service.ts` | `issue()` takes the flag |
| `apps/iam/src/auth/auth.service.ts` | Empty-authority branch; `changePassword` |
| `apps/iam/src/auth/auth.controller.ts` | `POST /auth/change-password` |
| `apps/web/app/projects/*` | Import `settle`/`form-state` from `../lib/` |
| `apps/web/app/shell.tsx` | `Sidebar` becomes async and gains the Users item |
| `apps/web/app/login/page.tsx`, `apps/web/app/api/auth/login/route.ts` | Redirect on `mustChangePassword` |

---

## Task 1: The assignable-roles table

**Files:**
- Create: `libs/authz/src/assignable-roles.ts`
- Test: `libs/authz/src/assignable-roles.spec.ts`
- Modify: `libs/authz/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `assignableRoles(actorRoleCodes: string[]): 'ALL' | Set<string>`, `mayAssign(actorRoleCodes: string[], roleCode: string): boolean`, `mayManage(actorRoleCodes: string[], targetRoleCodes: string[]): boolean`, `ROLE_ASSIGNMENT`.

- [ ] **Step 1: Write the failing test**

Create `libs/authz/src/assignable-roles.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assignableRoles, mayAssign, mayManage } from './assignable-roles.js';

describe('assignableRoles', () => {
  it('gives a super administrator every role', () => {
    expect(assignableRoles(['SUPER_ADMIN'])).toBe('ALL');
  });

  it('gives a project manager field engineers and QC managers, and nothing else', () => {
    const allowed = assignableRoles(['PROJECT_MANAGER']);
    expect(allowed).toEqual(new Set(['FIELD_ENGINEER', 'QC_MANAGER']));
  });

  it('unions the sets of an actor holding two listed roles', () => {
    expect(assignableRoles(['PROJECT_MANAGER', 'QC_MANAGER']))
      .toEqual(new Set(['FIELD_ENGINEER', 'QC_MANAGER']));
  });

  // Fail closed: a custom role created through RolesController confers no
  // assignment authority until it is added to the table deliberately.
  it('gives an unlisted role nothing', () => {
    expect(assignableRoles(['QC_MANAGER'])).toEqual(new Set());
    expect(assignableRoles([])).toEqual(new Set());
  });

  it('lets ALL win over a narrower role held at the same time', () => {
    expect(assignableRoles(['PROJECT_MANAGER', 'SUPER_ADMIN'])).toBe('ALL');
  });
});

describe('mayAssign', () => {
  it('refuses a project manager the administrator role', () => {
    expect(mayAssign(['PROJECT_MANAGER'], 'SUPER_ADMIN')).toBe(false);
  });

  it('refuses a project manager their own role', () => {
    expect(mayAssign(['PROJECT_MANAGER'], 'PROJECT_MANAGER')).toBe(false);
  });

  it('allows a project manager the two team roles', () => {
    expect(mayAssign(['PROJECT_MANAGER'], 'FIELD_ENGINEER')).toBe(true);
    expect(mayAssign(['PROJECT_MANAGER'], 'QC_MANAGER')).toBe(true);
  });

  it('allows a super administrator anything, including a custom role', () => {
    expect(mayAssign(['SUPER_ADMIN'], 'QC_INSPECTOR')).toBe(true);
  });
});

describe('mayManage', () => {
  it('lets a project manager manage a field engineer', () => {
    expect(mayManage(['PROJECT_MANAGER'], ['FIELD_ENGINEER'])).toBe(true);
  });

  it('refuses a project manager a target who also holds an unassignable role', () => {
    expect(mayManage(['PROJECT_MANAGER'], ['FIELD_ENGINEER', 'SUPER_ADMIN'])).toBe(false);
  });

  /**
   * A roleless account has no authority to capture, and refusing here would
   * strand a user that an error left without an assignment.
   */
  it('lets anyone manage a user who holds no roles', () => {
    expect(mayManage(['PROJECT_MANAGER'], [])).toBe(true);
  });

  it('lets a super administrator manage anyone', () => {
    expect(mayManage(['SUPER_ADMIN'], ['SUPER_ADMIN'])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run libs/authz/src/assignable-roles.spec.ts
```

Expected: FAIL — `Failed to resolve import "./assignable-roles.js"`.

- [ ] **Step 3: Write the implementation**

Create `libs/authz/src/assignable-roles.ts`:

```ts
/**
 * Which roles an actor may confer on another user — the *object* gate, which
 * the permission catalog cannot express.
 *
 * "A project manager may create users" and "a project manager may not create an
 * administrator" are different statements, and `user.create` can only make the
 * first. Permissions stay the verb gate; this table answers which users a verb
 * may be aimed at.
 *
 * A role absent from this table confers no assignment authority at all. That is
 * the fail-closed direction and it is what makes a custom role created through
 * `RolesController` safe by default: it can be granted `user.create` and still
 * not be able to mint an administrator, because adding an entry here is a
 * separate, deliberate act.
 */
export const ROLE_ASSIGNMENT: Readonly<Record<string, readonly string[] | 'ALL'>> = {
  SUPER_ADMIN: 'ALL',
  PROJECT_MANAGER: ['FIELD_ENGINEER', 'QC_MANAGER'],
};

/** `'ALL'` for an unrestricted actor, otherwise the union of every listed role they hold. */
export function assignableRoles(actorRoleCodes: string[]): 'ALL' | Set<string> {
  const union = new Set<string>();
  for (const code of actorRoleCodes) {
    const entry = ROLE_ASSIGNMENT[code];
    if (entry === 'ALL') return 'ALL';
    for (const role of entry ?? []) union.add(role);
  }
  return union;
}

/** True when the actor may grant this role to someone. */
export function mayAssign(actorRoleCodes: string[], roleCode: string): boolean {
  const allowed = assignableRoles(actorRoleCodes);
  return allowed === 'ALL' || allowed.has(roleCode);
}

/**
 * True when the actor may edit, deactivate or re-role this target at all.
 *
 * Every one of the target's current roles must be assignable by the actor — so
 * a project manager cannot touch an administrator, because `SUPER_ADMIN` is not
 * in their set. A target holding no roles passes vacuously, which is intended;
 * see the table's comment.
 */
export function mayManage(actorRoleCodes: string[], targetRoleCodes: string[]): boolean {
  const allowed = assignableRoles(actorRoleCodes);
  if (allowed === 'ALL') return true;
  return targetRoleCodes.every((code) => allowed.has(code));
}
```

- [ ] **Step 4: Export it from the barrel**

In `libs/authz/src/index.ts`, add after the `permissions.js` export block:

```ts
export {
  ROLE_ASSIGNMENT, assignableRoles, mayAssign, mayManage,
} from './assignable-roles.js';
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm vitest run libs/authz/src/assignable-roles.spec.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add libs/authz/src/assignable-roles.ts libs/authz/src/assignable-roles.spec.ts libs/authz/src/index.ts
git commit -m "$(cat <<'EOF'
feat(authz): add the role-assignment authority table

Permissions say which verbs an actor holds; they cannot say which roles an
actor may confer. This table answers the second question, so a project manager
granted user.create can create field engineers and QC managers without being
able to mint an administrator.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: User contracts

**Files:**
- Create: `libs/contracts/src/iam/user.ts`, `libs/contracts/src/iam/user.spec.ts`
- Modify: `libs/contracts/src/index.ts`

**Interfaces:**
- Consumes: `PaginationSchema` from `../common/pagination.js`, `RoleCodeSchema` from `./role.js`.
- Produces: `CreateUserSchema`/`CreateUserDto`, `UpdateUserSchema`/`UpdateUserDto`, `AssignRolesSchema`/`AssignRolesDto`, `ResetPasswordSchema`/`ResetPasswordDto`, `ChangePasswordSchema`/`ChangePasswordDto`, `UserListQuerySchema`/`UserListQuery`, `UserResponseSchema`/`UserResponse`, `UsernameSchema`, `NewPasswordSchema`.

- [ ] **Step 1: Write the failing test**

Create `libs/contracts/src/iam/user.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AssignRolesSchema, ChangePasswordSchema, CreateUserSchema,
  UpdateUserSchema, UserListQuerySchema, UsernameSchema,
} from './user.js';

describe('UsernameSchema', () => {
  it('trims and lowercases, so the same person cannot register twice', () => {
    expect(UsernameSchema.parse('  Field.Engineer_01  ')).toBe('field.engineer_01');
  });

  // The seeded `qc` account is two characters; a policy the repository's own
  // seed violates is the wrong policy.
  it('accepts a two-character username', () => {
    expect(UsernameSchema.parse('qc')).toBe('qc');
  });

  it('refuses a single character, a leading digit, and a space', () => {
    expect(UsernameSchema.safeParse('a').success).toBe(false);
    expect(UsernameSchema.safeParse('1abc').success).toBe(false);
    expect(UsernameSchema.safeParse('ab cd').success).toBe(false);
  });
});

describe('CreateUserSchema', () => {
  const valid = {
    username: 'new.engineer', email: 'new@ipms.local', fullName: 'New Engineer',
    password: 'correct-horse-battery', roleCodes: ['FIELD_ENGINEER'],
  };

  it('accepts a complete body', () => {
    expect(CreateUserSchema.parse(valid).username).toBe('new.engineer');
  });

  it('defaults roleCodes to none', () => {
    const { roleCodes: _omitted, ...withoutRoles } = valid;
    expect(CreateUserSchema.parse(withoutRoles).roleCodes).toEqual([]);
  });

  it('refuses a password under twelve characters', () => {
    expect(CreateUserSchema.safeParse({ ...valid, password: 'short11chars' }).success).toBe(true);
    expect(CreateUserSchema.safeParse({ ...valid, password: 'tooshort' }).success).toBe(false);
  });

  it('refuses a malformed email', () => {
    expect(CreateUserSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  /**
   * Strips rather than rejects, per this directory's convention — and these are
   * the two keys it matters for: a client that sends `isActive` or
   * `mustChangePassword` must not have them reach the handler.
   */
  it('strips keys the caller has no business setting', () => {
    const parsed = CreateUserSchema.parse({ ...valid, isActive: false, mustChangePassword: false });
    expect(parsed).not.toHaveProperty('isActive');
    expect(parsed).not.toHaveProperty('mustChangePassword');
  });
});

describe('UpdateUserSchema', () => {
  it('has no username field: renaming would rewrite who past audit entries are about', () => {
    expect(UpdateUserSchema.parse({ username: 'renamed' })).not.toHaveProperty('username');
  });

  it('has no password field: a credential change must revoke sessions, so it has its own endpoint', () => {
    expect(UpdateUserSchema.parse({ password: 'a-new-password' })).not.toHaveProperty('password');
  });

  it('lets employeeCode be cleared with null but not blanked with a space', () => {
    expect(UpdateUserSchema.parse({ employeeCode: null }).employeeCode).toBeNull();
    expect(UpdateUserSchema.parse({ employeeCode: ' EMP-1 ' }).employeeCode).toBe('EMP-1');
  });
});

describe('AssignRolesSchema', () => {
  // The complete desired set, never a delta: idempotent, and the audit entry is
  // a complete before/after rather than half a story.
  it('takes the whole desired set, including the empty one', () => {
    expect(AssignRolesSchema.parse({ roleCodes: [] }).roleCodes).toEqual([]);
    expect(AssignRolesSchema.parse({ roleCodes: ['QC_MANAGER'] }).roleCodes).toEqual(['QC_MANAGER']);
  });

  it('refuses a role code that is not UPPER_SNAKE_CASE', () => {
    expect(AssignRolesSchema.safeParse({ roleCodes: ['qc_manager'] }).success).toBe(false);
  });
});

describe('ChangePasswordSchema', () => {
  it('requires both halves, and holds only the new one to the policy', () => {
    const parsed = ChangePasswordSchema.parse({ currentPassword: 'old8char', newPassword: 'a-long-enough-one' });
    expect(parsed.currentPassword).toBe('old8char');
    expect(ChangePasswordSchema.safeParse({ currentPassword: 'old8char', newPassword: 'tooshort' }).success).toBe(false);
  });
});

describe('UserListQuerySchema', () => {
  it('defaults to the first page, twenty rows, and every status', () => {
    expect(UserListQuerySchema.parse({})).toEqual({ page: 1, limit: 20, status: 'ALL' });
  });

  it('coerces the page and limit a query string delivers as text', () => {
    const parsed = UserListQuerySchema.parse({ page: '3', limit: '50', search: ' ann ' });
    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(50);
    expect(parsed.search).toBe('ann');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run libs/contracts/src/iam/user.spec.ts
```

Expected: FAIL — `Failed to resolve import "./user.js"`.

- [ ] **Step 3: Write the implementation**

Create `libs/contracts/src/iam/user.ts`:

```ts
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
```

- [ ] **Step 4: Export it from the barrel**

In `libs/contracts/src/index.ts`, add after the `./iam/scope.js` line:

```ts
export * from './iam/user.js';
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm vitest run libs/contracts/src/iam/user.spec.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add libs/contracts/src/iam/user.ts libs/contracts/src/iam/user.spec.ts libs/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add the user management request and response schemas

Username is absent from the update schema because it appears in audit entries
written before any rename; password is absent because a credential change must
revoke sessions and needs an endpoint that cannot be reached by accident.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Carry `mustChangePassword` through the token

**Files:**
- Modify: `libs/contracts/src/iam/auth.ts`, `libs/authz/src/token.ts`, `libs/authz/src/types.ts`, `libs/authz/src/nest/jwt-user.guard.ts`
- Test: `libs/authz/src/token.spec.ts` (append), `libs/authz/src/nest/jwt-user.guard.spec.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TokenClaims.mustChangePassword?: boolean`, `TokenPayload.mustChangePassword?: boolean`, `TokenPair.mustChangePassword?: boolean`, `AuthzUser.mustChangePassword?: boolean`. Task 8 sets them; Task 14 reads `TokenPair`'s.

**Why optional:** tokens minted before this deploy must stay valid, and `TokenPayloadSchema.strip()` silently drops any claim it does not declare — so an undeclared field would be signed and then thrown away at verification.

- [ ] **Step 1: Write the failing tests**

Append to `libs/authz/src/token.spec.ts`:

```ts
describe('the mustChangePassword claim', () => {
  const SECRET = 'a-test-secret-value';

  it('round-trips when set', () => {
    const token = signToken(
      { sub: '00000000-0000-7000-8000-000000000001', roles: [], permissions: [], tokenVersion: 0, mustChangePassword: true },
      'access', SECRET, 900,
    );
    expect(verifyToken(token, SECRET, 'access').mustChangePassword).toBe(true);
  });

  // Tokens minted before this field existed must keep verifying.
  it('is absent, not false, when it was never set', () => {
    const token = signToken(
      { sub: '00000000-0000-7000-8000-000000000001', roles: ['VIEWER'], permissions: ['project.view'], tokenVersion: 0 },
      'access', SECRET, 900,
    );
    expect(verifyToken(token, SECRET, 'access').mustChangePassword).toBeUndefined();
  });
});
```

Append to `libs/authz/src/nest/jwt-user.guard.spec.ts`:

```ts
describe('JwtUserGuard and the mustChangePassword claim', () => {
  it('copies the claim onto request.user so a service can read it', async () => {
    // Build the request the same way the surrounding tests in this file do,
    // with a token signed with `mustChangePassword: true`, then assert:
    // expect(request.user.mustChangePassword).toBe(true);
  });
});
```

> **Note for the implementer:** replace that placeholder body with the concrete arrangement used by the tests already in `jwt-user.guard.spec.ts` — read the file first and mirror its existing helper for building a context and a signed token. Do not invent a second helper.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run libs/authz/src/token.spec.ts libs/authz/src/nest/jwt-user.guard.spec.ts
```

Expected: FAIL — the round-trip test reports `undefined` because `TokenPayloadSchema` strips the claim.

- [ ] **Step 3: Declare the field on the payload and the pair**

In `libs/contracts/src/iam/auth.ts`, inside `TokenPayloadSchema`'s object, after `typ`:

```ts
  /**
   * Present and true only while the holder owes a password change. A token
   * carrying it is minted with no roles and no permissions, so every
   * `AuthzGuard` in the platform refuses it — that is what makes the forced
   * change an enforced rule rather than a browser-side suggestion.
   *
   * Optional so that tokens minted before this field existed still verify:
   * this schema strips undeclared keys, so an absent claim is absent, not
   * invalid.
   */
  mustChangePassword: z.boolean().optional(),
```

And inside `TokenPairSchema`, after `expiresIn`:

```ts
  /** Lets the web app send the user straight to the change-password page at login. */
  mustChangePassword: z.boolean().optional(),
```

- [ ] **Step 4: Sign it**

In `libs/authz/src/token.ts`, add to `TokenClaims`:

```ts
  /** See TokenPayloadSchema in @ipms/contracts for why this is optional. */
  mustChangePassword?: boolean;
```

and inside `signToken`'s body object, after `tokenVersion: claims.tokenVersion,`:

```ts
    // Spread conditionally rather than writing `mustChangePassword: false`, so
    // an ordinary token's bytes are unchanged by this field's existence.
    ...(claims.mustChangePassword ? { mustChangePassword: true } : {}),
```

- [ ] **Step 5: Carry it onto the request**

In `libs/authz/src/types.ts`, add to `AuthzUser`:

```ts
  /** True while this user owes a password change; their token carries no authority. */
  mustChangePassword?: boolean;
```

In `libs/authz/src/nest/jwt-user.guard.ts`, extend the `user` object literal:

```ts
    const user: AuthzUser = {
      id: payload.sub,
      roles: payload.roles,
      permissions: payload.permissions,
      tokenVersion: payload.tokenVersion,
      isActive: true,
      ...(payload.mustChangePassword ? { mustChangePassword: true } : {}),
    };
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm vitest run libs/authz libs/contracts
```

Expected: PASS — every existing authz and contracts test still green, plus the new ones.

- [ ] **Step 7: Commit**

```bash
git add libs/contracts/src/iam/auth.ts libs/authz/src/token.ts libs/authz/src/types.ts libs/authz/src/nest/jwt-user.guard.ts libs/authz/src/token.spec.ts libs/authz/src/nest/jwt-user.guard.spec.ts
git commit -m "$(cat <<'EOF'
feat(authz): carry a mustChangePassword claim through the token

Optional throughout: the payload schema strips undeclared keys, so tokens
minted before this field existed keep verifying and an ordinary token's bytes
are unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The `mustChangePassword` column

**Files:**
- Modify: `apps/iam/prisma/schema.prisma`
- Create: `apps/iam/prisma/migrations/<timestamp>_add_must_change_password/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `User.mustChangePassword: boolean` on the generated client, used by Tasks 5, 6 and 8.

- [ ] **Step 1: Add the field**

In `apps/iam/prisma/schema.prisma`, in `model User`, after the `tokenVersion` line:

```prisma
  /// True while the holder owes a password change — set on creation and on an
  /// administrator reset, cleared when they change it themselves. Defaults to
  /// false so existing rows, including the seeded demo accounts, are unaffected.
  mustChangePassword Boolean @default(false)
```

- [ ] **Step 2: Generate the migration and the client**

```bash
pnpm --filter iam exec prisma migrate dev --name add_must_change_password
```

Expected: a new directory under `apps/iam/prisma/migrations/` containing
`ALTER TABLE "user" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;`, and the client regenerated into `apps/iam/node_modules/@prisma-clients/iam`.

> This needs a reachable `DATABASE_URL`. If the dev database is not running, start the stack first (`docker compose -f docker/compose.yml up -d postgres`, or whatever `.dev-stack` provides) rather than hand-writing the migration — `migrate dev` also records it in `_prisma_migrations`.

- [ ] **Step 3: Verify the generated SQL**

```bash
cat apps/iam/prisma/migrations/*_add_must_change_password/migration.sql
```

Expected: exactly the `ALTER TABLE ... ADD COLUMN ... DEFAULT false;` above, and nothing else. **If the file contains a `DROP INDEX` for `user_role_global_uidx`, `user_role_project_uidx` or `user_role_site_uidx`, delete those statements before committing** — Prisma cannot express partial unique indexes and will try to "correct" them away. The `UserRole` model comment in `schema.prisma` explains this in full.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter iam typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/iam/prisma/schema.prisma apps/iam/prisma/migrations
git commit -m "$(cat <<'EOF'
feat(iam): add User.mustChangePassword

Defaults to false so existing rows and the seeded demo accounts sign in
unchanged; set to true for every account an administrator creates or resets.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `UsersService` — reads and create

**Files:**
- Create: `apps/iam/src/users/users.service.ts`, `apps/iam/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `mayAssign`, `mayManage` (Task 1); the contracts from Task 2; `mustChangePassword` (Task 4); `PasswordService` from `../auth/password.service.js`; `TokenVersionStore` from `../auth/auth.service.js`; `TokenService` from `../auth/token.service.js`.
- Produces: `class UsersService` with `constructor(prisma, passwords, versions, tokens)` and, after Task 6, the methods `list`, `get`, `create`, `update`, `deactivate`, `reactivate`, `setRoles`, `resetPassword`. Task 7 wires it into Nest.

- [ ] **Step 1: Write the failing test**

Create `apps/iam/src/users/users.service.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@ipms/contracts';
import { UsersService } from './users.service.js';

const ACTOR = uuidv7();
const TARGET = uuidv7();

const ADMIN = ['SUPER_ADMIN'];
const MANAGER = ['PROJECT_MANAGER'];

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET, username: 'field.one', email: 'field.one@ipms.local',
    fullName: 'Field One', employeeCode: null, isActive: true,
    mustChangePassword: false, lastLoginAt: null, createdAt: new Date('2026-01-01T00:00:00Z'),
    roles: [{ role: { code: 'FIELD_ENGINEER', name: 'Field Engineer' } }],
    ...overrides,
  };
}

/**
 * One fake for the whole service. `$transaction` runs its callback against the
 * same `tx` the assertions read, which is what lets a test say "the audit event
 * was written in the same transaction as the update".
 */
function build(target: Record<string, unknown> | null = row(), extra: Record<string, unknown> = {}) {
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue(target),
      findUniqueOrThrow: vi.fn().mockResolvedValue(target ?? row()),
      findMany: vi.fn().mockResolvedValue([row()]),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...row(), ...data, tokenVersion: 4 })),
    },
    role: {
      findMany: vi.fn().mockImplementation(({ where }) => Promise.resolve(
        (where.code.in as string[]).map((code) => ({ id: uuidv7(), code, name: code })),
      )),
    },
    userRole: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(1),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    ...extra,
  };
  const prisma = {
    $transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    user: tx.user,
  };
  const passwords = { hash: vi.fn().mockResolvedValue('$argon2id$fake'), verify: vi.fn().mockResolvedValue(true) };
  const versions = { publish: vi.fn().mockResolvedValue(undefined) };
  const tokens = { refreshTtlSeconds: 2_592_000 };
  const service = new UsersService(prisma as never, passwords as never, versions as never, tokens as never);
  return { service, tx, prisma, passwords, versions };
}

describe('UsersService.list', () => {
  it('filters in the query, never after the fetch', async () => {
    const { service, prisma } = build();
    await service.list({ page: 1, limit: 20, status: 'ACTIVE', search: 'ann', role: 'FIELD_ENGINEER' });
    const where = prisma.user.findMany.mock.calls[0]![0].where;
    expect(where.isActive).toBe(true);
    expect(where.roles).toEqual({ some: { role: { code: 'FIELD_ENGINEER' } } });
    expect(where.OR).toHaveLength(3);
  });

  it('leaves isActive unconstrained for the ALL status', async () => {
    const { service, prisma } = build();
    await service.list({ page: 1, limit: 20, status: 'ALL' });
    expect(prisma.user.findMany.mock.calls[0]![0].where).not.toHaveProperty('isActive');
  });

  it('pages from one, not from zero', async () => {
    const { service, prisma } = build();
    await service.list({ page: 3, limit: 20, status: 'ALL' });
    expect(prisma.user.findMany.mock.calls[0]![0].skip).toBe(40);
    expect(prisma.user.findMany.mock.calls[0]![0].take).toBe(20);
  });

  it('never selects the password hash', async () => {
    const { service, prisma } = build();
    await service.list({ page: 1, limit: 20, status: 'ALL' });
    expect(prisma.user.findMany.mock.calls[0]![0].select).not.toHaveProperty('passwordHash');
  });

  it('returns the pagination envelope', async () => {
    const { service } = build();
    const result = await service.list({ page: 1, limit: 20, status: 'ALL' });
    expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(result.items[0]!.roles).toEqual([{ code: 'FIELD_ENGINEER', name: 'Field Engineer' }]);
  });
});

describe('UsersService.get', () => {
  it('reports a missing user as not found', async () => {
    const { service } = build(null);
    await expect(service.get(TARGET)).rejects.toBeInstanceOf(NotFoundException);
  });

  // Reading is not object-gated: `user.view` grants the directory, and a
  // project manager needs an administrator's name to know who to ask.
  it('returns an administrator to a project manager', async () => {
    const { service } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    await expect(service.get(TARGET)).resolves.toMatchObject({ id: TARGET });
  });
});

describe('UsersService.create', () => {
  const dto = {
    username: 'new.one', email: 'new.one@ipms.local', fullName: 'New One',
    password: 'a-long-enough-password', roleCodes: ['FIELD_ENGINEER'],
  };

  it('creates a user owing a password change', async () => {
    const { service, tx } = build(null);
    await service.create(dto, ACTOR, ADMIN);
    expect(tx.user.create.mock.calls[0]![0].data.mustChangePassword).toBe(true);
  });

  it('stores a hash, never the password', async () => {
    const { service, tx, passwords } = build(null);
    await service.create(dto, ACTOR, ADMIN);
    expect(passwords.hash).toHaveBeenCalledWith('a-long-enough-password');
    expect(tx.user.create.mock.calls[0]![0].data.passwordHash).toBe('$argon2id$fake');
    expect(tx.user.create.mock.calls[0]![0].data).not.toHaveProperty('password');
  });

  it('lets a project manager create a field engineer', async () => {
    const { service, tx } = build(null);
    await service.create(dto, ACTOR, MANAGER);
    expect(tx.user.create).toHaveBeenCalled();
  });

  it('refuses a project manager creating an administrator', async () => {
    const { service } = build(null);
    await expect(service.create({ ...dto, roleCodes: ['SUPER_ADMIN'] }, ACTOR, MANAGER))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a duplicate username, naming the field', async () => {
    const { service, tx } = build(null);
    tx.user.findUnique.mockResolvedValueOnce(row());
    await expect(service.create(dto, ACTOR, ADMIN)).rejects.toThrow(/username/i);
  });

  it('refuses a duplicate email, naming the field', async () => {
    const { service, tx } = build(null);
    tx.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
    await expect(service.create(dto, ACTOR, ADMIN)).rejects.toThrow(/email/i);
  });

  it('refuses a role code with no row behind it rather than creating a user a role short', async () => {
    const { service, tx } = build(null);
    tx.role.findMany.mockResolvedValueOnce([]);
    await expect(service.create(dto, ACTOR, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * `UserRole` carries no composite `@@unique` — the three partial indexes live
   * in the migration and Prisma cannot express them as a `where` key — so an
   * upsert has no conflict target to use. See the `UserRole` model comment.
   */
  it('writes the role assignment with create, never upsert', async () => {
    const { service, tx } = build(null);
    await service.create(dto, ACTOR, ADMIN);
    expect(tx.userRole.create).toHaveBeenCalledTimes(1);
    expect(tx.userRole).not.toHaveProperty('upsert');
    const data = tx.userRole.create.mock.calls[0]![0].data;
    expect(data.projectId).toBeUndefined();
    expect(data.createdBy).toBe(ACTOR);
  });

  it('writes an audit event carrying no password material', async () => {
    const { service, tx } = build(null);
    await service.create(dto, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls
      .map((call) => call[0].data)
      .find((data: { subject: string }) => data.subject === 'audit.event.recorded');
    expect(audit.payload.action).toBe('user.created');
    expect(JSON.stringify(audit.payload)).not.toContain('a-long-enough-password');
    expect(JSON.stringify(audit.payload)).not.toContain('argon2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run apps/iam/src/users/users.service.spec.ts
```

Expected: FAIL — `Failed to resolve import "./users.service.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/iam/src/users/users.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package — see
// the `output` comment in prisma/schema.prisma.
import type { PrismaClient } from '@prisma-clients/iam';
import { mayAssign, mayManage } from '@ipms/authz';
import {
  uuidv7,
  type CreateUserDto, type UserListQuery, type UserResponse,
} from '@ipms/contracts';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import type { PasswordService } from '../auth/password.service.js';
import type { TokenVersionStore } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Every field a user response carries, and nothing else.
 *
 * Written as an explicit `select` rather than an `include` so `passwordHash`
 * cannot reach a client: an `include` returns every scalar column, and a
 * response built by spreading that row would start leaking the hash the first
 * time someone added a field to the response shape.
 */
const USER_SELECT = {
  id: true, username: true, email: true, fullName: true, employeeCode: true,
  isActive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true,
  roles: { select: { role: { select: { code: true, name: true } } } },
} as const;

interface UserRow {
  id: string;
  username: string;
  email: string;
  fullName: string;
  employeeCode: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: Array<{ role: { code: string; name: string } }>;
}

/**
 * Deduplicated, because a user can hold the same role globally and again scoped
 * to a project — two `UserRole` rows, one authority. The object gate must see
 * each code once or a project-scoped duplicate would read as a different role.
 */
function roleCodesOf(row: UserRow): string[] {
  return [...new Set(row.roles.map((assignment) => assignment.role.code))];
}

function toResponse(row: UserRow): UserResponse {
  const seen = new Map<string, string>();
  for (const assignment of row.roles) seen.set(assignment.role.code, assignment.role.name);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.fullName,
    employeeCode: row.employeeCode,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    roles: [...seen].map(([code, name]) => ({ code, name })),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly passwords: PasswordService,
    private readonly versions: TokenVersionStore,
    private readonly tokens: TokenService,
  ) {}

  private async emit(tx: Tx, subject: string, payload: JsonObject, actorId: string): Promise<void> {
    await tx.outboxEvent.create({
      data: buildOutboxRecord(subject, payload, getCorrelationId() ?? 'unknown', actorId),
    });
  }

  private async audit(
    tx: Tx, actorId: string, action: string, objectId: string,
    previousState: JsonObject, newState: JsonObject,
  ): Promise<void> {
    await this.emit(tx, SUBJECTS.AUDIT_EVENT, {
      actorId, action, objectType: 'User', objectId, previousState, newState, details: {},
    }, actorId);
  }

  /**
   * Kills every outstanding token for a user, immediately. Same shape and same
   * ordering as `ScopesService.revokeTokens`, deliberately: the row update runs
   * inside the caller's transaction and the publish inside the same callback,
   * before commit, so a rollback leaves Redis holding a *higher* version and
   * every outstanding token refused. Publishing after commit would invert that
   * and leave a revoked token working for its full TTL.
   */
  private async revokeTokens(tx: Tx, userId: string): Promise<void> {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.versions.publish(userId, updated.tokenVersion, this.tokens.refreshTtlSeconds);
  }

  /** Resolves the role rows for a set of codes, refusing any code with no row behind it. */
  private async resolveRoles(tx: Tx, codes: string[]): Promise<Array<{ id: string; code: string; name: string }>> {
    const unique = [...new Set(codes)];
    if (unique.length === 0) return [];
    const roles = await tx.role.findMany({ where: { code: { in: unique } } });
    if (roles.length !== unique.length) {
      const found = new Set(roles.map((role) => role.code));
      const missing = unique.filter((code) => !found.has(code));
      throw new BadRequestException(`Unknown role codes: ${missing.join(', ')}`);
    }
    return roles;
  }

  private assertMayAssign(actorRoleCodes: string[], codes: string[]): void {
    for (const code of codes) {
      if (!mayAssign(actorRoleCodes, code)) {
        throw new ForbiddenException(`You may not assign the role ${code}`);
      }
    }
  }

  /**
   * Loads a user and refuses the caller if the object gate says they may not
   * touch them. Used by every write; reads deliberately do not call it.
   */
  protected async loadManageable(tx: Tx, userId: string, actorRoleCodes: string[]): Promise<UserRow> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    if (!mayManage(actorRoleCodes, roleCodesOf(user as UserRow))) {
      // 403 rather than 404: `user.view` already grants the directory, so the
      // user's existence is not a secret from this caller.
      throw new ForbiddenException('You may not manage this user');
    }
    return user as UserRow;
  }

  async list(query: UserListQuery): Promise<{ items: UserResponse[]; total: number; page: number; limit: number }> {
    // Filtering happens in the query, never after the fetch — the architecture
    // spec calls query-level enforcement mandatory, and it is what keeps this
    // endpoint from becoming an enumeration oracle.
    const where = {
      ...(query.status === 'ALL' ? {} : { isActive: query.status === 'ACTIVE' }),
      ...(query.search === undefined ? {} : {
        OR: [
          { username: { contains: query.search, mode: 'insensitive' as const } },
          { email: { contains: query.search, mode: 'insensitive' as const } },
          { fullName: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
      ...(query.role === undefined ? {} : { roles: { some: { role: { code: query.role } } } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { fullName: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: (rows as UserRow[]).map(toResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return toResponse(user as UserRow);
  }

  async create(dto: CreateUserDto, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    this.assertMayAssign(actorRoleCodes, dto.roleCodes);

    // Hashed before the transaction opens: argon2 is deliberately slow, and
    // holding a database transaction open across it would pin a connection for
    // the duration of every user creation.
    const passwordHash = await this.passwords.hash(dto.password);

    return this.prisma.$transaction(async (tx) => {
      // Checked explicitly rather than left to the unique constraint, so a
      // collision is a 400 naming the field rather than a Prisma error
      // surfacing as a 500.
      if (await tx.user.findUnique({ where: { username: dto.username } })) {
        throw new BadRequestException(`Username ${dto.username} is already in use`);
      }
      if (await tx.user.findUnique({ where: { email: dto.email } })) {
        throw new BadRequestException(`Email ${dto.email} is already in use`);
      }

      const roles = await this.resolveRoles(tx, dto.roleCodes);

      const id = uuidv7();
      await tx.user.create({
        data: {
          id,
          username: dto.username,
          email: dto.email,
          fullName: dto.fullName,
          ...(dto.employeeCode === undefined ? {} : { employeeCode: dto.employeeCode }),
          passwordHash,
          isActive: true,
          // The creator knows this password, so the account carries no
          // authority until its holder replaces it. See AuthService.login.
          mustChangePassword: true,
        },
      });

      for (const role of roles) {
        await tx.userRole.create({
          data: { id: uuidv7(), userId: id, roleId: role.id, createdBy: actorId },
        });
        await this.emit(tx, SUBJECTS.IAM_ROLE_ASSIGNED, {
          userId: id, roleCode: role.code, projectId: null, siteId: null,
        }, actorId);
      }

      await this.audit(tx, actorId, 'user.created', id, {}, {
        username: dto.username, email: dto.email, fullName: dto.fullName,
        roleCodes: roles.map((role) => role.code),
      });

      // Re-read rather than assembling the response from the write inputs: one
      // query, and it cannot drift from what the next GET will return.
      const created = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(created as UserRow);
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run apps/iam/src/users/users.service.spec.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/iam/src/users/users.service.ts apps/iam/src/users/users.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(iam): add UsersService reads and creation

Filtering is query-level, responses are built from an explicit select so the
password hash cannot leak, and a created account owes a password change because
its creator knows the credential.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `UsersService` — update, deactivate, roles, password reset

**Files:**
- Modify: `apps/iam/src/users/users.service.ts`, `apps/iam/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces: `update(id, dto, actorId, actorRoleCodes)`, `deactivate(id, actorId, actorRoleCodes)`, `reactivate(id, actorId, actorRoleCodes)`, `setRoles(id, dto, actorId, actorRoleCodes)`, `resetPassword(id, dto, actorId, actorRoleCodes)` — all returning `Promise<UserResponse>` except `deactivate`/`reactivate`, which also return `UserResponse`. Task 7 calls all five.

- [ ] **Step 1: Write the failing tests**

Append to `apps/iam/src/users/users.service.spec.ts`:

```ts
describe('UsersService.update', () => {
  it('writes the fields the caller sent', async () => {
    const { service, tx } = build();
    await service.update(TARGET, { fullName: 'Field One Renamed' }, ACTOR, ADMIN);
    expect(tx.user.update.mock.calls[0]![0].data).toEqual({ fullName: 'Field One Renamed' });
  });

  it('clears employeeCode when the caller sends null', async () => {
    const { service, tx } = build();
    await service.update(TARGET, { employeeCode: null }, ACTOR, ADMIN);
    expect(tx.user.update.mock.calls[0]![0].data.employeeCode).toBeNull();
  });

  // A profile edit changes no authority, so signing the user out would be
  // gratuitous — and would teach administrators that editing is dangerous.
  it('does not revoke the target"s sessions', async () => {
    const { service, versions } = build();
    await service.update(TARGET, { fullName: 'Renamed' }, ACTOR, ADMIN);
    expect(versions.publish).not.toHaveBeenCalled();
  });

  it('lets a project manager edit a field engineer', async () => {
    const { service, tx } = build();
    await service.update(TARGET, { fullName: 'Renamed' }, ACTOR, MANAGER);
    expect(tx.user.update).toHaveBeenCalled();
  });

  it('refuses a project manager editing an administrator', async () => {
    const { service } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    await expect(service.update(TARGET, { fullName: 'Renamed' }, ACTOR, MANAGER))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  /**
   * The ledger's canonical JSON hashes `undefined` and `null` identically, so
   * spreading the DTO would make "did not touch fullName" and "cleared
   * fullName" produce the same entry and the same hash.
   */
  it('records only the fields the caller actually sent', async () => {
    const { service, tx } = build();
    await service.update(TARGET, { fullName: 'Renamed' }, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls[0]![0].data;
    expect(Object.keys(audit.payload.newState)).toEqual(['fullName']);
  });
});

describe('UsersService.deactivate', () => {
  it('sets isActive false and revokes every outstanding token', async () => {
    const { service, tx, versions } = build();
    await service.deactivate(TARGET, ACTOR, ADMIN);
    expect(tx.user.update.mock.calls.some((call) => call[0].data.isActive === false)).toBe(true);
    expect(versions.publish).toHaveBeenCalledWith(TARGET, 4, 2_592_000);
  });

  it('announces the deactivation on the IAM stream', async () => {
    const { service, tx } = build();
    await service.deactivate(TARGET, ACTOR, ADMIN);
    const subjects = tx.outboxEvent.create.mock.calls.map((call) => call[0].data.subject);
    expect(subjects).toContain('iam.user.deactivated');
  });

  // Locking yourself out is never the intent, and reversing it needs a second
  // administrator.
  it('refuses an actor deactivating themselves', async () => {
    const { service } = build(row({ id: ACTOR }));
    await expect(service.deactivate(ACTOR, ACTOR, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to deactivate the last active administrator', async () => {
    const { service, tx } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    tx.userRole.count.mockResolvedValueOnce(0);
    await expect(service.deactivate(TARGET, ACTOR, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows deactivating an administrator while another active one remains', async () => {
    const { service, tx } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    tx.userRole.count.mockResolvedValueOnce(1);
    await expect(service.deactivate(TARGET, ACTOR, ADMIN)).resolves.toBeDefined();
  });

  it('counts only other, still-active administrators', async () => {
    const { service, tx } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    tx.userRole.count.mockResolvedValueOnce(1);
    await service.deactivate(TARGET, ACTOR, ADMIN);
    expect(tx.userRole.count.mock.calls[0]![0].where).toEqual({
      role: { code: 'SUPER_ADMIN' },
      userId: { not: TARGET },
      user: { isActive: true },
    });
  });
});

describe('UsersService.reactivate', () => {
  it('sets isActive true without touching the password', async () => {
    const { service, tx } = build(row({ isActive: false }));
    await service.reactivate(TARGET, ACTOR, ADMIN);
    expect(tx.user.update.mock.calls[0]![0].data).toEqual({ isActive: true });
  });
});

describe('UsersService.setRoles', () => {
  // Without this, role.assign is equivalent to SUPER_ADMIN.
  it('refuses an actor changing their own roles', async () => {
    const { service } = build(row({ id: ACTOR }));
    await expect(service.setRoles(ACTOR, { roleCodes: ['SUPER_ADMIN'] }, ACTOR, ADMIN))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a project manager granting a role outside their set', async () => {
    const { service } = build();
    await expect(service.setRoles(TARGET, { roleCodes: ['PROJECT_MANAGER'] }, ACTOR, MANAGER))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('replaces the global assignments with the set it was given', async () => {
    const { service, tx } = build();
    await service.setRoles(TARGET, { roleCodes: ['QC_MANAGER'] }, ACTOR, ADMIN);
    expect(tx.userRole.deleteMany.mock.calls[0]![0].where)
      .toEqual({ userId: TARGET, projectId: null, siteId: null });
    expect(tx.userRole.create).toHaveBeenCalledTimes(1);
  });

  it('accepts the empty set, leaving a user with no roles', async () => {
    const { service, tx } = build();
    await service.setRoles(TARGET, { roleCodes: [] }, ACTOR, ADMIN);
    expect(tx.userRole.deleteMany).toHaveBeenCalled();
    expect(tx.userRole.create).not.toHaveBeenCalled();
  });

  it('refuses to remove the last active administrator"s role', async () => {
    const { service, tx } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    tx.userRole.count.mockResolvedValueOnce(0);
    await expect(service.setRoles(TARGET, { roleCodes: ['VIEWER'] }, ACTOR, ADMIN))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // The permission claim is resolved at issuance, so a role change that does
  // not revoke leaves the old authority live for the access token's full TTL.
  it('revokes the target"s tokens', async () => {
    const { service, versions } = build();
    await service.setRoles(TARGET, { roleCodes: ['QC_MANAGER'] }, ACTOR, ADMIN);
    expect(versions.publish).toHaveBeenCalledWith(TARGET, 4, 2_592_000);
  });

  it('records the previous and the next set', async () => {
    const { service, tx } = build();
    await service.setRoles(TARGET, { roleCodes: ['QC_MANAGER'] }, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls
      .map((call) => call[0].data)
      .find((data: { subject: string }) => data.subject === 'audit.event.recorded');
    expect(audit.payload.action).toBe('user.roles_changed');
    expect(audit.payload.previousState).toEqual({ roleCodes: ['FIELD_ENGINEER'] });
    expect(audit.payload.newState).toEqual({ roleCodes: ['QC_MANAGER'] });
  });
});

describe('UsersService.resetPassword', () => {
  it('stores a new hash, sets the change flag, and revokes tokens', async () => {
    const { service, tx, passwords, versions } = build();
    await service.resetPassword(TARGET, { password: 'another-long-password' }, ACTOR, ADMIN);
    expect(passwords.hash).toHaveBeenCalledWith('another-long-password');
    const data = tx.user.update.mock.calls.find((call) => call[0].data.passwordHash)![0].data;
    expect(data.passwordHash).toBe('$argon2id$fake');
    expect(data.mustChangePassword).toBe(true);
    expect(versions.publish).toHaveBeenCalled();
  });

  it('refuses a project manager resetting an administrator"s password', async () => {
    const { service } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    await expect(service.resetPassword(TARGET, { password: 'another-long-password' }, ACTOR, MANAGER))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes no password material into the audit entry', async () => {
    const { service, tx } = build();
    await service.resetPassword(TARGET, { password: 'another-long-password' }, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls
      .map((call) => call[0].data)
      .find((data: { subject: string }) => data.subject === 'audit.event.recorded');
    expect(audit.payload.action).toBe('user.password_reset');
    expect(JSON.stringify(audit.payload)).not.toContain('another-long-password');
    expect(JSON.stringify(audit.payload)).not.toContain('argon2');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run apps/iam/src/users/users.service.spec.ts
```

Expected: FAIL — `service.update is not a function`, and similar for the other four.

- [ ] **Step 3: Add the imports**

In `apps/iam/src/users/users.service.ts`, extend the contracts import:

```ts
import {
  uuidv7,
  type AssignRolesDto, type CreateUserDto, type ResetPasswordDto,
  type UpdateUserDto, type UserListQuery, type UserResponse,
} from '@ipms/contracts';
```

- [ ] **Step 4: Add the last-administrator guard**

Add as a private method on `UsersService`, below `resolveRoles`:

```ts
  /**
   * Refuses a change that would leave the platform with no active
   * administrator.
   *
   * The count runs inside the caller's transaction, which is what makes it
   * true rather than merely likely: two concurrent demotions each reading a
   * committed count of two would otherwise both see a survivor and both
   * commit, leaving none.
   *
   * `next` is the role set the target will hold afterwards, or `'DEACTIVATE'`
   * when they will hold the same roles but no longer be active.
   */
  private async assertAdminSurvives(
    tx: Tx, userId: string, currentRoleCodes: string[], next: string[] | 'DEACTIVATE',
  ): Promise<void> {
    if (!currentRoleCodes.includes('SUPER_ADMIN')) return;
    if (next !== 'DEACTIVATE' && next.includes('SUPER_ADMIN')) return;

    const remaining = await tx.userRole.count({
      where: { role: { code: 'SUPER_ADMIN' }, userId: { not: userId }, user: { isActive: true } },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        'This is the last active super administrator; promote another account first',
      );
    }
  }
```

- [ ] **Step 5: Add the five methods**

Append inside the `UsersService` class, after `create`:

```ts
  async update(id: string, dto: UpdateUserDto, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.loadManageable(tx, id, actorRoleCodes);

      // Only the fields the caller actually sent, in the write and in the
      // ledger alike — see RolesService.update for why the audit entry cannot
      // simply spread the DTO.
      const data: JsonObject = {};
      if (dto.email !== undefined) data['email'] = dto.email;
      if (dto.fullName !== undefined) data['fullName'] = dto.fullName;
      if (dto.employeeCode !== undefined) data['employeeCode'] = dto.employeeCode;

      if (dto.email !== undefined && dto.email !== existing.email) {
        const clash = await tx.user.findUnique({ where: { email: dto.email } });
        if (clash) throw new BadRequestException(`Email ${dto.email} is already in use`);
      }

      await tx.user.update({ where: { id }, data: data as never });

      const previousState: JsonObject = {};
      if (dto.email !== undefined) previousState['email'] = existing.email;
      if (dto.fullName !== undefined) previousState['fullName'] = existing.fullName;
      if (dto.employeeCode !== undefined) previousState['employeeCode'] = existing.employeeCode;

      await this.audit(tx, actorId, 'user.updated', id, previousState, data);

      // No token revocation: a profile edit changes no authority.
      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }

  async deactivate(id: string, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    if (id === actorId) {
      throw new ForbiddenException('An actor cannot deactivate their own account');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.loadManageable(tx, id, actorRoleCodes);
      await this.assertAdminSurvives(tx, id, roleCodesOf(existing), 'DEACTIVATE');

      await tx.user.update({ where: { id }, data: { isActive: false } });
      // The account is refused at login from here, but a live access token
      // would still be honoured for its full TTL without this.
      await this.revokeTokens(tx, id);

      await this.emit(tx, SUBJECTS.IAM_USER_DEACTIVATED, { userId: id }, actorId);
      await this.audit(tx, actorId, 'user.deactivated', id, { isActive: true }, { isActive: false });

      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }

  async reactivate(id: string, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.loadManageable(tx, id, actorRoleCodes);

      // Deliberately does not clear `mustChangePassword`: if the account was
      // deactivated while it still owed a change, it owes it on return.
      await tx.user.update({ where: { id }, data: { isActive: true } });
      await this.audit(tx, actorId, 'user.reactivated', id, { isActive: false }, { isActive: true });

      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }

  async setRoles(id: string, dto: AssignRolesDto, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    // Checked before anything is loaded: this is the privilege-escalation path,
    // and `role.assign` without it is equivalent to SUPER_ADMIN.
    if (id === actorId) {
      throw new ForbiddenException('An actor cannot change their own roles');
    }
    this.assertMayAssign(actorRoleCodes, dto.roleCodes);

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.loadManageable(tx, id, actorRoleCodes);
      const previousCodes = roleCodesOf(existing);
      await this.assertAdminSurvives(tx, id, previousCodes, dto.roleCodes);

      const roles = await this.resolveRoles(tx, dto.roleCodes);

      // Global assignments only. Project- and site-scoped rows are granted
      // through ScopesController and are not this endpoint's to replace.
      await tx.userRole.deleteMany({ where: { userId: id, projectId: null, siteId: null } });
      for (const role of roles) {
        await tx.userRole.create({
          data: { id: uuidv7(), userId: id, roleId: role.id, createdBy: actorId },
        });
      }

      for (const code of previousCodes.filter((c) => !dto.roleCodes.includes(c))) {
        await this.emit(tx, SUBJECTS.IAM_ROLE_REMOVED, { userId: id, roleCode: code, projectId: null, siteId: null }, actorId);
      }
      for (const code of dto.roleCodes.filter((c) => !previousCodes.includes(c))) {
        await this.emit(tx, SUBJECTS.IAM_ROLE_ASSIGNED, { userId: id, roleCode: code, projectId: null, siteId: null }, actorId);
      }

      // The permissions claim is resolved at issuance, so without this the old
      // authority stays live for the access token's full TTL.
      await this.revokeTokens(tx, id);
      await this.audit(tx, actorId, 'user.roles_changed', id,
        { roleCodes: previousCodes }, { roleCodes: dto.roleCodes });

      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }

  async resetPassword(
    id: string, dto: ResetPasswordDto, actorId: string, actorRoleCodes: string[],
  ): Promise<UserResponse> {
    const passwordHash = await this.passwords.hash(dto.password);

    return this.prisma.$transaction(async (tx) => {
      await this.loadManageable(tx, id, actorRoleCodes);

      await tx.user.update({
        where: { id },
        // The actor now knows this password, so the account owes a change
        // exactly as a freshly created one does.
        data: { passwordHash, mustChangePassword: true },
      });
      await this.revokeTokens(tx, id);

      // No password, hash, or derivative of either reaches the ledger.
      await this.audit(tx, actorId, 'user.password_reset', id, {}, { mustChangePassword: true });

      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm vitest run apps/iam/src/users/users.service.spec.ts
```

Expected: PASS, 37 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/iam/src/users/users.service.ts apps/iam/src/users/users.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(iam): add user update, deactivation, role assignment and password reset

Three refusals apply to every actor including an administrator: no deactivating
yourself, no re-roling yourself, and the last active super administrator cannot
be deactivated or demoted. Role changes and password resets revoke the target's
tokens; a profile edit does not, because it changes no authority.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `UsersController` and Nest wiring

**Files:**
- Create: `apps/iam/src/users/users.controller.ts`, `apps/iam/src/users/users.controller.spec.ts`
- Modify: `apps/iam/src/app.module.ts`

**Interfaces:**
- Consumes: `UsersService` (Tasks 5–6), the contracts from Task 2.
- Produces: the eight HTTP routes. Task 11's `user-api.ts` calls them.

- [ ] **Step 1: Write the failing test**

Create `apps/iam/src/users/users.controller.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { UsersController } from './users.controller.js';

const ID = uuidv7();
const ACTOR = uuidv7();

function build() {
  const users = {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    get: vi.fn().mockResolvedValue({ id: ID }),
    create: vi.fn().mockResolvedValue({ id: ID }),
    update: vi.fn().mockResolvedValue({ id: ID }),
    deactivate: vi.fn().mockResolvedValue({ id: ID }),
    reactivate: vi.fn().mockResolvedValue({ id: ID }),
    setRoles: vi.fn().mockResolvedValue({ id: ID }),
    resetPassword: vi.fn().mockResolvedValue({ id: ID }),
  };
  return { controller: new UsersController(users as never), users };
}

const req = { user: { id: ACTOR, roles: ['SUPER_ADMIN'], permissions: [], tokenVersion: 0, isActive: true } };

/** The decorator is the enforcement; a route that loses it is silently public to any signed-in caller. */
function permissionOf(method: keyof UsersController): string {
  return Reflect.getMetadata(PERMISSION_KEY, UsersController.prototype[method] as never)?.permission;
}

describe('UsersController permissions', () => {
  it('guards every route with the permission the catalog defines for it', () => {
    expect(permissionOf('list')).toBe('user.view');
    expect(permissionOf('get')).toBe('user.view');
    expect(permissionOf('create')).toBe('user.create');
    expect(permissionOf('update')).toBe('user.update');
    expect(permissionOf('deactivate')).toBe('user.deactivate');
    expect(permissionOf('reactivate')).toBe('user.update');
    expect(permissionOf('setRoles')).toBe('role.assign');
    expect(permissionOf('resetPassword')).toBe('user.update');
  });
});

describe('UsersController parsing', () => {
  it('coerces the list query a query string delivers as text', async () => {
    const { controller, users } = build();
    await controller.list({ page: '2', limit: '10', status: 'ACTIVE' });
    expect(users.list).toHaveBeenCalledWith({ page: 2, limit: 10, status: 'ACTIVE' });
  });

  it('passes the actor id and roles through to the service', async () => {
    const { controller, users } = build();
    await controller.create({
      username: 'new.one', email: 'new.one@ipms.local', fullName: 'New One',
      password: 'a-long-enough-password', roleCodes: ['FIELD_ENGINEER'],
    }, req);
    expect(users.create.mock.calls[0]![1]).toBe(ACTOR);
    expect(users.create.mock.calls[0]![2]).toEqual(['SUPER_ADMIN']);
  });

  it('refuses a malformed id rather than passing it to the database', async () => {
    const { controller } = build();
    await expect(controller.get('not-a-uuid')).rejects.toThrow();
  });

  it('refuses a body the schema rejects', async () => {
    const { controller } = build();
    await expect(controller.create({ username: 'x' }, req)).rejects.toThrow();
  });

  it('strips a client-supplied isActive rather than honouring it', async () => {
    const { controller, users } = build();
    await controller.create({
      username: 'new.one', email: 'new.one@ipms.local', fullName: 'New One',
      password: 'a-long-enough-password', roleCodes: [], isActive: false,
    }, req);
    expect(users.create.mock.calls[0]![0]).not.toHaveProperty('isActive');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run apps/iam/src/users/users.controller.spec.ts
```

Expected: FAIL — `Failed to resolve import "./users.controller.js"`.

- [ ] **Step 3: Write the controller**

Create `apps/iam/src/users/users.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import type { AuthzUser } from '@ipms/authz';
import {
  AssignRolesSchema, CreateUserSchema, ResetPasswordSchema,
  UpdateUserSchema, UserListQuerySchema, UuidSchema,
} from '@ipms/contracts';
import { UsersService } from './users.service.js';

/**
 * The object gate — which users this actor may touch — is applied in
 * `UsersService`, not here. The actor's roles are passed down rather than
 * decided here so a future caller reaching the service directly cannot bypass
 * it, and so the rule has exactly one implementation.
 */
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermission('user.view')
  async list(@Query() query: unknown) {
    return this.users.list(UserListQuerySchema.parse(query));
  }

  /**
   * Not object-gated: `user.view` grants the directory, and a project manager
   * needs an administrator's name to know who to ask. What they cannot do is
   * change one.
   */
  @Get('users/:id')
  @RequirePermission('user.view')
  async get(@Param('id') id: string) {
    return this.users.get(UuidSchema.parse(id));
  }

  @Post('users')
  @RequirePermission('user.create')
  async create(@Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.users.create(CreateUserSchema.parse(body), req.user.id, req.user.roles);
  }

  @Patch('users/:id')
  @RequirePermission('user.update')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.users.update(UuidSchema.parse(id), UpdateUserSchema.parse(body), req.user.id, req.user.roles);
  }

  /**
   * Deactivates. There is no hard-delete route and no `user.delete`
   * permission: audit entries, task assignees and QC submissions all reference
   * user ids, and a removed row turns every one of them into an unresolvable
   * reference.
   */
  @Delete('users/:id')
  @RequirePermission('user.deactivate')
  async deactivate(@Param('id') id: string, @Req() req: { user: AuthzUser }) {
    return this.users.deactivate(UuidSchema.parse(id), req.user.id, req.user.roles);
  }

  @Post('users/:id/reactivate')
  @RequirePermission('user.update')
  async reactivate(@Param('id') id: string, @Req() req: { user: AuthzUser }) {
    return this.users.reactivate(UuidSchema.parse(id), req.user.id, req.user.roles);
  }

  /** PUT, not PATCH: the body is the complete desired set, so the write is idempotent. */
  @Put('users/:id/roles')
  @RequirePermission('role.assign')
  async setRoles(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.users.setRoles(UuidSchema.parse(id), AssignRolesSchema.parse(body), req.user.id, req.user.roles);
  }

  @Post('users/:id/reset-password')
  @RequirePermission('user.update')
  async resetPassword(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.users.resetPassword(UuidSchema.parse(id), ResetPasswordSchema.parse(body), req.user.id, req.user.roles);
  }
}
```

- [ ] **Step 4: Register it in the module**

In `apps/iam/src/app.module.ts`:

Add the imports beside the existing controller/service imports:

```ts
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';
```

Add `UsersController` to the `controllers` array, after `RolesController`:

```ts
  controllers: [AuthController, UsersController, RolesController, ScopesController, EffectiveController, HealthController, MetricsController],
```

Add the provider after the `RolesService` entry:

```ts
    {
      // A factory with an explicit `inject` list, like every service here: the
      // constructor's `import type` parameters are erased, so a bare class
      // entry would leave Nest with an unresolvable token at bootstrap.
      provide: UsersService,
      useFactory: (
        prisma: PrismaService, passwords: PasswordService,
        versions: TokenVersionStore, tokens: TokenService,
      ) => new UsersService(prisma.db as never, passwords, versions, tokens),
      inject: [PrismaService, PasswordService, TOKEN_VERSIONS, TokenService],
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm vitest run apps/iam && pnpm --filter iam typecheck
```

Expected: PASS — the new controller tests, plus `app.module.spec.ts` still green.

- [ ] **Step 6: Commit**

```bash
git add apps/iam/src/users/users.controller.ts apps/iam/src/users/users.controller.spec.ts apps/iam/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(iam): expose the users module over HTTP

The gateway already allowlists /api/v1/users, so these routes become reachable
with no gateway change. DELETE deactivates; no hard-delete route exists.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: The forced password change

**Files:**
- Modify: `apps/iam/src/auth/token.service.ts`, `apps/iam/src/auth/auth.service.ts`, `apps/iam/src/auth/auth.controller.ts`
- Test: `apps/iam/src/auth/auth.service.spec.ts`, `apps/iam/src/auth/token.service.spec.ts`, `apps/iam/src/auth/auth.controller.spec.ts` (all append)

**Interfaces:**
- Consumes: the claim plumbing from Task 3, the column from Task 4.
- Produces: `TokenService.issue(user, roles, permissions, mustChangePassword?)`, `AuthService.changePassword(userId, dto)`, `POST /auth/change-password`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/iam/src/auth/auth.service.spec.ts`:

```ts
describe('AuthService and mustChangePassword', () => {
  /**
   * The creator of an account knows its password, so the account must carry no
   * authority until its holder replaces it. Minting an empty claim is what
   * makes that an enforced rule rather than a browser-side suggestion: every
   * AuthzGuard in the platform already refuses a permission that is not in the
   * claim, so no new enforcement code exists to be forgotten.
   */
  it('issues a token with no roles and no permissions', async () => {
    // Arrange a user row with mustChangePassword: true and a live role
    // assignment that would otherwise produce permissions, using this file's
    // existing fake-prisma helper. Then:
    //   const pair = await service.login({ username, password });
    //   const claims = verifyToken(pair.accessToken, SECRET, 'access');
    //   expect(claims.roles).toEqual([]);
    //   expect(claims.permissions).toEqual([]);
    //   expect(claims.mustChangePassword).toBe(true);
  });

  it('reports the flag on the pair so the browser can redirect at login', async () => {
    //   expect(pair.mustChangePassword).toBe(true);
  });

  it('keeps the branch on refresh, so the token cannot be rolled forward into a real one', async () => {
    //   const refreshed = await service.refresh(pair.refreshToken);
    //   expect(verifyToken(refreshed.accessToken, SECRET, 'access').permissions).toEqual([]);
  });

  it('issues a normal token once the flag is clear', async () => {
    //   expect(claims.permissions).toContain('project.view');
    //   expect(claims.mustChangePassword).toBeUndefined();
  });
});

describe('AuthService.changePassword', () => {
  it('refuses a wrong current password without touching the row', async () => {
    //   passwords.verify.mockResolvedValueOnce(false);
    //   await expect(service.changePassword(id, { currentPassword: 'wrong', newPassword: 'a-long-enough-one' }))
    //     .rejects.toBeInstanceOf(UnauthorizedException);
    //   expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses a new password identical to the current one', async () => {
    //   await expect(service.changePassword(id, { currentPassword: 'same-long-password', newPassword: 'same-long-password' }))
    //     .rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores the new hash and clears the flag', async () => {
    //   expect(prisma.user.update.mock.calls[0]![0].data)
    //     .toMatchObject({ passwordHash: '$argon2id$fake', mustChangePassword: false });
  });

  // The bump kills the caller's own token, which is the point: the next sign-in
  // is the only way to obtain one carrying their real permissions.
  it('revokes every outstanding session', async () => {
    //   expect(versions.publish).toHaveBeenCalled();
  });
});
```

> **Note for the implementer:** replace each commented body with real code built on the fakes already defined at the top of `auth.service.spec.ts`. Read that file first; it already constructs a `PrismaClient` fake, a `PasswordService` fake, a real `TokenService` with a known secret, and a `TokenVersionStore` fake. Reuse them — do not add a second set.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run apps/iam/src/auth
```

Expected: FAIL — `service.changePassword is not a function`, and the login tests reporting real permissions where the empty claim is expected.

- [ ] **Step 3: Let `TokenService` carry the flag**

In `apps/iam/src/auth/token.service.ts`, replace `issue`:

```ts
  issue(
    user: { id: string; tokenVersion: number },
    roles: string[],
    permissions: string[],
    mustChangePassword = false,
  ): TokenPair {
    const claims = {
      sub: user.id, roles, permissions, tokenVersion: user.tokenVersion,
      // Spread conditionally so an ordinary token's claims are byte-identical
      // to what they were before this field existed.
      ...(mustChangePassword ? { mustChangePassword: true } : {}),
    };
    return {
      accessToken: signToken(claims, 'access', this.config.secret, this.config.accessTtl),
      refreshToken: signToken(claims, 'refresh', this.config.secret, this.config.refreshTtl),
      expiresIn: this.config.accessTtl,
      ...(mustChangePassword ? { mustChangePassword: true } : {}),
    };
  }
```

- [ ] **Step 4: Branch in `AuthService`**

In `apps/iam/src/auth/auth.service.ts`, add `BadRequestException` to the `@nestjs/common` import and `ChangePasswordDto` to the contracts import, then replace `issue`:

```ts
  private async issue(
    user: { id: string; tokenVersion: number },
    roles: string[],
    permissions: string[],
    mustChangePassword = false,
  ): Promise<TokenPair> {
    await this.versions.publish(user.id, user.tokenVersion, this.tokens.refreshTtlSeconds);
    return this.tokens.issue(user, roles, permissions, mustChangePassword);
  }
```

In `login`, replace the last two lines of the method:

```ts
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });

    /**
     * An account that owes a password change gets a token with no roles and no
     * permissions.
     *
     * The creator of the account — or the administrator who reset it — knows
     * this password, so the account must be unusable until its holder replaces
     * it. Every service's `AuthzGuard` already refuses a permission absent from
     * the claim, so an empty claim disables every guarded route in the platform
     * with no new enforcement code anywhere. `GET /auth/me` and
     * `POST /auth/change-password` need authentication but no permission, which
     * is exactly the surface the holder needs to fix it.
     */
    if (user.mustChangePassword) return this.issue(user, [], [], true);

    const { roles, permissions } = this.claimsFor(user as never, now);
    return this.issue(user, roles, permissions);
```

> Move the existing `const { roles, permissions } = this.claimsFor(...)` line below the branch, as shown — leaving it above merely wastes the work, but keeping the order shown makes the branch's intent obvious.

In `refresh`, apply the same branch immediately before its `claimsFor` call:

```ts
    // Same branch as login: a refresh must not roll an authority-free token
    // forward into a real one.
    if (user.mustChangePassword) return this.issue(user, [], [], true);
```

Then add the new method after `revokeAll`:

```ts
  /**
   * Self-service password change. Requires authentication but no permission,
   * which is what keeps it reachable by a holder whose token carries neither.
   *
   * Ends by revoking every session, including the caller's own. That is
   * deliberate: their current token carries no authority, and signing in again
   * is the only way to obtain one that does.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException(GENERIC_FAILURE);

    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('The new password must differ from the current one');
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    await this.revokeAll(userId);
  }
```

- [ ] **Step 5: Add the endpoint**

In `apps/iam/src/auth/auth.controller.ts`, add `ChangePasswordSchema` to the contracts import and the route after `logout`:

```ts
  /**
   * Authenticated but unguarded by any permission, on purpose: the caller's
   * token carries none while they owe a change, and this is the one route that
   * lets them out of that state.
   */
  @Post('change-password')
  async changePassword(@Body() body: unknown, @Req() req: { user?: AuthzUser }): Promise<{ status: 'ok' }> {
    if (!req.user) throw new UnauthorizedException('Authentication required');
    await this.auth.changePassword(req.user.id, ChangePasswordSchema.parse(body));
    return { status: 'ok' };
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm vitest run apps/iam && pnpm --filter iam typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/iam/src/auth
git commit -m "$(cat <<'EOF'
feat(iam): make a created or reset account powerless until its password changes

While mustChangePassword is set, login and refresh mint a token with no roles
and no permissions, so every existing AuthzGuard refuses it. /auth/me and the
new /auth/change-password need authentication but no permission, which is the
only surface the holder needs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Grant project managers their new authority

**Files:**
- Modify: `apps/iam/prisma/seed.ts`
- Test: `apps/iam/prisma/seed.integration.spec.ts` (append)

**Interfaces:**
- Consumes: Task 1's table (as documentation of intent; the seed does not import it).
- Produces: nothing new in code — this is what makes the whole feature reachable by a project manager.

- [ ] **Step 1: Write the failing test**

Append to `apps/iam/prisma/seed.integration.spec.ts`, inside the existing suite that has a seeded database:

```ts
it('gives a project manager authority over users but not over roles', async () => {
  const role = await prisma.role.findUniqueOrThrow({
    where: { code: 'PROJECT_MANAGER' },
    include: { permissions: { include: { permission: true } } },
  });
  const codes = role.permissions.map((rp) => rp.permission.code);

  expect(codes).toContain('user.create');
  expect(codes).toContain('user.update');
  expect(codes).toContain('user.deactivate');
  expect(codes).toContain('role.assign');
  // The object gate is what stops a project manager minting an administrator;
  // being unable to *edit a role's permissions* is a separate guarantee, and
  // this is it.
  expect(codes).not.toContain('role.create');
  expect(codes).not.toContain('role.update');
});

it('gives QC managers and field engineers no authority over users', async () => {
  for (const code of ['QC_MANAGER', 'FIELD_ENGINEER']) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code },
      include: { permissions: { include: { permission: true } } },
    });
    const codes = role.permissions.map((rp) => rp.permission.code);
    expect(codes).not.toContain('user.create');
    expect(codes).not.toContain('role.assign');
  }
});
```

> Read `seed.integration.spec.ts` first and place these inside its existing `describe`, reusing its `prisma` handle — do not start a second container.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run apps/iam/prisma/seed.integration.spec.ts
```

Expected: FAIL — `expected [...] to contain 'user.create'`.

> This test starts a PostgreSQL container via Testcontainers and can take a couple of minutes on a cold image pull. Docker must be running.

- [ ] **Step 3: Extend the grant**

In `apps/iam/prisma/seed.ts`, in the `PROJECT_MANAGER` entry of `SYSTEM_ROLES`, replace the final line of its `permissions` array:

```ts
      'qc_evidence.export', 'audit.view', 'user.view', 'scope.view',
      // Managing their own team: creating field engineers and QC managers, and
      // editing or deactivating the people they created. Which roles they may
      // actually confer is not decided here — the permission is only the verb.
      // ROLE_ASSIGNMENT in @ipms/authz is the object gate, and it lets a
      // project manager reach FIELD_ENGINEER and QC_MANAGER and nothing else.
      'user.create', 'user.update', 'user.deactivate', 'role.assign',
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run apps/iam/prisma/seed.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/iam/prisma/seed.ts apps/iam/prisma/seed.integration.spec.ts
git commit -m "$(cat <<'EOF'
feat(iam): let project managers manage their own team

The permission is only the verb. ROLE_ASSIGNMENT in @ipms/authz is what keeps a
project manager to field engineers and QC managers; role.create and role.update
remain withheld, so they cannot widen a role instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: The last-administrator rule, against a real database

**Files:**
- Create: `apps/iam/prisma/last-super-admin.integration.spec.ts`

**Interfaces:**
- Consumes: `UsersService` (Task 6), the migration (Task 4), the seed (Task 9).
- Produces: nothing consumed by later tasks.

**Why this exists:** `assertAdminSurvives` depends on a count taken inside a transaction. A unit test with a fake `$transaction` proves the count is *requested*, not that it is *isolated* — and isolation is the whole rule. `user-role-unique.integration.spec.ts` exists for exactly this reason and is the template.

- [ ] **Step 1: Write the failing test**

Create `apps/iam/prisma/last-super-admin.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
// This app's own generated client — see the `output` comment in schema.prisma.
import { PrismaClient } from '@prisma-clients/iam';
import { uuidv7 } from '@ipms/contracts';
import { UsersService } from '../src/users/users.service.js';
import { seedIam } from './seed.js';

/**
 * The last-active-administrator rule is the one guarantee in this module that a
 * unit test cannot establish. It depends on a count taken inside the mutating
 * transaction: with a fake `$transaction`, a test can only prove the count was
 * requested, never that it was isolated — and isolation is the rule.
 */

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: UsersService;
let superAdminRoleId: string;
let viewerRoleId: string;

const ACTOR = uuidv7();
const ADMIN_ROLES = ['SUPER_ADMIN'];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // `new URL(..., import.meta.url).pathname` can come back percent-encoded on
    // macOS; fileURLToPath decodes correctly.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });
  await seedIam(prisma);

  superAdminRoleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } })).id;
  viewerRoleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'VIEWER' } })).id;

  service = new UsersService(
    prisma as never,
    { hash: vi.fn().mockResolvedValue('$argon2id$fake'), verify: vi.fn() } as never,
    { publish: vi.fn().mockResolvedValue(undefined) } as never,
    { refreshTtlSeconds: 2_592_000 } as never,
  );
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.userRole.deleteMany({});
  await prisma.outboxEvent.deleteMany({});
  await prisma.user.deleteMany({});
});

async function makeUser(username: string, roleId: string, isActive = true): Promise<string> {
  const id = uuidv7();
  await prisma.user.create({
    data: {
      id, username, email: `${username}@ipms.local`, fullName: username,
      passwordHash: 'not-a-real-hash', isActive,
    },
  });
  await prisma.userRole.create({ data: { id: uuidv7(), userId: id, roleId, createdBy: ACTOR } });
  return id;
}

describe('the last active super administrator', () => {
  it('cannot be deactivated', async () => {
    const only = await makeUser('only.admin', superAdminRoleId);
    await expect(service.deactivate(only, ACTOR, ADMIN_ROLES)).rejects.toThrow(/last active super administrator/i);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: only } })).isActive).toBe(true);
  });

  it('cannot be demoted', async () => {
    const only = await makeUser('only.admin', superAdminRoleId);
    await expect(service.setRoles(only, { roleCodes: ['VIEWER'] }, ACTOR, ADMIN_ROLES))
      .rejects.toThrow(/last active super administrator/i);
    const roles = await prisma.userRole.findMany({ where: { userId: only } });
    expect(roles).toHaveLength(1);
    expect(roles[0]!.roleId).toBe(superAdminRoleId);
  });

  it('can be deactivated once a second active administrator exists', async () => {
    const first = await makeUser('first.admin', superAdminRoleId);
    await makeUser('second.admin', superAdminRoleId);
    await expect(service.deactivate(first, ACTOR, ADMIN_ROLES)).resolves.toBeDefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first } })).isActive).toBe(false);
  });

  // An inactive administrator is not a survivor: nobody can sign in as them.
  it('does not count a deactivated administrator as the survivor', async () => {
    const active = await makeUser('active.admin', superAdminRoleId);
    await makeUser('retired.admin', superAdminRoleId, false);
    await expect(service.deactivate(active, ACTOR, ADMIN_ROLES)).rejects.toThrow(/last active super administrator/i);
  });

  it('leaves no partial write behind when it refuses', async () => {
    const only = await makeUser('only.admin', superAdminRoleId);
    await expect(service.setRoles(only, { roleCodes: ['VIEWER'] }, ACTOR, ADMIN_ROLES)).rejects.toThrow();
    // The refusal aborts the transaction, so neither the role replacement nor
    // the tokenVersion bump that precedes the audit write may survive.
    expect(await prisma.userRole.count({ where: { userId: only, roleId: viewerRoleId } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: only } })).tokenVersion).toBe(0);
  });
});

describe('an ordinary administrator', () => {
  it('can be demoted while another remains, and the audit entry records both sets', async () => {
    const first = await makeUser('first.admin', superAdminRoleId);
    await makeUser('second.admin', superAdminRoleId);
    await service.setRoles(first, { roleCodes: ['VIEWER'] }, ACTOR, ADMIN_ROLES);

    const roles = await prisma.userRole.findMany({ where: { userId: first } });
    expect(roles).toHaveLength(1);
    expect(roles[0]!.roleId).toBe(viewerRoleId);

    const audit = await prisma.outboxEvent.findFirst({
      where: { subject: 'audit.event.recorded' }, orderBy: { createdAt: 'desc' },
    });
    expect((audit!.payload as { action: string }).action).toBe('user.roles_changed');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails, then passes**

```bash
pnpm vitest run apps/iam/prisma/last-super-admin.integration.spec.ts
```

Expected: PASS on the first run, because Task 6 already implemented the rule. **If any test fails, the rule is wrong — fix `users.service.ts`, not the test.** The "leaves no partial write behind" case is the one most likely to expose a real defect: it fails if `assertAdminSurvives` is called after the write rather than before.

- [ ] **Step 3: Commit**

```bash
git add apps/iam/prisma/last-super-admin.integration.spec.ts
git commit -m "$(cat <<'EOF'
test(iam): prove the last-administrator rule against a real database

The rule depends on a count taken inside the mutating transaction; a fake
$transaction can only show the count was requested, never that it was isolated.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Share the web form helpers and add the users API wrapper

**Files:**
- Move: `apps/web/app/projects/settle.ts` → `apps/web/app/lib/settle.ts`; `apps/web/app/projects/form-state.ts` → `apps/web/app/lib/form-state.ts`
- Modify: every file importing them
- Create: `apps/web/app/lib/user-api.ts`

**Interfaces:**
- Consumes: Task 2's contracts (type-only), Task 7's routes.
- Produces: `settle`, `optional`, `clearable` at `app/lib/settle`; `FormState`, `EMPTY` at `app/lib/form-state`; and `listUsers`, `getUser`, `createUser`, `updateUser`, `deactivateUser`, `reactivateUser`, `setUserRoles`, `resetUserPassword`, `listRoles`, `changePassword`, plus the `User`, `UserRoleSummary` and `Role` interfaces at `app/lib/user-api`. Tasks 12–14 use all of them.

- [ ] **Step 1: Move the two helpers**

```bash
git mv apps/web/app/projects/settle.ts apps/web/app/lib/settle.ts
git mv apps/web/app/projects/form-state.ts apps/web/app/lib/form-state.ts
```

- [ ] **Step 2: Repair the imports**

In `apps/web/app/lib/settle.ts`, the two relative imports move up a directory:

```ts
import type { ApiResult } from './api-client';
import { EMPTY, type FormState } from './form-state';
```

Find every remaining importer and update it:

```bash
grep -rln "from '\./settle'\|from '\./form-state'\|from '\.\./settle'\|from '\.\./form-state'" apps/web/app
```

Each match under `app/projects/` becomes `'../lib/settle'` / `'../lib/form-state'`, and one directory deeper (`app/projects/[id]/sites/import/`) becomes `'../../../../lib/settle'`. Count the segments per file; do not guess.

- [ ] **Step 3: Verify nothing broke**

```bash
pnpm vitest run apps/web && pnpm --filter web typecheck
```

Expected: PASS, with `apps/web/app/projects/actions.spec.ts` green — note that this file imports `./settle`, so its import moves too.

- [ ] **Step 4: Commit the move on its own**

A pure move committed separately keeps the next diff readable.

```bash
git add -A apps/web/app
git commit -m "$(cat <<'EOF'
refactor(web): move the form helpers to app/lib

They are feature-agnostic; they sat under projects/ only because projects was
the first feature to need them. User management is the second, and it should
not import across a sibling feature directory.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Write the API wrapper**

Create `apps/web/app/lib/user-api.ts`:

```ts
import 'server-only';
import type {
  AssignRolesDto, ChangePasswordDto, CreateUserDto,
  ResetPasswordDto, UpdateUserDto, UserStatusFilter,
} from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * The users surface of `iam`, as reached through the gateway.
 *
 * Request shapes come from `@ipms/contracts` — the same schemas the service
 * parses with — so a field renamed there stops this app compiling rather than
 * producing a 422 at runtime. The imports are type-only on purpose: the
 * contracts barrel pulls in `node:crypto` and zod, which have no business in
 * this app's bundle when only the shapes are needed.
 *
 * Response shapes are written as the wire sees them: `DateTime` arrives as an
 * ISO string, because that is what JSON.stringify makes of it.
 */

export interface UserRoleSummary { code: string; name: string }

export interface User {
  id: string;
  username: string;
  email: string;
  fullName: string;
  employeeCode: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: UserRoleSummary[];
}

export interface UserPage { items: User[]; total: number; page: number; limit: number }

/** The slice of `RolesController`'s response the assignment controls need. */
export interface Role { id: string; code: string; name: string; isActive: boolean }

export interface UserFilters {
  search?: string | undefined;
  status?: UserStatusFilter | undefined;
  role?: string | undefined;
  page?: number | undefined;
}

export async function listUsers(filters: UserFilters = {}): Promise<ApiResult<UserPage>> {
  return authFetch<UserPage>('/api/v1/users', {
    query: {
      search: filters.search,
      status: filters.status,
      role: filters.role,
      page: filters.page === undefined ? undefined : String(filters.page),
    },
  });
}

export async function getUser(id: string): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}`);
}

export async function createUser(input: CreateUserDto): Promise<ApiResult<User>> {
  return authFetch<User>('/api/v1/users', { method: 'POST', json: input });
}

export async function updateUser(id: string, input: UpdateUserDto): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}`, { method: 'PATCH', json: input });
}

/** Deactivates. There is no hard delete — see the users controller. */
export async function deactivateUser(id: string): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}`, { method: 'DELETE' });
}

export async function reactivateUser(id: string): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}/reactivate`, { method: 'POST' });
}

export async function setUserRoles(id: string, input: AssignRolesDto): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}/roles`, { method: 'PUT', json: input });
}

export async function resetUserPassword(id: string, input: ResetPasswordDto): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}/reset-password`, { method: 'POST', json: input });
}

/** Feeds the role checkboxes. Needs `role.view`, which every user-managing role holds. */
export async function listRoles(): Promise<ApiResult<Role[]>> {
  return authFetch<Role[]>('/api/v1/roles');
}

export async function changePassword(input: ChangePasswordDto): Promise<ApiResult<{ status: string }>> {
  return authFetch<{ status: string }>('/api/v1/auth/change-password', { method: 'POST', json: input });
}
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter web typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/lib/user-api.ts
git commit -m "$(cat <<'EOF'
feat(web): add the users API wrapper

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Server Actions for user management

**Files:**
- Create: `apps/web/app/users/actions.ts`, `apps/web/app/users/actions.spec.ts`

**Interfaces:**
- Consumes: `app/lib/user-api`, `app/lib/settle`, `app/lib/form-state` (Task 11).
- Produces: `createUserAction`, `updateUserAction`, `deactivateUserAction`, `reactivateUserAction`, `setUserRolesAction`, `resetUserPasswordAction`, `changePasswordAction` — each `(previous: FormState, form: FormData) => Promise<FormState>`. Tasks 13–14 bind them to forms.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/users/actions.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const createUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const updateUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const deactivateUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const reactivateUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const setUserRoles = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const resetUserPassword = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const changePassword = vi.fn().mockResolvedValue({ state: 'ready', data: { status: 'ok' } });
vi.mock('../lib/user-api', () => ({
  createUser, updateUser, deactivateUser, reactivateUser,
  setUserRoles, resetUserPassword, changePassword,
  listUsers: vi.fn(), getUser: vi.fn(), listRoles: vi.fn(),
}));

const {
  changePasswordAction, createUserAction, deactivateUserAction,
  reactivateUserAction, resetUserPasswordAction, setUserRolesAction, updateUserAction,
} = await import('./actions');

beforeEach(() => {
  revalidatePath.mockClear();
  redirect.mockClear();
  for (const fn of [createUser, updateUser, deactivateUser, reactivateUser, setUserRoles, resetUserPassword, changePassword]) {
    fn.mockClear();
  }
});

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else data.set(key, value);
  }
  return data;
}

const NEW_USER = {
  username: 'new.one', email: 'new.one@ipms.local', fullName: 'New One',
  password: 'a-long-enough-password', confirmPassword: 'a-long-enough-password',
};

describe('createUserAction', () => {
  it('sends the whole form, with the checked roles as an array', async () => {
    await expect(createUserAction({}, form({ ...NEW_USER, roleCodes: ['FIELD_ENGINEER', 'QC_MANAGER'] })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(createUser).toHaveBeenCalledWith({
      username: 'new.one', email: 'new.one@ipms.local', fullName: 'New One',
      password: 'a-long-enough-password', roleCodes: ['FIELD_ENGINEER', 'QC_MANAGER'],
    });
  });

  it('omits employeeCode when it was left blank rather than sending an empty string', async () => {
    await expect(createUserAction({}, form({ ...NEW_USER, employeeCode: '   ' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(createUser.mock.calls[0]![0]).not.toHaveProperty('employeeCode');
  });

  it('refuses a mismatched confirmation without a round trip', async () => {
    expect(await createUserAction({}, form({ ...NEW_USER, confirmPassword: 'something-else' })))
      .toEqual({ error: 'The two passwords do not match.' });
    expect(createUser).not.toHaveBeenCalled();
  });

  // The service refuses it too, but a round trip to be told the obvious is a
  // worse answer than an immediate one.
  it('refuses a short password without a round trip', async () => {
    expect(await createUserAction({}, form({ ...NEW_USER, password: 'short', confirmPassword: 'short' })))
      .toEqual({ error: 'The password must be at least 12 characters.' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('requires a username, an email and a name', async () => {
    expect(await createUserAction({}, form({ username: 'only.this' })))
      .toEqual({ error: 'A username, an email address and a full name are required.' });
  });

  it('lands on the new user"s page', async () => {
    await expect(createUserAction({}, form(NEW_USER))).rejects.toThrow('NEXT_REDIRECT');
    expect(revalidatePath).toHaveBeenCalledWith('/users');
    expect(redirect).toHaveBeenCalledWith('/users/u-1');
  });

  it('shows the API"s refusal and does not redirect', async () => {
    createUser.mockResolvedValueOnce({ state: 'forbidden', message: 'You may not assign the role SUPER_ADMIN' });
    expect(await createUserAction({}, form(NEW_USER)))
      .toEqual({ error: 'You may not assign the role SUPER_ADMIN' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('updateUserAction', () => {
  it('clears employeeCode when the field is submitted empty', async () => {
    await expect(updateUserAction({}, form({
      userId: 'u-1', fullName: 'Renamed', email: 'r@ipms.local', employeeCode: '',
    }))).rejects.toThrow('NEXT_REDIRECT');
    expect(updateUser).toHaveBeenCalledWith('u-1', {
      fullName: 'Renamed', email: 'r@ipms.local', employeeCode: null,
    });
  });

  it('refreshes the list as well as the detail page, because both show the name', async () => {
    await expect(updateUserAction({}, form({ userId: 'u-1', fullName: 'Renamed', email: 'r@ipms.local' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(revalidatePath).toHaveBeenCalledWith('/users/u-1');
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });
});

describe('setUserRolesAction', () => {
  // An unchecked box sends nothing, which is how the form says "no roles".
  it('sends the empty set when every box is unchecked', async () => {
    expect(await setUserRolesAction({}, form({ userId: 'u-1' }))).toEqual({});
    expect(setUserRoles).toHaveBeenCalledWith('u-1', { roleCodes: [] });
  });

  it('sends every checked role', async () => {
    await setUserRolesAction({}, form({ userId: 'u-1', roleCodes: ['QC_MANAGER'] }));
    expect(setUserRoles).toHaveBeenCalledWith('u-1', { roleCodes: ['QC_MANAGER'] });
  });
});

describe('deactivateUserAction and reactivateUserAction', () => {
  it('deactivates and refreshes both pages', async () => {
    expect(await deactivateUserAction({}, form({ userId: 'u-1' }))).toEqual({});
    expect(deactivateUser).toHaveBeenCalledWith('u-1');
    expect(revalidatePath).toHaveBeenCalledWith('/users/u-1');
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });

  it('surfaces the last-administrator refusal rather than swallowing it', async () => {
    deactivateUser.mockResolvedValueOnce({
      state: 'unavailable', status: 400,
      message: 'This is the last active super administrator; promote another account first',
    });
    expect(await deactivateUserAction({}, form({ userId: 'u-1' })))
      .toEqual({ error: 'This is the last active super administrator; promote another account first' });
  });

  it('reactivates', async () => {
    expect(await reactivateUserAction({}, form({ userId: 'u-1' }))).toEqual({});
    expect(reactivateUser).toHaveBeenCalledWith('u-1');
  });
});

describe('resetUserPasswordAction', () => {
  it('sends the new password once both copies agree', async () => {
    expect(await resetUserPasswordAction({}, form({
      userId: 'u-1', password: 'a-long-enough-password', confirmPassword: 'a-long-enough-password',
    }))).toEqual({});
    expect(resetUserPassword).toHaveBeenCalledWith('u-1', { password: 'a-long-enough-password' });
  });

  it('refuses a mismatch without a round trip', async () => {
    expect(await resetUserPasswordAction({}, form({
      userId: 'u-1', password: 'a-long-enough-password', confirmPassword: 'different-enough-one',
    }))).toEqual({ error: 'The two passwords do not match.' });
    expect(resetUserPassword).not.toHaveBeenCalled();
  });
});

describe('changePasswordAction', () => {
  /**
   * The change bumps tokenVersion, so the cookie in this browser is already
   * dead by the time the action returns. Signing out locally and going to the
   * login page is the only coherent next screen.
   */
  it('sends the user to sign in again', async () => {
    await expect(changePasswordAction({}, form({
      currentPassword: 'old-password', newPassword: 'a-long-enough-password',
      confirmPassword: 'a-long-enough-password',
    }))).rejects.toThrow('NEXT_REDIRECT');
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password', newPassword: 'a-long-enough-password',
    });
    expect(redirect).toHaveBeenCalledWith('/login?changed=1');
  });

  it('refuses a new password equal to the current one without a round trip', async () => {
    expect(await changePasswordAction({}, form({
      currentPassword: 'a-long-enough-password', newPassword: 'a-long-enough-password',
      confirmPassword: 'a-long-enough-password',
    }))).toEqual({ error: 'The new password must be different from the current one.' });
    expect(changePassword).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run apps/web/app/users/actions.spec.ts
```

Expected: FAIL — `Failed to load ./actions`.

- [ ] **Step 3: Write the actions**

Create `apps/web/app/users/actions.ts`:

```ts
'use server';
import { redirect } from 'next/navigation';
import {
  changePassword, createUser, deactivateUser, reactivateUser,
  resetUserPassword, setUserRoles, updateUser,
} from '../lib/user-api';
import { type FormState } from '../lib/form-state';
import { clearable, optional, settle } from '../lib/settle';

/**
 * One Server Action per mutation.
 *
 * They run on the server, so they reach `authFetch` and its http-only cookie
 * directly and the forms they back work without client JavaScript. The checks
 * below duplicate rules the service enforces anyway: a round trip to be told
 * "the two passwords do not match" is a worse answer than an immediate one.
 */

/** Matches `NewPasswordSchema` in @ipms/contracts. Keep the two in step. */
const MIN_PASSWORD = 12;

/** Both password forms take the value twice; neither should reach the API disagreeing. */
function readNewPassword(form: FormData): { password: string } | { error: string } {
  const password = optional(form, 'password') ?? optional(form, 'newPassword');
  const confirmation = optional(form, 'confirmPassword');
  if (!password) return { error: 'A password is required.' };
  if (password.length < MIN_PASSWORD) return { error: `The password must be at least ${MIN_PASSWORD} characters.` };
  if (password !== confirmation) return { error: 'The two passwords do not match.' };
  return { password };
}

/** A user's name is rendered on their own page and in the list, and both must refresh. */
const pages = (userId: string) => [`/users/${userId}`, '/users'];

export async function createUserAction(_previous: FormState, form: FormData): Promise<FormState> {
  const username = optional(form, 'username');
  const email = optional(form, 'email');
  const fullName = optional(form, 'fullName');
  if (!username || !email || !fullName) {
    return { error: 'A username, an email address and a full name are required.' };
  }

  const password = readNewPassword(form);
  if ('error' in password) return { error: password.error };

  const employeeCode = optional(form, 'employeeCode');
  const result = await createUser({
    username, email, fullName, password: password.password,
    // An unchecked box sends nothing, so this is the empty set when no role
    // was picked — which the API accepts and the service treats as "no roles".
    roleCodes: form.getAll('roleCodes').map(String),
    ...(employeeCode === undefined ? {} : { employeeCode }),
  });

  const state = await settle(result, '/users');
  if (state.error) return state;
  if (result.state === 'ready') redirect(`/users/${result.data.id}`);
  return state;
}

/**
 * Every field arrives on every submit, so an empty one is a deliberate clear
 * rather than a field the user skipped — hence `clearable` for the optional
 * employee code. On success it returns to the detail page: `FormState` carries
 * an error and nothing else, so the re-rendered profile is the only
 * acknowledgement a save can give.
 */
export async function updateUserAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  const fullName = optional(form, 'fullName');
  const email = optional(form, 'email');
  if (!fullName || !email) return { error: 'A full name and an email address are required.' };

  const state = await settle(await updateUser(userId, {
    fullName, email, ...clearable(form, 'employeeCode'),
  }), pages(userId));
  if (state.error) return state;
  redirect(`/users/${userId}`);
}

export async function setUserRolesAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  return settle(await setUserRoles(userId, {
    roleCodes: form.getAll('roleCodes').map(String),
  }), pages(userId));
}

export async function deactivateUserAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  return settle(await deactivateUser(userId), pages(userId));
}

export async function reactivateUserAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  return settle(await reactivateUser(userId), pages(userId));
}

export async function resetUserPasswordAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  const password = readNewPassword(form);
  if ('error' in password) return { error: password.error };
  return settle(await resetUserPassword(userId, { password: password.password }), pages(userId));
}

/**
 * Self-service, and the last thing this session does.
 *
 * The change bumps `tokenVersion`, so the cookie in this browser is dead by the
 * time the call returns — there is no authenticated page left to land on, and
 * signing in again is what hands the user a token carrying their real
 * permissions for the first time.
 */
export async function changePasswordAction(_previous: FormState, form: FormData): Promise<FormState> {
  const currentPassword = optional(form, 'currentPassword');
  if (!currentPassword) return { error: 'Enter your current password.' };

  const password = readNewPassword(form);
  if ('error' in password) return { error: password.error };
  if (password.password === currentPassword) {
    return { error: 'The new password must be different from the current one.' };
  }

  const state = await settle(
    await changePassword({ currentPassword, newPassword: password.password }),
    '/users',
  );
  if (state.error) return state;
  redirect('/login?changed=1');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run apps/web/app/users/actions.spec.ts
```

Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/users/actions.ts apps/web/app/users/actions.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): add the user management server actions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: The users screens

**Files:**
- Create: `apps/web/app/users/page.tsx`, `apps/web/app/users/new/page.tsx`, `apps/web/app/users/[id]/page.tsx`, `apps/web/app/users/forms.tsx`

**Interfaces:**
- Consumes: `app/lib/user-api` (Task 11), `app/users/actions` (Task 12), `getCurrentUser`/`hasPermission` from `app/lib/iam-api`, `assignableRoles` from `@ipms/authz` (Task 1), `Sidebar`/`StatePage`/`TopActions` from `app/shell`.
- Produces: the three routes. Task 15 adds the nav item pointing at `/users`.

**Pattern to follow:** `apps/web/app/projects/page.tsx` for the list and its `StatePage` branches, `apps/web/app/projects/forms.tsx` for the client components (`'use client'` + `useActionState`), `apps/web/app/projects/[id]/edit/page.tsx` for a detail/edit page. Read all three before writing; reuse the existing class names in `styles.css` (`app-shell`, `content`, `topbar`, `crumbs`, `dashboard`, `toolbar`, `panel`, `data-table`, `row-actions`, `primary-button`, `ghost-button`, `badge`, `empty-list`, `eyebrow`, `subtle`) rather than adding new ones.

- [ ] **Step 1: Write the list page**

Create `apps/web/app/users/page.tsx`:

```tsx
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listUsers } from '../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../shell';
import { UserFilterBar } from './forms';

/**
 * Declared here rather than imported: `UserStatusFilter` in `@ipms/contracts`
 * is a type inferred from a Zod enum, and importing it would pull the contracts
 * barrel — `node:crypto` and zod — into this page for the sake of three string
 * literals. Keep the two in step.
 */
type UserStatusFilterValue = 'ACTIVE' | 'INACTIVE' | 'ALL';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; role?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = (['ACTIVE', 'INACTIVE', 'ALL'].includes(params.status ?? '')
    ? params.status
    : 'ALL') as UserStatusFilterValue;

  const [users, viewer] = await Promise.all([
    listUsers({
      search: params.search,
      status,
      role: params.role,
      page: params.page === undefined ? undefined : Number(params.page),
    }),
    getCurrentUser(),
  ]);

  if (users.state === 'unauthenticated') {
    return <StatePage title="Sign in to manage users"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (users.state === 'forbidden') {
    return (
      <StatePage title="Your account cannot view users">
        <p>{users.message}</p>
        <p className="subtle">Ask an administrator for a role that grants <code>user.view</code>.</p>
      </StatePage>
    );
  }
  if (users.state === 'unavailable') {
    return (
      <StatePage title="User directory is not available">
        <p>{users.message}</p>
        {users.correlationId ? <p className="subtle">Correlation ID: <code>{users.correlationId}</code></p> : null}
      </StatePage>
    );
  }

  // For clarity only — the gateway and the service are what enforce this.
  const mayCreate = viewer.state === 'ready' && hasPermission(viewer.data, 'user.create');

  return (
    <main className="app-shell">
      <Sidebar active="users" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Users</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">ALL USERS</p><h1>Users</h1></div>
            {mayCreate ? <a className="primary-button" href="/users/new">New user</a> : null}
          </div>

          <UserFilterBar search={params.search ?? ''} status={status} />

          <section className="panel">
            {users.data.items.length === 0
              ? <div className="empty-list"><strong>No users match</strong><p>Try a different search or status.</p></div>
              : <table className="data-table">
                  <thead>
                    <tr><th>Name</th><th>Username</th><th>Email</th><th>Roles</th><th>Status</th><th>Last sign-in</th><th></th></tr>
                  </thead>
                  <tbody>
                    {users.data.items.map((user) => (
                      <tr key={user.id}>
                        <td><a href={`/users/${user.id}`}>{user.fullName}</a></td>
                        <td><code>{user.username}</code></td>
                        <td>{user.email}</td>
                        <td>{user.roles.length === 0 ? '—' : user.roles.map((role) => role.name).join(', ')}</td>
                        <td>
                          <span className={user.isActive ? 'badge green' : 'badge'}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}</td>
                        <td className="row-actions"><a className="ghost-button" href={`/users/${user.id}`}>Open</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>}
          </section>

          {users.data.total > users.data.limit ? (
            <p className="subtle">
              Showing {users.data.items.length} of {users.data.total} users.
              {users.data.page > 1 ? <a href={`/users?page=${users.data.page - 1}`}> Previous</a> : null}
              {users.data.page * users.data.limit < users.data.total
                ? <a href={`/users?page=${users.data.page + 1}`}> Next</a>
                : null}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Write the client components**

Create `apps/web/app/users/forms.tsx` containing, each marked `'use client'` at the top of the file:

- `UserFilterBar({ search, status })` — a GET `<form action="/users">` with a text input named `search` and a `<select name="status">` of Active / Inactive / All, plus a submit button. A GET form keeps the filters in the URL, which makes them shareable and survives a refresh, and needs no client state.
- `CreateUserForm({ assignableRoles })` — `useActionState(createUserAction, EMPTY)`; inputs for full name, username, email, employee code, password, confirm password; a checkbox per assignable role named `roleCodes`; renders `state.error` in a `<p className="form-error">`.
- `EditUserForm({ user })` — `useActionState(updateUserAction, EMPTY)`; a hidden `userId`; full name, email, employee code.
- `RoleAssignmentForm({ user, assignableRoles })` — `useActionState(setUserRolesAction, EMPTY)`; a checkbox per assignable role, `defaultChecked` from `user.roles`. Roles the viewer may **not** assign but the user holds are rendered as disabled, checked boxes with a note, so the form never silently strips them.
- `DeactivateUserForm({ user })` — `useActionState`; a single button bound to `deactivateUserAction` or `reactivateUserAction` depending on `user.isActive`.
- `ResetPasswordForm({ user })` — `useActionState(resetUserPasswordAction, EMPTY)`; password and confirmation, with a note that the user must change it at next sign-in.

Mirror `apps/web/app/projects/forms.tsx` exactly for the `useActionState` wiring, the `EMPTY` initial state, and the error rendering.

- [ ] **Step 3: Write the create page**

Create `apps/web/app/users/new/page.tsx`: a server component that calls `getCurrentUser()` and `listRoles()` in parallel, renders the same four `StatePage` branches as the list, computes the roles the viewer may grant, and renders `<CreateUserForm assignableRoles={...} />` inside the shell with `<Sidebar active="users" />`.

Compute the assignable set with the shared table, never a second copy of the rule:

```tsx
import { assignableRoles } from '@ipms/authz';

// Presentation only: the service applies the same table and is what enforces
// it. Showing a role the viewer cannot grant would produce a 403 on submit.
const allowed = assignableRoles(viewer.data.roles);
const grantable = roles.data.filter(
  (role) => role.isActive && (allowed === 'ALL' || allowed.has(role.code)),
);
```

> `@ipms/authz` is a Nest library, but `assignable-roles.ts` imports nothing from Nest — this named import is tree-shakeable and pulls in no guards. Verify with `pnpm --filter web build` in Step 6; if the bundle complains, copy the three functions is **not** the answer — move them into `@ipms/contracts` instead and update Task 1's barrel.

- [ ] **Step 4: Write the detail page**

Create `apps/web/app/users/[id]/page.tsx`: a server component taking `params: Promise<{ id: string }>`, calling `getUser(id)`, `listRoles()` and `getCurrentUser()` in parallel, with the four `StatePage` branches. It renders, in panels:

1. A header with the user's full name, username, a status badge, and `Last signed in`.
2. `<EditUserForm>` when the viewer holds `user.update` **and** `mayManage(viewer.roles, user.roles.map(r => r.code))`.
3. `<RoleAssignmentForm>` when the viewer holds `role.assign` and `mayManage(...)`.
4. `<DeactivateUserForm>` when the viewer holds `user.deactivate` and `mayManage(...)`, and the user is not the viewer themselves.
5. `<ResetPasswordForm>` when the viewer holds `user.update` and `mayManage(...)`.
6. When `mayManage` is false, a single `<p className="subtle">` explaining that this account is managed by an administrator — rather than silently rendering nothing.

Import `mayManage` from `@ipms/authz` alongside `assignableRoles`.

- [ ] **Step 5: Verify the pages render**

```bash
pnpm --filter web typecheck && pnpm --filter web build
```

Expected: both succeed. The build is what proves the `@ipms/authz` import is safe in a Next bundle.

- [ ] **Step 6: Check it in a browser**

Start the stack, sign in as `admin`, and walk the flow: create a user, see them in the list, open them, rename them, assign a role, reset their password, deactivate them. Then sign in as `manager` and confirm the admin account shows the "managed by an administrator" note with no edit controls.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/users
git commit -m "$(cat <<'EOF'
feat(web): add the user management screens

The role checkboxes are filtered through the same assignable-roles table the
service enforces, so the form cannot offer a grant that would 403 on submit.
Roles the viewer may not assign but the target holds render disabled and
checked, so saving never silently strips them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: The change-password screen and the login redirect

**Files:**
- Create: `apps/web/app/change-password/page.tsx`, `apps/web/app/change-password/form.tsx`
- Modify: `apps/web/app/api/auth/login/route.ts`, `apps/web/app/login/page.tsx`

**Interfaces:**
- Consumes: `changePasswordAction` (Task 12), `TokenPair.mustChangePassword` (Task 3), `loginWithPassword`/`writeSession` from `app/lib/session`.
- Produces: the `/change-password` route and a login response carrying `mustChangePassword`.

- [ ] **Step 1: Report the flag from the login handler**

In `apps/web/app/api/auth/login/route.ts`, replace the success lines:

```ts
  // The token this login returns carries no roles and no permissions when a
  // change is owed, so every other page would render a forbidden state. Telling
  // the browser here is what sends the user somewhere useful instead.
  const response = NextResponse.json({
    ok: true,
    mustChangePassword: result.tokens.mustChangePassword === true,
  });
  writeSession(response, result.tokens);
  return response;
```

- [ ] **Step 2: Follow it on the login page**

In `apps/web/app/login/page.tsx`, at the point where a successful response currently navigates to `/`, branch on the payload:

```ts
const payload = await response.json() as { ok?: boolean; mustChangePassword?: boolean };
window.location.href = payload.mustChangePassword ? '/change-password' : '/';
```

> Read the file first — match whatever navigation idiom it already uses (`router.push`, `window.location`, a form redirect) rather than introducing a second one.

Also render a confirmation when the page is reached with `?changed=1`, which is where `changePasswordAction` lands:

```tsx
{searchParams.changed === '1'
  ? <p className="subtle">Your password has been changed. Sign in with the new one.</p>
  : null}
```

- [ ] **Step 3: Write the page**

Create `apps/web/app/change-password/page.tsx`:

```tsx
import { StatePage } from '../shell';
import { ChangePasswordForm } from './form';

/**
 * Deliberately outside the app shell.
 *
 * A user who owes a password change holds a token with no roles and no
 * permissions, so every sidebar link would lead to a forbidden state. `StatePage`
 * is the surface for exactly that: it stands on its own and offers one action.
 *
 * Reachable voluntarily too — anyone signed in may change their own password
 * here — so it never asserts that a change is owed.
 */
export default function ChangePasswordPage() {
  return (
    <StatePage eyebrow="YOUR ACCOUNT" title="Choose a new password">
      <p className="subtle">
        Your password must be at least 12 characters. You will be asked to sign in again afterwards.
      </p>
      <ChangePasswordForm />
    </StatePage>
  );
}
```

Create `apps/web/app/change-password/form.tsx`: a `'use client'` component using `useActionState(changePasswordAction, EMPTY)`, with `currentPassword`, `newPassword` and `confirmPassword` inputs (all `type="password"`, with `autoComplete` set to `current-password` and `new-password`), a submit button, and `state.error` rendered the same way `apps/web/app/projects/forms.tsx` does.

- [ ] **Step 4: Typecheck and build**

```bash
pnpm --filter web typecheck && pnpm --filter web build && pnpm vitest run apps/web
```

Expected: all three succeed.

- [ ] **Step 5: Check the whole loop in a browser**

Sign in as `admin`, create a user with a temporary password, sign out, sign in as that user. Expected: you land on `/change-password`; navigating to `/users` or `/projects` by hand shows a forbidden state; changing the password returns you to `/login` with the confirmation; signing in again lands on `/` with the sidebar populated.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/change-password apps/web/app/api/auth/login/route.ts apps/web/app/login/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): add the forced password change screen

The token a user owing a change receives carries no authority, so every other
page renders a forbidden state. The login response now says so, and the page
sits outside the app shell because no sidebar link would work.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: The navigation entry

**Files:**
- Modify: `apps/web/app/shell.tsx`
- Test: `apps/web/app/shell.spec.tsx` (create)

**Interfaces:**
- Consumes: `getCurrentUser`, `hasPermission` from `app/lib/iam-api`.
- Produces: `Sidebar` as an async server component; `Section` gains `'users'`. Call sites are unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/shell.spec.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUser = vi.fn();
vi.mock('./lib/iam-api', async () => {
  const actual = await vi.importActual<typeof import('./lib/iam-api')>('./lib/iam-api');
  return { ...actual, getCurrentUser };
});

const { Sidebar } = await import('./shell');

function user(permissions: string[]) {
  return { state: 'ready', data: { id: 'u-1', roles: [], permissions, tokenVersion: 0, isActive: true } };
}

/** Walks the rendered tree for every `href` an anchor carries. */
function hrefs(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const element = node as { props?: { href?: string; children?: unknown } };
  const here = typeof element.props?.href === 'string' ? [element.props.href] : [];
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  return [...here, ...list.flatMap(hrefs)];
}

beforeEach(() => getCurrentUser.mockReset());

describe('Sidebar', () => {
  it('offers Users to a viewer who may see them', async () => {
    getCurrentUser.mockResolvedValue(user(['user.view', 'project.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).toContain('/users');
  });

  // Hiding it is UX, not a boundary — /users still renders a forbidden state
  // for anyone who reaches it directly.
  it('hides Users from a viewer who may not', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).not.toContain('/users');
  });

  it('still renders the rest of the navigation when the identity call fails', async () => {
    getCurrentUser.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    const links = hrefs(await Sidebar({ active: 'projects' }));
    expect(links).toContain('/projects');
    expect(links).not.toContain('/users');
  });
});
```

Add `'app/**/*.spec.tsx'` to the `include` array in `apps/web/vitest.config.mts`:

```ts
    include: ['app/**/*.spec.ts', 'app/**/*.spec.tsx'],
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run apps/web/app/shell.spec.tsx
```

Expected: FAIL — `/users` is not among the rendered hrefs.

- [ ] **Step 3: Make `Sidebar` async and add the item**

In `apps/web/app/shell.tsx`, add the import, widen `Section`, and replace `Sidebar`:

```tsx
import { getCurrentUser, hasPermission } from './lib/iam-api';

type Section = 'overview' | 'projects' | 'quality' | 'users';

/**
 * Asks who the viewer is rather than taking it as a prop, so every page's call
 * site stays `<Sidebar active="…" />` and no page has to thread an identity it
 * does not otherwise need.
 *
 * Hiding an item is UX, never a boundary: `/users` renders its own forbidden
 * state, and the gateway refuses the request underneath either way. When the
 * identity call fails the item is hidden — the fail-closed direction, and the
 * rest of the navigation still renders.
 */
export async function Sidebar({ active }: { active: Section }) {
  const viewer = await getCurrentUser();
  const mayViewUsers = viewer.state === 'ready' && hasPermission(viewer.data, 'user.view');

  return (
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="iPMS home"><span>i</span>PMS</a>
      <p className="workspace-label">WORKSPACE</p>
      <nav aria-label="Primary navigation">
        <NavItem section="overview" active={active} href="/" icon="▦">Overview</NavItem>
        <NavItem section="projects" active={active} href="/projects" icon="◫">Projects</NavItem>
        <NavItem section="quality" active={active} href="/#quality" icon="✓">Quality</NavItem>
        {mayViewUsers ? <NavItem section="users" active={active} href="/users" icon="◉">Users</NavItem> : null}
      </nav>
      <div className="sidebar-bottom"><a className="nav-item" href="/#settings"><Icon>⚙</Icon>Settings</a></div>
    </aside>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run apps/web && pnpm --filter web typecheck && pnpm --filter web build
```

Expected: PASS and both succeed. Every existing `<Sidebar active="…" />` call site now renders an async component, which React Server Components support with no change at the call site.

- [ ] **Step 5: Full suite**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green. This is the first point at which every piece is present, so run it before the final commit.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/shell.tsx apps/web/app/shell.spec.tsx apps/web/vitest.config.mts
git commit -m "$(cat <<'EOF'
feat(web): add Users to the sidebar

Sidebar resolves the viewer itself, so no page has to thread an identity it does
not otherwise need. Hiding the item is UX; /users renders its own forbidden
state and the gateway refuses the request underneath either way.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

Checked against the spec, section by section:

- §2.1 table and its three functions → Task 1. §2.2's seed grant → Task 9. §2.3's three refusals → Task 6 (unit) and Task 10 (integration).
- §3's column → Task 4. §4's schemas → Task 2.
- §5.1's eight routes → Task 7; §5.2's query-level listing → Task 5; §5.3's audit, revocation and `findFirst`-not-`upsert` rules → Tasks 5–6.
- §6's empty-authority token, claim plumbing and change-password endpoint → Tasks 3, 8, 14.
- §7.1 helper move → Task 11; §7.2 wrapper → Task 11; §7.3 screens → Tasks 12–14; §7.4 navigation → Task 15.
- §8's five spec files plus the integration spec → Tasks 1, 2, 5, 6, 7, 10, 12, 15.

Two places where a task deliberately stops short of showing every line: Task 3's guard test, Task 8's auth tests, and Task 13's `forms.tsx` describe the required assertions and components but defer to files already in the repository for their scaffolding. That is because each one must reuse an existing helper — a second fake-prisma builder in `auth.service.spec.ts` or a second `useActionState` idiom in `forms.tsx` would be a defect, not a shortcut. Each of those steps names the file to read first.
