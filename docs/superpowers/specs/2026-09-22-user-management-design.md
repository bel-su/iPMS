# iPMS — User Management Design

**Status:** Approved
**Date:** 2026-09-22
**Parent spec:** `2026-09-15-ipms-microservices-architecture-design.md` §6 (authorization), §5.1 (`iam`)
**Related specs:** `2026-09-20-project-crud-design.md` (the web CRUD shape this follows)

---

## 1. Context

`iam` owns users, but nothing can manage them. The service has `auth`, `roles`,
`scopes` and `effective` modules; there is no users module. The only way an account
comes into existence today is `seedDemoUsers`, which is gated to
`NODE_ENV=development|test` and refuses to run anywhere else — so a production
deployment has no path to its first user beyond hand-written SQL, and no path to its
second at all.

Everything around that gap is already built:

- The gateway allowlists `/api/v1/users` and proxies it to `iam`
  (`apps/gateway/src/proxy/routes.ts`), so the prefix is reachable and answers 404
  only because no controller claims it.
- `ScopesController` already serves `users/:id/scopes`, `users/:id/projects`,
  `users/:id/sites` and `users/:id/permission-overrides` under that same prefix.
- The permission catalog already defines `user.view`, `user.create`, `user.update`,
  `user.deactivate` and `role.assign` — none of which is enforced anywhere, because
  no route requires them.
- `User`, `Role` and `UserRole` are modelled, with three hand-written partial unique
  indexes enforcing one assignment per scope shape.
- `AuthService.revokeAll` and `ScopesService.revokeTokens` establish how a mutation
  invalidates a target's live sessions.

So this is a module-shaped hole in a service that is otherwise complete, not a new
subsystem.

### 1.1 Scope

**In:** a users module in `iam` (list, read, create, update, deactivate, reactivate,
role assignment, admin password reset); a role-assignment authority table in
`@ipms/authz`; a forced first-login password change; web screens for all of it; a
Users entry in the sidebar.

**Out:** project and site scope grants and permission overrides from these
screens — those endpoints exist and work, and giving them a UI is its own decision.
Self-service profile editing. Email invitations (`notification` is scaffolded only,
so nothing can be delivered). Bulk user import. SSO. Custom role creation, which
`RolesController` already serves and which needs no new work here.

---

## 2. Authority model

Two orthogonal gates, deliberately kept separate.

**The verb gate** is the existing permission catalog, enforced by
`@RequirePermission` exactly as every other controller does. No new permission codes
are defined. The catalog's own closing comment is explicit that a code must be
created in the same change as the `@RequirePermission` that uses it and the role
grant that confers it — and `user.*` and `role.assign` were defined ahead of that
rule. This change is what makes them real.

**The object gate** is new, because permissions cannot express it. "A project manager
may create users" and "a project manager may not create an administrator" are not the
same statement, and `user.create` can only say the first.

### 2.1 The assignable-roles table

New file `libs/authz/src/assignable-roles.ts`, exported from the barrel:

```ts
export const ROLE_ASSIGNMENT: Readonly<Record<string, readonly string[] | 'ALL'>> = {
  SUPER_ADMIN: 'ALL',
  PROJECT_MANAGER: ['FIELD_ENGINEER', 'QC_MANAGER'],
};

export function assignableRoles(actorRoleCodes: string[]): 'ALL' | Set<string>;
export function mayAssign(actorRoleCodes: string[], roleCode: string): boolean;
export function mayManage(actorRoleCodes: string[], targetRoleCodes: string[]): boolean;
```

`assignableRoles` returns `'ALL'` when any of the actor's roles maps to `'ALL'`,
otherwise the union of the named sets — an actor holding two roles gets both. An
actor holding no listed role gets an empty set, which is the fail-closed default: a
custom role created through `RolesController` confers no assignment authority until
it is added here deliberately.

`mayManage` is `mayAssign` over every one of the target's current roles. It is what
answers "may this actor touch this user at all", and it is the reason a project
manager cannot edit an administrator: the target holds `SUPER_ADMIN`, which is not in
the project manager's set.

A user holding **no** roles is manageable by anyone who holds the verb permission.
That is intentional and not a hole — a roleless account has no authority to capture,
and the alternative would strand freshly created users that an error left without an
assignment.

### 2.2 What each role may do

| | SUPER_ADMIN | PROJECT_MANAGER |
|---|---|---|
| Create a user | any roles | FIELD_ENGINEER, QC_MANAGER only |
| Edit a user | anyone | targets whose roles are all in their set |
| Deactivate / reactivate | anyone | same |
| Change a user's roles | any roles | may grant only their set, to targets in their set |
| Reset a password | anyone | same targets |

A project manager managing their own team — editing and deactivating the field
engineers and QC managers they created — is a deliberate extension of the literal
requirement ("project managers can add field teams and quality managers"), confirmed
with the requester on 2026-09-22. Without it, correcting a typo or offboarding a
departed engineer requires an administrator.

Seed change in `apps/iam/prisma/seed.ts`: `PROJECT_MANAGER` gains `user.create`,
`user.update`, `user.deactivate` and `role.assign`. `expandDependencies` closes over
`user.view`, which the role already holds. `QC_MANAGER` and `FIELD_ENGINEER` gain
nothing.

### 2.3 Refusals the service imposes on itself

Independent of both gates, and enforced for every actor including `SUPER_ADMIN`:

- An actor cannot deactivate their own account. Locking yourself out is never the
  intent, and a reversal needs a second administrator.
- An actor cannot change their own roles. This is the privilege-escalation path:
  without it, `role.assign` is equivalent to `SUPER_ADMIN`.
- The last active `SUPER_ADMIN` cannot be deactivated, nor have that role removed.
  Counted inside the mutation's own transaction so two concurrent demotions cannot
  both observe a count of two and both commit.

`ScopesService.revokeOverride` already refuses a self-targeted revoke on the same
reasoning; these extend it.

---

## 3. Data model

One column on `User` in `apps/iam/prisma/schema.prisma`:

```prisma
mustChangePassword Boolean @default(false)
```

plus its migration. `@default(false)` is what keeps existing rows — including the
seeded demo accounts — signing in unchanged.

Deactivation needs no column: `isActive` exists and `AuthService.login` already
refuses an inactive user with the generic failure message.

---

## 4. Contracts

New file `libs/contracts/src/iam/user.ts`, exported from the barrel. Every request
DTO uses `.strip()`, matching the stated convention in the sibling files: an
out-of-date client must not be hard-failed by a field it does not know about, and a
client-supplied key it should not be sending is dropped rather than round-tripped.

```ts
UsernameSchema      // /^[a-z][a-z0-9._-]{1,149}$/ — lowercased before parse
NewPasswordSchema   // min 12, max 200
CreateUserSchema    // username, email, fullName, employeeCode?, password, roleCodes[]
UpdateUserSchema    // fullName?, email?, employeeCode? (nullable to clear)
AssignRolesSchema   // roleCodes: string[]  — the complete desired set, not a delta
ResetPasswordSchema // password
ChangePasswordSchema// currentPassword, newPassword
UserListQuerySchema // PaginationSchema + search?, status?, role?
UserResponseSchema  // id, username, email, fullName, employeeCode, isActive,
                    // mustChangePassword, lastLoginAt, createdAt, roles[]
```

Three decisions worth stating:

**`username` is absent from `UpdateUserSchema`.** It is the login identifier and it
appears in audit ledger entries written before the change. Renaming it silently
rewrites who those entries appear to be about. Changing a username means creating a
new account.

**`password` is absent from `UpdateUserSchema`.** A credential change must revoke
sessions; folding it into a general-purpose PATCH makes that easy to forget. It has
its own endpoint, which cannot be reached without meaning to.

**`AssignRolesSchema` carries the complete desired set.** A delta API
(`add`/`remove`) needs the client to know the current state and makes two concurrent
edits silently merge. Sending the whole set makes the write idempotent and the audit
entry a complete before/after.

`NewPasswordSchema` requires 12 characters. `LoginSchema` stays at 8 — raising it
would lock out every account created under the old policy, which is a migration, not
this change. The seed path is unaffected either way: `seedDemoUsers` hashes
`IAM_DEMO_PASSWORD` directly and never goes through a request schema.

`UsernameSchema`'s lower bound is two characters, not three, because the seeded `qc`
account is two and a policy that cannot express an account the repository itself
creates is the wrong policy.

---

## 5. `iam` users module

New directory `apps/iam/src/users/`, registered in `app.module.ts`. `UsersService` is
provided through a factory with an explicit `inject` list, like every other service
there — its constructor takes `PrismaClient`, `TokenVersionStore` and `TokenService`
as `import type`, which `emitDecoratorMetadata` would record as `Object`.

### 5.1 Routes

| Method | Path | Permission | Object gate |
|---|---|---|---|
| GET | `/users` | `user.view` | — |
| GET | `/users/:id` | `user.view` | — |
| POST | `/users` | `user.create` | `mayAssign` per requested role |
| PATCH | `/users/:id` | `user.update` | `mayManage` on target |
| DELETE | `/users/:id` | `user.deactivate` | `mayManage` on target |
| POST | `/users/:id/reactivate` | `user.update` | `mayManage` on target |
| PUT | `/users/:id/roles` | `role.assign` | `mayManage` on target **and** `mayAssign` per requested role |
| POST | `/users/:id/reset-password` | `user.update` | `mayManage` on target |

`DELETE` deactivates. The requester chose deactivation over row removal: audit ledger
entries, task assignees and QC submissions all reference user ids, and a deleted row
turns every one of those into an unresolvable reference. No `user.delete` permission
is added, so the hard-delete path does not exist to be reached by mistake.

Reading is **not** object-gated. `user.view` grants the directory; a project manager
needs to see an administrator's name to know who to ask. What they cannot do is
change one.

The controller parses every body with a Zod schema from `@ipms/contracts` and every
`:id` with `UuidSchema`, per the rule `ScopesController`'s header comment spells out.
The object gate is applied in the service, not the controller, so it cannot be
bypassed by a future caller that reaches the service directly.

### 5.2 Listing

Filtering happens in the query, never after the fetch — the architecture spec calls
query-level enforcement mandatory, and it is what stops the list from becoming an
enumeration oracle. `search` matches `username`, `email` or `fullName`
case-insensitively; `status` maps to `isActive`; `role` joins through `UserRole`.
Paginated with the existing `PaginationSchema`, returning `Paginated<UserResponse>`.
Ordered by `fullName`.

`passwordHash` is never selected. The response is built field by field from an
explicit `select`, not by spreading the row — a spread is how a hash reaches a client
the first time someone adds a column.

### 5.3 Writes

Each mutation is one `$transaction` that ends by writing an `outboxEvent` audit
record, exactly as `RolesService.audit` does, with `objectType: 'User'` and the
actions `user.created`, `user.updated`, `user.deactivated`, `user.reactivated`,
`user.roles_changed`, `user.password_reset`. `previousState`/`newState` record only
the fields the caller actually sent — `RolesService.update`'s comment explains why:
the ledger's canonical JSON hashes `undefined` and `null` identically, so spreading
the DTO would make "did not touch" and "cleared" produce the same entry.

No audit entry ever carries a password, a hash, or any derivative of one.

Token revocation, via a private `revokeTokens(tx, userId)` copied in shape from
`ScopesService` — the row update inside the caller's transaction, the publish after
it, which is the fail-closed order — fires on **deactivate**, **role change** and
**password reset**. It does not fire on a profile edit, which changes no authority.

Creation: `id` is `uuidv7()`, the password is hashed with the existing
`PasswordService`, `mustChangePassword` is `true`, and role assignments are written
as global `UserRole` rows (`projectId` and `siteId` null). Because `UserRole` carries
no composite `@@unique` — the three partial indexes are in the migration, and Prisma
cannot express them as a `where` key — assignment lookups use `findFirst` on
`{ userId, roleId, projectId: null, siteId: null }`, never `upsert`. `seedDemoUsers`
already documents this trap.

`username` and `email` collisions are caught by explicit lookups inside the
transaction and answered as 400 with the offending field named, rather than surfacing
a Prisma unique-constraint error as a 500.

---

## 6. Forced first-login password change

The requester chose a creator-set temporary password. That means the creator knows
the credential, so the account must be unusable until the holder replaces it.

Enforcement is server-side, and costs no new enforcement code: **while
`mustChangePassword` is true, `AuthService` mints a token with empty `roles` and
empty `permissions`**, plus a `mustChangePassword: true` claim. Every service's
`AuthzGuard` already refuses a request whose permission is not in the claim, so every
guarded route in the platform refuses this token automatically. `GET /auth/me` and
the new `POST /auth/change-password` require authentication but no permission, so
they remain reachable — which is exactly the reachable surface the user needs.

The rejected alternative was a flag on the web session with a redirect in `proxy.ts`.
It is bypassable by clearing a cookie, `proxy.ts` deliberately never decodes a JWT
(and cannot verify one at the edge, where `node:crypto` is unavailable), and it would
put a security decision in the browser.

Changes:

- `TokenPayloadSchema` gains `mustChangePassword: z.boolean().optional()`;
  `AuthzUser` gains `mustChangePassword?: boolean`; `JwtUserGuard` copies it through.
  Optional, so tokens minted before this deploy stay valid.
- `AuthService.login` and `.refresh` branch on the flag before `claimsFor`.
- `TokenPairSchema` gains `mustChangePassword?: boolean` so the web can redirect at
  login rather than after a failed navigation. `isTokenPair` in `session.ts` ignores
  unknown keys, so it needs no change.
- New `POST /auth/change-password` on `AuthController`: verifies `currentPassword`,
  writes the new hash, clears the flag, bumps `tokenVersion`. The bump means the
  caller's current token dies, so they sign in again — which is the only way to
  obtain a token carrying their real permissions.

An administrator resetting another user's password sets the flag again, and that
user's next login is likewise powerless until they change it.

---

## 7. Web

### 7.1 Shared form helpers

`apps/web/app/projects/settle.ts` and `form-state.ts` move to `apps/web/app/lib/`,
and the files importing them are updated. They are feature-agnostic already — the
only reason they sit under `projects/` is that projects was the first feature to need
them, and the second feature should not import across a sibling feature directory.

### 7.2 API wrapper

`apps/web/app/lib/user-api.ts`, shaped like `project-api.ts`: request types imported
type-only from `@ipms/contracts` (the barrel pulls in `node:crypto` and zod, which
have no business in this bundle), response interfaces declared locally as the wire
sees them.

### 7.3 Screens

```
app/users/page.tsx          list: search, status filter, role filter
app/users/new/page.tsx      create
app/users/[id]/page.tsx     detail: edit, roles, deactivate/reactivate, reset password
app/users/actions.ts        Server Actions
app/change-password/page.tsx
```

The list shows full name, username, email, roles, status and last login, with a
**New user** button when the viewer holds `user.create`. Empty and error states use
the existing `StatePage` branches — `unauthenticated`, `forbidden`, `unavailable` —
the same way `app/projects/page.tsx` does.

The create and role-assignment forms render only the roles the viewer may grant,
derived from `assignableRoles` against the roles in `getCurrentUser()`. As everywhere
in this app, that is presentation: the service applies the same table and is what
enforces it.

Destructive and authority-changing controls — deactivate, reset password — are
separate forms with their own confirmation, not fields inside the profile edit form,
so correcting a misspelled name cannot revoke someone's sessions.

Server Actions follow the established pattern: one per mutation, required fields
checked before the call, `settle` for the result, redirect to the detail page on
success because `FormState` carries an error and nothing else.

`/change-password` is reachable while signed in with no permissions, and the login
page redirects there when the login response carries `mustChangePassword`. On
success it clears the session and returns to `/login` with a message, because the
`tokenVersion` bump has already killed the token in the browser.

### 7.4 Navigation

`Sidebar` becomes an async server component. It calls `getCurrentUser()` itself and
renders a **Users** item (`/users`) only when the caller holds `user.view`; its
existing call sites stay `<Sidebar active="…" />` and need no new props. `Section`
gains `'users'`.

Hiding the item is UX, not a boundary — the platform's stated position, and the
reason `/users` still renders a `forbidden` state for anyone who reaches it directly.

---

## 8. Testing

Unit specs sit beside the files they cover, as everywhere in this repo.

| Spec | Covers |
|---|---|
| `libs/authz/src/assignable-roles.spec.ts` | `'ALL'`, the union of two roles, the empty default for an unlisted role, `mayManage` over a multi-role target, and that a project manager may not assign `SUPER_ADMIN` or `PROJECT_MANAGER` |
| `apps/iam/src/users/users.service.spec.ts` | each of §2.3's three refusals; the object gate on every write; the audit record's shape; token revocation firing on deactivate, role change and reset, and **not** on a profile edit; `passwordHash` absent from every response |
| `apps/iam/src/users/users.controller.spec.ts` | permission decorators present and correct; bodies parsed through the contract schemas; a malformed `:id` answered as 400 |
| `apps/iam/src/auth/auth.service.spec.ts` (extended) | login with `mustChangePassword` issues an empty-authority token carrying the claim; `change-password` clears the flag and bumps `tokenVersion`; a wrong `currentPassword` is refused |
| `apps/web/app/users/actions.spec.ts` | each action's payload, the revalidated paths, and that an API refusal is surfaced rather than redirected past |

The last-super-admin guard is the one rule that is a lie unless it is tested against
a real database: it depends on a count taken inside a transaction. It gets an
integration spec beside `apps/iam/prisma/user-role-unique.integration.spec.ts`, which
exists for the same reason.

---

## 9. Order of work

1. `@ipms/authz` — the assignable-roles table and its spec. No dependencies.
2. `@ipms/contracts` — `iam/user.ts`, and the two optional token fields.
3. Prisma — `mustChangePassword` and its migration.
4. `iam` — the users module; then the auth changes for the forced change.
5. Seed — the `PROJECT_MANAGER` grant.
6. Web — helper move, `user-api.ts`, screens, actions, sidebar.

Each step leaves the repository building and its tests passing. Nothing in 1–3 is
reachable by a user until 4 lands, so a partial deploy is inert rather than broken.
