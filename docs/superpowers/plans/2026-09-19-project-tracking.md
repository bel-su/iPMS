# Project & Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `project` service — sites, task types, milestones, tasks, bulk generation, and the `SiteMilestone` lifecycle — with real query-level scope enforcement, replicated from `iam` over NATS.

**Architecture:** A NestJS + Fastify service over its own Postgres database (`ipms_project`), reached only through the gateway. Authorization is two-layered: `AuthzGuard` gates on the permission code carried in the JWT, and every query additionally constrains itself with `scopeWhere()` against a local `UserScope` projection replicated from `iam` over JetStream. Task status is driven by `qc.submission.*` events; milestone eligibility is recomputed from the site's tasks and never stored as a percentage. Every mutation writes an outbox row in the same transaction, drained to `audit.event.recorded`.

**Tech Stack:** TypeScript 5.9 (ESM, `NodeNext`), NestJS 12, Fastify, Prisma ORM 7 with `@prisma/adapter-pg`, PostgreSQL 17, NATS JetStream, Redis, Vitest 4, Testcontainers, Nx 23, pnpm 10.

## Global Constraints

Copied from `docs/superpowers/specs/2026-09-19-project-tracking-design.md` and the foundation plan. Every task's requirements implicitly include this section.

- **Node >= 22.13.0, pnpm 10.15.0.** Never run `npm install` or `yarn`.
- **ESM only.** Every relative import carries a `.js` extension, including in `.ts` sources. `import type` for types, plain `import` for anything Nest resolves by reflection.
- **Prisma client output is per-service.** `project` generates into `../node_modules/@prisma-clients/project` and imports `from '@prisma-clients/project'` — never from `@prisma/client`. A shared output location is silently clobbered by the next service that runs `prisma generate`.
- **Prisma ORM 7 requires a driver adapter.** `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. There is no `datasources` or `datasourceUrl` on the constructor.
- **`prisma generate` and `prisma migrate` need `DATABASE_URL`** because `prisma.config.ts` reads `env('DATABASE_URL')`. The *runtime* reads `PROJECT_DATABASE_URL`. These are different variables on purpose.
- **Nest providers whose constructors take `import type` parameters MUST be registered with a factory and an explicit `inject` list.** TypeScript erases the type, `emitDecoratorMetadata` records `Object`, and Nest fails at bootstrap on an unresolvable token. Unit tests that call `new Service(...)` directly never catch this.
- **`app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'metrics'] })`.** Prefixing the probes breaks the container healthcheck.
- **Postgres treats `NULL` as never equal to `NULL` in a unique index.** A composite unique over nullable columns enforces nothing for the rows where they are null. Use partial unique indexes in raw SQL, and do not declare a competing `@@unique` in `schema.prisma`.
- **Response discipline:** `401` unauthenticated, `403` authenticated but not authorized, `404` when object-level authorization fails on a resource whose existence must not be disclosed.
- **No secret in any committed file.**
- **Run targets with `pnpm nx run-many -t <target>`** or `pnpm nx run <project>:<target>`. `pnpm nx test project` means "run target `test`", not "test the project `project`" — use `pnpm nx run project:test`.
- **Commit after every task.** End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Prerequisites

Before Task 1, confirm the workspace resolves and the Prisma clients exist:

```bash
pnpm install
(cd apps/iam && DATABASE_URL=postgresql://x:x@localhost:5432/x pnpm prisma generate)
(cd apps/audit && DATABASE_URL=postgresql://x:x@localhost:5432/x pnpm prisma generate)
(cd apps/project && DATABASE_URL=postgresql://x:x@localhost:5432/x pnpm prisma generate)
pnpm nx run-many -t typecheck
```

Expected: typecheck passes for all 11 projects. Docker must be running for every integration task.

## File Structure

Created or modified across the plan. Each file has one responsibility.

**`libs/authz`**
- Modify `src/scope-filter.ts` — OR semantics and explicit field names (Task 2)
- Modify `src/scope-filter.spec.ts` — rewritten for the new contract (Task 2)

**`libs/events`**
- Create `src/payloads/qc.ts` — the QC submission contract `project` consumes (Task 3)
- Create `src/payloads/project.ts` — what `project` publishes (Task 3)
- Modify `src/subjects.ts` — `QC` and `PROJECT` streams, new subjects (Task 3)
- Modify `src/index.ts` — re-export the new payloads (Task 3)

**`libs/contracts`**
- Modify `src/project/project.ts` — dependency, template-mapping, generate, declare, task-update and explain schemas (Task 4)

**`apps/project/prisma`**
- Modify `schema.prisma` — `TaskTypeDependency`, `TaskTypeTemplate`, `SiteMilestone`, `UserScope`, `ProjectionWatermark`, `OutboxEvent` (Task 5)
- Create `migrations/20260919000100_project_tracking/migration.sql` — including every partial unique index and `CHECK` (Task 5)

**`apps/iam`** — the one place this sub-project reaches back into sub-project 1 (Task 6)
- Modify `prisma/schema.prisma` + new migration — `UserGlobalScope`
- Modify `src/scopes/scopes.service.ts`, `src/scopes/scopes.controller.ts` — grant and revoke
- Modify `src/effective/effective.service.ts` — `toScope` stops hardcoding `global: false`
- Modify `prisma/seed.ts` — global scope for `admin`
- Modify `libs/authz/src/permissions.ts` — `scope.grant_global`, `scope.revoke_global`

**`apps/project/src`**
- Create `testing/harness.ts` — containers, fixtures, reset, shared by six specs (Task 5)
- Create `scope/user-scope.repository.ts` — the only writer of `UserScope` (Task 7)
- Create `scope/scope.provider.ts` — reads the projection for `AuthzGuard` (Task 7)
- Create `scope/scope.consumer.ts` — `iam.scope.*` handlers (Task 7)
- Create `scope/replay.ts` — cold-start durable recreation (Task 8)
- Create `scope/project-scope.ts` — the one definition of "visible project" (Task 9)
- Create `http/scope.decorator.ts` — `@ScopeOf()` (Task 9)
- Rewrite `project/project.service.ts`, `project/project.controller.ts` — projects and sites (Task 9)
- Create `task-types/graph.ts` — pure cycle detection (Task 10)
- Create `task-types/task-type.service.ts`, `task-types/task-type.controller.ts` (Task 10)
- Create `tasks/transitions.ts` — the two status vocabularies (Task 11)
- Create `tasks/task.service.ts`, `tasks/task.controller.ts` (Task 11)
- Create `tasks/generation.service.ts`, `tasks/generation.controller.ts` (Task 12)
- Create `milestones/recompute.ts` — the pure recomputation function (Task 13)
- Create `milestones/milestone.service.ts`, `milestones/milestone.controller.ts` (Task 13)
- Create `ingest/qc.consumer.ts` — `qc.submission.*` handlers (Task 14)
- Create `outbox/outbox.writer.ts`, `outbox/outbox.drainer.ts` (Task 15)
- Create `internal/explain.controller.ts` — the access simulator seam (Task 16)
- Rewrite `app.module.ts`, `main.ts` (Task 16)
- Create `security.integration.spec.ts` — IDOR and escalation (Task 17)

**Root**
- Modify `.gitignore`, `docker/docker-compose.yml`, `apps/gateway/src/proxy/routes.ts` and its spec (Task 1)
- Modify `docker/docker-compose.yml` — `project` healthcheck (Task 16)
- Create `e2e/project-tracking.e2e.spec.ts` (Task 18)

## Task map

| # | Task | Deliverable |
|---|---|---|
| 1 | Green baseline | Every target passes; `qc` quarantined |
| 2 | `scopeWhere` alternation fix | Project and site grants are alternatives |
| 3 | QC and project event contracts | `qc.submission.*`, `project.*`, two streams |
| 4 | Request schemas | Dependency, template, generate, declare, explain |
| 5 | Schema, indexes, migration, test harness | `SiteMilestone`, `UserScope`, `TaskTypeTemplate` |
| 6 | `iam` global scope | `SUPER_ADMIN` can see the system it administers |
| 7 | The scope projection | `UserScope` replicated from `iam` |
| 8 | Cold-start replay | A wiped projection rebuilds instead of denying forever |
| 9 | Query-level enforcement | The boundary the spike never built |
| 10 | Dependencies and variant templates | Cycle-free graph, per-site blocking |
| 11 | Tasks and transitions | `COMPLETED` unreachable without evidence |
| 12 | Bulk generation | Idempotent, concurrent-safe, scope-respecting |
| 13 | Milestones | Computed eligibility, declared achievement |
| 14 | QC consumer | Submissions drive task status and milestones |
| 15 | Audit through the outbox | Every mutation in the ledger, atomically |
| 16 | Simulator and bootstrap | `/internal/authz/explain`, a bootable service |
| 17 | Security suite | IDOR and scope escalation, all failing on the spike |
| 18 | End-to-end critical path | Generate → block → approve → eligible → declare |

---

## Task 1: Green baseline

Nothing else can be trusted while three targets are red and an unfiltered service is routed at the edge. This task changes no behaviour in `project`; it makes the tree honest.

**Files:**
- Modify: `apps/gateway/src/proxy/routes.spec.ts:19-21`
- Modify: `apps/gateway/src/proxy/routes.ts` — remove the `qc` upstream
- Modify: `.gitignore`
- Modify: `docker/docker-compose.yml` — remove the `qc` service and its `depends_on`
- Create: `apps/project/vitest.config.ts`
- Modify: `apps/project/package.json` — add `@ipms/events`
- Delete from the index: `apps/web/.next/**` (233 files)

**Interfaces:**
- Consumes: nothing.
- Produces: a workspace where `pnpm nx run-many -t lint typecheck test build` passes, which every later task's verification step assumes.

- [ ] **Step 1: See the three failures**

```bash
pnpm nx run gateway:test
pnpm nx run project:test
```

Expected: `gateway:test` fails with `AssertionError: expected { prefix: '/api/v1/projects', …(3) } to be undefined` at `routes.spec.ts:20`. `project:test` fails with `No test files found, exiting with code 1`.

- [ ] **Step 2: Fix the stale gateway assertion**

The test picked `/api/v1/projects` as an example of an undeclared prefix. It became declared. Replace it with a path that is genuinely not in `ROUTES`, in `apps/gateway/src/proxy/routes.spec.ts`:

```ts
  it('refuses a path on no declared prefix', () => {
    expect(resolveUpstream('/api/v1/media')).toBeUndefined();
    expect(resolveUpstream('/api/v1/notification')).toBeUndefined();
    expect(resolveUpstream('/')).toBeUndefined();
  });
```

- [ ] **Step 3: Quarantine `qc` at the edge**

`qc` applies no scope filtering to any query, so any holder of `qc_template.view` reads every project's templates. It is rebuilt in sub-project 3; until then it must not be reachable. In `apps/gateway/src/proxy/routes.ts`, delete the `QC` constant and its route entry:

```ts
const IAM = { host: upstreamHost('iam', 'iam'), port: upstreamPort('iam', 3001) };
const AUDIT = { host: upstreamHost('audit', 'audit'), port: upstreamPort('audit', 3003) };
const PROJECT = { host: upstreamHost('project', 'project'), port: upstreamPort('project', 3004) };

/**
 * Only paths listed here are reachable. Anything else 404s at the edge, which
 * is what keeps `/internal/*` endpoints private to service-to-service calls.
 *
 * `qc` is deliberately absent. Its sub-project-3 rewrite adds it back; the
 * spike in the tree applies no scope filtering to any query, so routing it
 * would expose every project's templates to any holder of `qc_template.view`.
 * See docs/superpowers/specs/2026-09-19-project-tracking-design.md §P6.
 */
export const ROUTES: Upstream[] = [
  { prefix: '/api/v1/auth', service: 'iam', ...IAM },
  { prefix: '/api/v1/roles', service: 'iam', ...IAM },
  { prefix: '/api/v1/permissions', service: 'iam', ...IAM },
  { prefix: '/api/v1/users', service: 'iam', ...IAM },
  { prefix: '/api/v1/access', service: 'iam', ...IAM },
  { prefix: '/api/v1/audit', service: 'audit', ...AUDIT },
  { prefix: '/api/v1/dashboard', service: 'project', ...PROJECT },
  { prefix: '/api/v1/projects', service: 'project', ...PROJECT },
  { prefix: '/api/v1/sites', service: 'project', ...PROJECT },
  { prefix: '/api/v1/task-types', service: 'project', ...PROJECT },
  { prefix: '/api/v1/site-milestones', service: 'project', ...PROJECT },
  { prefix: '/api/v1/tasks', service: 'project', ...PROJECT },
];
```

- [ ] **Step 4: Add a test that pins the quarantine**

Append to `apps/gateway/src/proxy/routes.spec.ts`, inside the `resolveUpstream — allowlist` describe block:

```ts
  it('does not route qc until sub-project 3 rebuilds it', () => {
    expect(resolveUpstream('/api/v1/qc')).toBeUndefined();
    expect(resolveUpstream('/api/v1/qc/templates')).toBeUndefined();
  });

  it('routes every project-owned prefix to the project service', () => {
    for (const path of ['/api/v1/projects', '/api/v1/sites', '/api/v1/task-types', '/api/v1/site-milestones', '/api/v1/tasks', '/api/v1/dashboard']) {
      expect(resolveUpstream(path)?.service).toBe('project');
    }
  });
```

- [ ] **Step 5: Run the gateway tests**

```bash
pnpm nx run gateway:test
```

Expected: PASS, 59 tests.

- [ ] **Step 6: Remove `qc` from the Compose stack**

In `docker/docker-compose.yml`, delete the whole `qc:` service block, and delete the `qc: { condition: service_started }` line from the gateway's `depends_on`. Leave `docker/postgres/init.sql` untouched — the `ipms_qc` database and role cost nothing and sub-project 3 needs them.

- [ ] **Step 7: Untrack the Next.js build output**

```bash
git rm -r --cached apps/web/.next
```

Expected: `rm 'apps/web/.next/BUILD_ID'` … 233 lines.

Add to `.gitignore`, after the `dist/` line:

```
.next/
```

- [ ] **Step 8: Give `project` a test target that can pass**

Create `apps/project/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Resolves DOCKER_HOST for Testcontainers so integration tests run on a
    // fresh clone and in CI without anyone exporting env vars by hand.
    setupFiles: ['../../tools/vitest-setup-containers.ts'],
  },
});
```

Create `apps/project/src/health.spec.ts` — a real assertion, not a placeholder, so the target is green without `passWithNoTests` papering over an empty suite:

```ts
import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES } from '@ipms/authz';

describe('project service permissions', () => {
  it('has every permission code its controllers will require', () => {
    for (const code of [
      'project.view', 'project.create', 'project.update',
      'site.view', 'site.create', 'site.update', 'site.delete',
      'milestone.view', 'milestone.create', 'milestone.declare',
      'task.view', 'task.create', 'task.update', 'task.assign',
      'task.generate', 'task.cancel',
    ]) {
      expect(PERMISSION_CODES).toContain(code);
    }
  });
});
```

- [ ] **Step 9: Add the events dependency `project` will need from Task 3 on**

In `apps/project/package.json`, add `"@ipms/events": "workspace:*"` to `dependencies`, and add the test tooling to `devDependencies`:

```json
  "devDependencies": {
    "@nestjs/testing": "12.0.3",
    "@testcontainers/postgresql": "12.1.0",
    "@types/pg": "8.23.1",
    "prisma": "7.10.0",
    "testcontainers": "12.1.0"
  }
```

Then:

```bash
pnpm install
```

- [ ] **Step 10: Verify the whole workspace is green**

```bash
pnpm nx run-many -t lint typecheck test build
```

`qc` has no test files and is being quarantined, so its `test` script cannot pass.
Remove it from `apps/qc/package.json` — Nx then has no `test` target for `qc` at all,
which is honest. Do not reach for `passWithNoTests`: a green target that ran zero
assertions is exactly the signal that hides an untested service. Leave a comment in the
file so sub-project 3 restores it:

```json
  "scripts": {
    "_comment": "test script removed while qc is quarantined; sub-project 3 restores it with the rewrite",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "prisma:generate": "prisma generate"
  },
```

Then re-run:

```bash
pnpm nx run-many -t lint typecheck test build
```

Expected: every target passes.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: restore a green baseline and quarantine qc

Three targets were red and one unfiltered service was routed at the edge.

- gateway's routes.spec.ts asserted /api/v1/projects resolved to no upstream,
  which stopped being true when the project route was added. The test was
  stale, not the code.

- qc is removed from the gateway route table and the Compose stack. It applies
  no scope filtering to any query, so any holder of qc_template.view reads
  every project's templates. Sub-project 3 rebuilds and re-routes it; its
  database and role stay provisioned.

- 233 Next.js build artifacts were tracked under apps/web/.next. Untracked,
  and .next/ added to .gitignore.

- project gains a vitest config and a real first test, so its target passes on
  an assertion rather than on passWithNoTests.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `@ipms/authz` — correct `scopeWhere`

**Files:**
- Modify: `libs/authz/src/scope-filter.ts`
- Modify: `libs/authz/src/scope-filter.spec.ts`
- Modify: `libs/authz/src/index.ts:11`

**Interfaces:**
- Consumes: `AuthzScope` from `./types.js`.
- Produces: `scopeWhere(scope: AuthzScope, fields?: ScopeFields): ScopeWhere` and `DEFAULT_SCOPE_FIELDS`. Every query in Tasks 9–13 calls it.

**Why this changes.** The current implementation ANDs its two clauses. A user scoped to project A and additionally to site B in project C matches nothing: the row for site B fails the `projectId` test, and every row in project A fails the `siteId` test. Project- and site-level grants are alternatives. `iam` and `audit` never exercised it because their users hold neither grant.

- [ ] **Step 1: Write the failing tests**

Replace `libs/authz/src/scope-filter.spec.ts` entirely:

```ts
import { describe, expect, it } from 'vitest';
import { scopeWhere } from './scope-filter.js';

describe('scopeWhere', () => {
  it('returns an empty constraint for a global user', () => {
    expect(scopeWhere({ global: true, projectIds: [], siteIds: [] })).toEqual({});
  });

  it('treats project and site grants as alternatives, not conjuncts', () => {
    // A PM scoped to project p-1, plus one site in a project they cannot
    // otherwise see. Both must be reachable. The previous AND semantics
    // matched neither.
    expect(scopeWhere({ global: false, projectIds: ['p-1'], siteIds: ['s-9'] })).toEqual({
      OR: [{ projectId: { in: ['p-1'] } }, { siteId: { in: ['s-9'] } }],
    });
  });

  it('still constrains when only projects are scoped', () => {
    expect(scopeWhere({ global: false, projectIds: ['p-1'], siteIds: [] })).toEqual({
      OR: [{ projectId: { in: ['p-1'] } }, { siteId: { in: [] } }],
    });
  });

  it('matches nothing for a user with no scope at all', () => {
    // Both alternatives are `in: []`, which Postgres evaluates to false.
    expect(scopeWhere({ global: false, projectIds: [], siteIds: [] })).toEqual({
      OR: [{ projectId: { in: [] } }, { siteId: { in: [] } }],
    });
  });

  it('uses the caller-named columns for a model with no site', () => {
    // The Project model itself: its own id is the project id, and it has no
    // siteId column, so naming one would be an invalid Prisma query.
    expect(
      scopeWhere({ global: false, projectIds: ['p-1'], siteIds: ['s-9'] }, { project: 'id', site: null }),
    ).toEqual({ OR: [{ id: { in: ['p-1'] } }] });
  });

  it('denies a model that carries neither column', () => {
    expect(scopeWhere({ global: false, projectIds: ['p-1'], siteIds: [] }, { project: null, site: null }))
      .toEqual({ id: { in: [] } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm nx run @ipms/authz:test -- scope-filter
```

Expected: FAIL — 4 of 6 failing, the OR cases reporting `expected { projectId: …, siteId: … } to equal { OR: [...] }`, and the two field-name cases failing because `scopeWhere` takes one argument.

- [ ] **Step 3: Write the implementation**

Replace `libs/authz/src/scope-filter.ts`:

```ts
import type { AuthzScope } from './types.js';

/**
 * Which columns on the queried model carry the owning project and site.
 * `null` means the model has no such column — naming one anyway produces an
 * invalid Prisma query rather than a stricter one.
 */
export interface ScopeFields {
  project: string | null;
  site: string | null;
}

/** Task, Site, SiteMilestone and anything else carrying both foreign keys. */
export const DEFAULT_SCOPE_FIELDS: ScopeFields = { project: 'projectId', site: 'siteId' };

export type ScopeWhere = Record<string, unknown>;

/**
 * Prisma `where` fragment constraining a query to the user's scope.
 *
 * Spread into a list query: `where: { ...scopeWhere(scope), status: 'ONGOING' }`.
 * Prisma ANDs top-level keys, so the spread composes. A caller that needs its
 * *own* `OR` must nest instead — `where: { AND: [scopeWhere(scope), { OR: [...] }] }`
 * — or the two `OR` keys collide and one is silently dropped.
 *
 * Project and site grants are ALTERNATIVES. A user scoped to project A and
 * additionally to one site in project C can see all of A and that one site.
 * An earlier version ANDed the two clauses, which matched nothing at all for
 * exactly that user; `iam` and `audit` never noticed because their users hold
 * neither grant.
 *
 * A user with no scope produces `{ OR: [{ projectId: { in: [] } }, { siteId: { in: [] } }] }`,
 * which matches nothing. That is the fail-closed direction and is relied on by
 * the cold-start behaviour in `project`: an unreplicated projection denies.
 */
export function scopeWhere(scope: AuthzScope, fields: ScopeFields = DEFAULT_SCOPE_FIELDS): ScopeWhere {
  if (scope.global) return {};

  const alternatives: ScopeWhere[] = [];
  if (fields.project !== null) alternatives.push({ [fields.project]: { in: scope.projectIds } });
  if (fields.site !== null) alternatives.push({ [fields.site]: { in: scope.siteIds } });

  // A model carrying neither column cannot be scoped at all. Denying is the
  // only safe answer; returning `{}` would hand a non-global user everything.
  if (alternatives.length === 0) return { id: { in: [] } };

  return { OR: alternatives };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm nx run @ipms/authz:test
```

Expected: PASS, all suites.

- [ ] **Step 5: Export the new type**

In `libs/authz/src/index.ts`, replace line 11:

```ts
export { scopeWhere, DEFAULT_SCOPE_FIELDS, type ScopeWhere, type ScopeFields } from './scope-filter.js';
```

- [ ] **Step 6: Verify nothing else depended on the old shape**

```bash
pnpm nx run-many -t typecheck
```

Expected: PASS for all 11 projects. `scopeWhere` had no production callers, only its own spec.

- [ ] **Step 7: Commit**

```bash
git add libs/authz
git commit -m "$(cat <<'EOF'
fix(authz): treat project and site scope as alternatives, not conjuncts

scopeWhere ANDed its two clauses, so a user scoped to project A *and* to one
site in project C matched nothing: every project-A row failed the siteId test
and the site-C row failed the projectId test. Project- and site-level grants
are alternatives.

Never bitten because iam and audit have no users holding both levels. project
is the first service that does, and every one of its list queries depends on
this being right.

Also takes explicit column names, because the Project model scopes on its own
id and has no siteId column -- naming one would produce an invalid query
rather than a stricter one. A model carrying neither column now denies.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `@ipms/events` — the QC and project contracts

Declared here, consumed in Task 13, produced by `qc` in sub-project 3. The consumer proves the contract before the producer exists — the same order the foundation used when it pre-declared `project-scope-cache`.

**Files:**
- Create: `libs/events/src/payloads/qc.ts`
- Create: `libs/events/src/payloads/project.ts`
- Modify: `libs/events/src/subjects.ts`
- Modify: `libs/events/src/index.ts`
- Test: `libs/events/src/subjects.spec.ts` (modify)

**Interfaces:**
- Consumes: nothing.
- Produces: `SUBJECTS.QC_SUBMISSION_SUBMITTED | QC_SUBMISSION_APPROVED | QC_SUBMISSION_REJECTED | PROJECT_TASK_CREATED | PROJECT_TASK_ASSIGNED | PROJECT_MILESTONE_ELIGIBLE | PROJECT_MILESTONE_ACHIEVED`; `STREAMS.QC` and `STREAMS.PROJECT`; the payload interfaces `QcSubmissionSubmitted`, `QcSubmissionApproved`, `QcSubmissionRejected`, `ProjectTaskCreated`, `ProjectTaskAssigned`, `ProjectMilestoneEligible`, `ProjectMilestoneAchieved`.

- [ ] **Step 1: Write the failing test**

Append to `libs/events/src/subjects.spec.ts`:

```ts
describe('qc and project streams', () => {
  it('declares a QC stream carrying project\'s task-transition consumer', () => {
    expect(STREAMS.QC.name).toBe('QC');
    expect(STREAMS.QC.subjects).toEqual(['qc.>']);
    expect(STREAMS.QC.durableConsumers).toContain('project-qc-tasks');
  });

  it('declares a PROJECT stream with no consumer until notification exists', () => {
    expect(STREAMS.PROJECT.name).toBe('PROJECT');
    expect(STREAMS.PROJECT.subjects).toEqual(['project.>']);
    // Sub-project 4 adds `notification-*`. An empty list is correct, not a gap.
    expect(STREAMS.PROJECT.durableConsumers).toEqual([]);
  });

  it('every subject is unique across the catalog', () => {
    const values = Object.values(SUBJECTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('every declared subject is covered by exactly one stream', () => {
    const prefixes = Object.values(STREAMS).flatMap((s) => s.subjects.map((x) => x.replace(/\.>$/, '')));
    for (const subject of Object.values(SUBJECTS)) {
      const matching = prefixes.filter((p) => subject === p || subject.startsWith(`${p}.`));
      expect(matching, `subject ${subject}`).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm nx run @ipms/events:test -- subjects
```

Expected: FAIL with `Cannot read properties of undefined (reading 'name')` — `STREAMS.QC` does not exist.

- [ ] **Step 3: Add the subjects and streams**

Replace the contents of `libs/events/src/subjects.ts`:

```ts
export const SUBJECTS = {
  IAM_SCOPE_GRANTED: 'iam.scope.granted',
  IAM_SCOPE_REVOKED: 'iam.scope.revoked',
  IAM_ROLE_ASSIGNED: 'iam.role.assigned',
  IAM_ROLE_REMOVED: 'iam.role.removed',
  IAM_USER_DEACTIVATED: 'iam.user.deactivated',
  QC_SUBMISSION_SUBMITTED: 'qc.submission.submitted',
  QC_SUBMISSION_APPROVED: 'qc.submission.approved',
  QC_SUBMISSION_REJECTED: 'qc.submission.rejected',
  PROJECT_TASK_CREATED: 'project.task.created',
  PROJECT_TASK_ASSIGNED: 'project.task.assigned',
  PROJECT_MILESTONE_ELIGIBLE: 'project.milestone.eligible',
  PROJECT_MILESTONE_ACHIEVED: 'project.milestone.achieved',
  AUDIT_EVENT: 'audit.event.recorded',
} as const;

export type Subject = (typeof SUBJECTS)[keyof typeof SUBJECTS];

export interface StreamDefinition {
  name: string;
  subjects: string[];
  maxAgeMs: number;
  durableConsumers: string[];
}

export const STREAMS: Record<'IAM' | 'QC' | 'PROJECT' | 'AUDIT', StreamDefinition> = {
  IAM: {
    name: 'IAM',
    subjects: ['iam.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    durableConsumers: ['project-scope-cache', 'qc-scope-cache'],
  },
  QC: {
    name: 'QC',
    subjects: ['qc.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    // `project` consumes these to move a task through REVIEWING → COMPLETED /
    // RECTIFYING. The producer arrives with qc in sub-project 3; the stream is
    // declared now because the consumer that proves the contract is built now.
    durableConsumers: ['project-qc-tasks'],
  },
  PROJECT: {
    name: 'PROJECT',
    subjects: ['project.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    // Empty on purpose. `notification` is sub-project 4. Publishing into a
    // stream with no consumer is harmless; retrofitting the stream later,
    // after events have been dropped on the floor, is not.
    durableConsumers: [],
  },
  AUDIT: {
    name: 'AUDIT',
    subjects: ['audit.event.recorded'],
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    // Exactly one consumer. The hash chain requires a single serialized writer.
    durableConsumers: ['audit-ledger-writer'],
  },
};
```

- [ ] **Step 4: Write the QC payload contract**

Create `libs/events/src/payloads/qc.ts`:

```ts
/**
 * The contract `qc` will publish and `project` consumes today.
 *
 * Declared in sub-project 2 rather than 3 so the consumer, its idempotence,
 * and the milestone recomputation it drives are all proven against a fixed
 * shape before the producer is written. Sub-project 3 implements `qc` against
 * this file; it is not free to change it unilaterally.
 *
 * Every payload carries `siteId` and `projectId` even though `taskId` implies
 * them. The consumer needs both to recompute milestones and to scope the
 * write, and re-deriving them would mean a second query on the hot path of an
 * at-least-once redelivery.
 */
export interface QcSubmissionSubmitted {
  submissionId: string;
  taskId: string;
  siteId: string;
  projectId: string;
  attemptNo: number;
  submittedBy: string;
}

export interface QcSubmissionApproved {
  submissionId: string;
  taskId: string;
  siteId: string;
  projectId: string;
  attemptNo: number;
  reviewedBy: string;
  /** Approval implies PASS; the field is explicit so a consumer can assert it. */
  overallVerdict: 'PASS';
}

export interface QcSubmissionRejected {
  submissionId: string;
  taskId: string;
  siteId: string;
  projectId: string;
  attemptNo: number;
  reviewedBy: string;
  /** Rejection requires a comment, per the design's review rules. */
  reason: string;
}
```

- [ ] **Step 5: Write the project payload contract**

Create `libs/events/src/payloads/project.ts`:

```ts
export interface ProjectTaskCreated {
  taskId: string;
  projectId: string;
  siteId: string;
  taskTypeId: string;
  title: string;
  assigneeId: string | null;
  origin: 'PLANNED' | 'AD_HOC';
}

export interface ProjectTaskAssigned {
  taskId: string;
  projectId: string;
  siteId: string;
  assigneeId: string;
  previousAssigneeId: string | null;
}

export interface ProjectMilestoneEligible {
  siteMilestoneId: string;
  milestoneId: string;
  siteId: string;
  projectId: string;
  eligibleAt: string;
}

export interface ProjectMilestoneAchieved {
  siteMilestoneId: string;
  milestoneId: string;
  siteId: string;
  projectId: string;
  declaredBy: string;
  achievedAt: string;
}
```

- [ ] **Step 6: Re-export both**

In `libs/events/src/index.ts`, after the `payloads/audit.js` line:

```ts
export * from './payloads/qc.js';
export * from './payloads/project.js';
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm nx run @ipms/events:test
pnpm nx run-many -t typecheck
```

Expected: both PASS. The `ensureStreams` implementation in `bus.service.ts` iterates `STREAMS` generically, so the two new streams are created with no change there — confirm by reading `libs/events/src/bus.service.ts:18-32` before moving on.

- [ ] **Step 8: Commit**

```bash
git add libs/events
git commit -m "$(cat <<'EOF'
feat(events): declare the qc submission and project milestone contracts

project consumes qc.submission.submitted/approved/rejected to move a task
through REVIEWING -> COMPLETED / RECTIFYING and to recompute milestones. The
producer arrives with qc in sub-project 3; the contract is fixed here so the
consumer, its idempotence, and the recomputation it drives are proven against
a stable shape first.

PROJECT stream is declared with no durable consumer. notification is
sub-project 4. Publishing into a consumerless stream is harmless; adding the
stream after events have been dropped is not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `@ipms/contracts` — the new request shapes

**Files:**
- Modify: `libs/contracts/src/project/project.ts`
- Create: `libs/contracts/src/project/project.spec.ts`

**Interfaces:**
- Consumes: `UuidSchema` from `../common/ids.js`.
- Produces: `AddDependencySchema`/`AddDependencyDto`, `MapTemplateSchema`/`MapTemplateDto`, `GenerateScopeSchema`/`GenerateScopeDto`, `UpdateTaskSchema`/`UpdateTaskDto`, `DeclareMilestoneSchema`/`DeclareMilestoneDto`, `ExplainRequestSchema`/`ExplainRequestDto`, and `SiteMilestoneStatusSchema`. Tasks 9–15 parse request bodies with these.

- [ ] **Step 1: Write the failing tests**

Create `libs/contracts/src/project/project.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AddDependencySchema, DeclareMilestoneSchema, ExplainRequestSchema,
  GenerateScopeSchema, MapTemplateSchema, SiteMilestoneStatusSchema, UpdateTaskSchema,
} from './project.js';

const UUID = '01930000-0000-7000-8000-000000000001';
const OTHER = '01930000-0000-7000-8000-000000000002';

describe('AddDependencySchema', () => {
  it('accepts a prerequisite', () => {
    expect(AddDependencySchema.parse({ prerequisiteTaskTypeId: UUID })).toEqual({ prerequisiteTaskTypeId: UUID });
  });

  it('rejects a non-uuid', () => {
    expect(() => AddDependencySchema.parse({ prerequisiteTaskTypeId: 'FOUNDATION' })).toThrow();
  });
});

describe('MapTemplateSchema', () => {
  it('binds a scope variant to a template', () => {
    expect(MapTemplateSchema.parse({ scopeVariant: 'RRU Only', templateId: UUID }))
      .toEqual({ scopeVariant: 'RRU Only', templateId: UUID });
  });

  it('rejects a blank variant, which would collide with the fallback', () => {
    expect(() => MapTemplateSchema.parse({ scopeVariant: '   ', templateId: UUID })).toThrow();
  });
});

describe('GenerateScopeSchema', () => {
  it('defaults to every site in the project', () => {
    expect(GenerateScopeSchema.parse({})).toEqual({ siteIds: [] });
  });

  it('accepts an explicit site subset', () => {
    expect(GenerateScopeSchema.parse({ siteIds: [UUID, OTHER] })).toEqual({ siteIds: [UUID, OTHER] });
  });
});

describe('UpdateTaskSchema', () => {
  it('accepts a status transition', () => {
    expect(UpdateTaskSchema.parse({ status: 'ONGOING' })).toEqual({ status: 'ONGOING' });
  });

  it('rejects a status outside the vocabulary', () => {
    expect(() => UpdateTaskSchema.parse({ status: 'IN_PROGRESS' })).toThrow();
  });

  it('rejects an empty body, which would be a silent no-op write', () => {
    expect(() => UpdateTaskSchema.parse({})).toThrow();
  });
});

describe('DeclareMilestoneSchema', () => {
  it('requires a note explaining the declaration', () => {
    expect(DeclareMilestoneSchema.parse({ note: 'RFI accepted by client 2026-09-19' }))
      .toEqual({ note: 'RFI accepted by client 2026-09-19' });
  });

  it('rejects a blank note — achievement is an accountable act', () => {
    expect(() => DeclareMilestoneSchema.parse({ note: '' })).toThrow();
  });
});

describe('ExplainRequestSchema', () => {
  it('accepts a permission with no resource', () => {
    expect(ExplainRequestSchema.parse({ userId: UUID, permission: 'task.generate' }))
      .toEqual({ userId: UUID, permission: 'task.generate' });
  });

  it('accepts a permission against a named resource', () => {
    expect(ExplainRequestSchema.parse({ userId: UUID, permission: 'task.update', resourceType: 'Task', resourceId: OTHER }))
      .toEqual({ userId: UUID, permission: 'task.update', resourceType: 'Task', resourceId: OTHER });
  });

  it('rejects a resource id with no type', () => {
    expect(() => ExplainRequestSchema.parse({ userId: UUID, permission: 'task.update', resourceId: OTHER })).toThrow();
  });
});

describe('SiteMilestoneStatusSchema', () => {
  it('carries the four lifecycle states and nothing else', () => {
    expect(SiteMilestoneStatusSchema.options).toEqual(['NOT_STARTED', 'IN_PROGRESS', 'ELIGIBLE', 'ACHIEVED']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm nx run @ipms/contracts:test -- project
```

Expected: FAIL at import — `AddDependencySchema` is not exported from `./project.js`.

- [ ] **Step 3: Write the schemas**

Append to `libs/contracts/src/project/project.ts`:

```ts
export const SiteMilestoneStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'ELIGIBLE', 'ACHIEVED']);

export const AddDependencySchema = z.object({
  prerequisiteTaskTypeId: UuidSchema,
}).strip();
export type AddDependencyDto = z.infer<typeof AddDependencySchema>;

/**
 * Binds one of a site's `scope_variant` values to the checklist template that
 * variant uses. `TaskType.templateId` stays the fallback for a site with no
 * variant, or with a variant this task type does not distinguish.
 *
 * The variant is trimmed and must be non-empty: an all-whitespace variant
 * would be a second, invisible key colliding with the fallback path.
 */
export const MapTemplateSchema = z.object({
  scopeVariant: z.string().trim().min(1).max(100),
  templateId: UuidSchema,
}).strip();
export type MapTemplateDto = z.infer<typeof MapTemplateSchema>;

/** An empty `siteIds` means every site in the project that is within scope. */
export const GenerateScopeSchema = z.object({
  siteIds: z.array(UuidSchema).default([]),
}).strip();
export type GenerateScopeDto = z.infer<typeof GenerateScopeSchema>;

export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).max(250).optional(),
  status: TaskStatusSchema.optional(),
  plannedCompletionAt: z.coerce.date().optional(),
}).strip().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided' },
);
export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>;

/**
 * Declaring a milestone achieved is a formal act with an accountable actor, so
 * it carries a mandatory note that lands in the audit ledger alongside the
 * declarer and the timestamp.
 */
export const DeclareMilestoneSchema = z.object({
  note: z.string().trim().min(1).max(1000),
}).strip();
export type DeclareMilestoneDto = z.infer<typeof DeclareMilestoneSchema>;

/**
 * The access simulator's question. A resource id without a type cannot be
 * loaded, and answering the unscoped question instead would hand the caller a
 * permissive verdict to a question they did not ask — see `RESOURCE_NOT_EVALUATED`
 * in `@ipms/authz`.
 */
export const ExplainRequestSchema = z.object({
  userId: UuidSchema,
  permission: z.string().trim().min(1).max(100),
  resourceType: z.enum(['Project', 'Site', 'Task', 'SiteMilestone']).optional(),
  resourceId: UuidSchema.optional(),
}).strip().refine(
  (value) => value.resourceId === undefined || value.resourceType !== undefined,
  { message: 'resourceType is required when resourceId is given' },
);
export type ExplainRequestDto = z.infer<typeof ExplainRequestSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm nx run @ipms/contracts:test
pnpm nx run-many -t typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/contracts
git commit -m "$(cat <<'EOF'
feat(contracts): add the project tracking request schemas

Dependencies, variant-to-template mapping, bulk generation scope, task
updates, milestone declaration, and the access simulator's question.

Three constraints are enforced in the schema rather than left to a service:
an update body must carry at least one field, so an empty PATCH is rejected
rather than writing nothing and reporting success; a milestone declaration
requires a non-blank note, because achievement is an accountable act; and an
explain request carrying a resourceId must name its resourceType, since
answering the unscoped question instead would return a permissive verdict to
a question the caller did not ask.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `project` — schema, indexes, and migration

**Files:**
- Modify: `apps/project/prisma/schema.prisma`
- Create: `apps/project/prisma/migrations/20260919000100_project_tracking/migration.sql`
- Test: `apps/project/prisma/schema.integration.spec.ts`

**Interfaces:**
- Consumes: `OUTBOX_MODEL_SQL` from `@ipms/persistence` (copied verbatim, as every service does).
- Produces: the Prisma models `TaskTypeDependency`, `TaskTypeTemplate`, `SiteMilestone`, `UserScope`, `ProjectionWatermark`, `OutboxEvent`, and a `task.status` `CHECK`. Every later task queries these.

**What is already correct.** `20260918000100_init_project/migration.sql` already creates
`CREATE UNIQUE INDEX "planned_task_per_site_type" ON "task" ("siteId","taskTypeId") WHERE "origin"='PLANNED'`,
with no competing `@@unique` in `schema.prisma`. Do not recreate or rename it. The
defect it guards against is in the *service*, fixed in Tasks 10 and 11.

- [ ] **Step 1: Write the failing test**

Create `apps/project/prisma/schema.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/project';
import { uuidv7 } from '@ipms/contracts';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let projectId: string;
let siteId: string;
let milestoneId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // `new URL(..., import.meta.url).pathname` can come back percent-encoded on
    // macOS; fileURLToPath decodes correctly.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  projectId = uuidv7();
  siteId = uuidv7();
  milestoneId = uuidv7();
  await prisma.project.create({ data: { id: projectId, code: 'NCELL14', name: 'Ncell Phase 14' } });
  await prisma.site.create({ data: { id: siteId, projectId, siteCode: 'KOS121', name: 'Koshi 121' } });
  await prisma.milestone.create({
    data: { id: milestoneId, projectId, code: 'CW_RFI', name: 'CW RFI', kind: 'PROJECT', sequence: 1 },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

describe('UserScope partial unique indexes', () => {
  // Postgres treats NULL as never equal to NULL in a unique index, so one
  // composite unique over the nullable columns would enforce nothing for the
  // global and project-scoped shapes. Three partial indexes instead — the same
  // fix f9da4c5 applied to iam's UserRole.
  const userId = '01930000-0000-7000-8000-0000000000aa';

  it('rejects a duplicate global grant', async () => {
    await prisma.userScope.create({ data: { id: uuidv7(), userId, level: 'GLOBAL' } });
    await expect(prisma.userScope.create({ data: { id: uuidv7(), userId, level: 'GLOBAL' } })).rejects.toThrow();
  });

  it('rejects a duplicate project grant', async () => {
    await prisma.userScope.create({ data: { id: uuidv7(), userId, level: 'PROJECT', projectId } });
    await expect(
      prisma.userScope.create({ data: { id: uuidv7(), userId, level: 'PROJECT', projectId } }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate site grant', async () => {
    await prisma.userScope.create({ data: { id: uuidv7(), userId, level: 'SITE', siteId } });
    await expect(
      prisma.userScope.create({ data: { id: uuidv7(), userId, level: 'SITE', siteId } }),
    ).rejects.toThrow();
  });

  it('lets all three levels coexist for one user', async () => {
    const rows = await prisma.userScope.findMany({ where: { userId } });
    expect(rows.map((r) => r.level).sort()).toEqual(['GLOBAL', 'PROJECT', 'SITE']);
  });
});

describe('SiteMilestone', () => {
  it('is unique per site and milestone', async () => {
    await prisma.siteMilestone.create({ data: { id: uuidv7(), siteId, milestoneId, status: 'NOT_STARTED' } });
    await expect(
      prisma.siteMilestone.create({ data: { id: uuidv7(), siteId, milestoneId, status: 'NOT_STARTED' } }),
    ).rejects.toThrow();
  });
});

describe('TaskTypeTemplate', () => {
  it('is unique per task type and scope variant', async () => {
    const taskTypeId = uuidv7();
    await prisma.taskType.create({
      data: { id: taskTypeId, projectId, code: 'CW_INSTALL', name: 'CW Install', category: 'QUALITY' },
    });
    await prisma.taskTypeTemplate.create({ data: { taskTypeId, scopeVariant: 'RRU Only', templateId: uuidv7() } });
    await expect(
      prisma.taskTypeTemplate.create({ data: { taskTypeId, scopeVariant: 'RRU Only', templateId: uuidv7() } }),
    ).rejects.toThrow();
  });
});

describe('TaskTypeDependency', () => {
  it('refuses a task type that depends on itself', async () => {
    const taskTypeId = uuidv7();
    await prisma.taskType.create({
      data: { id: taskTypeId, projectId, code: 'SELF_DEP', name: 'Self', category: 'QUALITY' },
    });
    await expect(
      prisma.taskTypeDependency.create({ data: { taskTypeId, prerequisiteTaskTypeId: taskTypeId } }),
    ).rejects.toThrow();
  });
});

describe('task.status', () => {
  it('refuses a status outside the domain vocabulary', async () => {
    const taskTypeId = uuidv7();
    await prisma.taskType.create({
      data: { id: taskTypeId, projectId, code: 'STATUS_CHK', name: 'Status', category: 'QUALITY' },
    });
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "task" ("id","projectId","siteId","taskTypeId","title","status","origin","createdBy")
         VALUES ($1,$2,$3,$4,'bad status','IN_PROGRESS','AD_HOC',$5)`,
        uuidv7(), projectId, siteId, taskTypeId, uuidv7(),
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm nx run project:test -- schema.integration
```

Expected: FAIL — `prisma.userScope` is undefined, because the model does not exist.

- [ ] **Step 3: Add the models to `schema.prisma`**

Append to `apps/project/prisma/schema.prisma`, and add the listed back-relations to the existing models:

```prisma
/// Local projection of iam's authoritative scope grants, replicated over
/// JetStream. Written ONLY by the scope consumer, never by a request handler.
///
/// Uniqueness is enforced by three partial indexes in migration.sql, not by an
/// @@unique here: Postgres treats NULL as never equal to NULL in a unique
/// index, so a composite unique over the nullable columns would silently
/// accept unlimited duplicate global and project-scoped rows. Declaring an
/// @@unique as well would make `prisma migrate dev` try to "correct" the
/// partial indexes away. Same hazard, same fix as iam's UserRole (f9da4c5).
model UserScope {
  id        String   @id @db.Uuid
  userId    String   @db.Uuid
  level     String   @db.VarChar(10)
  projectId String?  @db.Uuid
  siteId    String?  @db.Uuid
  grantedAt DateTime @default(now()) @db.Timestamptz(6)

  @@index([userId])
  @@map("user_scope")
}

/// Records that the scope projection has been populated at least once.
///
/// Distinguishes "this user genuinely has no scope" from "nothing has been
/// replicated yet". Both look like an empty UserScope table, and they demand
/// opposite behaviour: the first denies correctly, the second must trigger a
/// rebuild. See scope/replay.ts.
model ProjectionWatermark {
  name      String   @id @db.VarChar(50)
  updatedAt DateTime @updatedAt @db.Timestamptz(6)

  @@map("projection_watermark")
}

/// "Foundation before erection" — a rule about work, not about KOS121, so it
/// is held at the task-type level (D11). Blocking is computed on read; nothing
/// is stored on Task.
model TaskTypeDependency {
  taskTypeId             String   @db.Uuid
  prerequisiteTaskTypeId String   @db.Uuid
  taskType               TaskType @relation("dependent", fields: [taskTypeId], references: [id], onDelete: Cascade)
  prerequisite           TaskType @relation("prerequisite", fields: [prerequisiteTaskTypeId], references: [id], onDelete: Cascade)

  @@id([taskTypeId, prerequisiteTaskTypeId])
  @@map("task_type_dependency")
}

/// Resolves a site's scope_variant to the checklist template that variant uses
/// — the "Antenna + RRU / RRU Only / Board + Jumper" finding. TaskType.templateId
/// remains the fallback for a site with no variant, or a variant this task type
/// does not distinguish, so a task type whose checklist does not vary needs no
/// rows here at all.
model TaskTypeTemplate {
  taskTypeId   String   @db.Uuid
  scopeVariant String   @db.VarChar(100)
  templateId   String   @db.Uuid
  taskType     TaskType @relation(fields: [taskTypeId], references: [id], onDelete: Cascade)

  @@id([taskTypeId, scopeVariant])
  @@map("task_type_template")
}

/// ELIGIBLE is computed from the site's tasks; ACHIEVED is declared by a PM
/// with an accountable actor and timestamp. Project-level progress is a query
/// over these rows and is never stored (D10).
model SiteMilestone {
  id         String    @id @db.Uuid
  siteId     String    @db.Uuid
  milestoneId String   @db.Uuid
  status     String    @default("NOT_STARTED") @db.VarChar(20)
  targetDate DateTime? @db.Date
  eligibleAt DateTime? @db.Timestamptz(6)
  achievedAt DateTime? @db.Timestamptz(6)
  declaredBy String?   @db.Uuid
  site       Site      @relation(fields: [siteId], references: [id], onDelete: Cascade)
  milestone  Milestone @relation(fields: [milestoneId], references: [id], onDelete: Cascade)

  @@unique([siteId, milestoneId])
  @@index([milestoneId, status])
  @@map("site_milestone")
}

/// Embedded verbatim from OUTBOX_MODEL_SQL in @ipms/persistence, as every
/// service does. A mutation writes its audit row in the same transaction as
/// the change, so a crash between commit and publish cannot lose it.
model OutboxEvent {
  id            String    @id @db.Uuid
  subject       String    @db.VarChar(100)
  payload       Json
  correlationId String    @db.VarChar(64)
  actorId       String?   @db.Uuid
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  publishedAt   DateTime? @db.Timestamptz(6)

  @@index([publishedAt, createdAt])
  @@map("outbox_event")
}
```

Add these back-relations to the existing models — Prisma fails to generate without them:

- On `TaskType`: `dependencies TaskTypeDependency[] @relation("dependent")`, `dependents TaskTypeDependency[] @relation("prerequisite")`, `templates TaskTypeTemplate[]`
- On `Site`: `siteMilestones SiteMilestone[]`
- On `Milestone`: `siteMilestones SiteMilestone[]`

- [ ] **Step 4: Write the migration**

Create `apps/project/prisma/migrations/20260919000100_project_tracking/migration.sql`:

```sql
CREATE TABLE "user_scope" (
  "id" uuid PRIMARY KEY,
  "userId" uuid NOT NULL,
  "level" varchar(10) NOT NULL,
  "projectId" uuid,
  "siteId" uuid,
  "grantedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_scope_level_check" CHECK ("level" IN ('GLOBAL','PROJECT','SITE')),
  -- A PROJECT grant without a project, or a SITE grant without a site, is a
  -- replication bug that would otherwise sit in the table widening or
  -- narrowing someone's access silently.
  CONSTRAINT "user_scope_shape_check" CHECK (
    ("level" = 'GLOBAL'  AND "projectId" IS NULL AND "siteId" IS NULL)
    OR ("level" = 'PROJECT' AND "projectId" IS NOT NULL AND "siteId" IS NULL)
    OR ("level" = 'SITE'    AND "siteId" IS NOT NULL)
  )
);
CREATE INDEX "user_scope_userId_idx" ON "user_scope"("userId");

-- Three partial unique indexes, not one composite unique. Postgres treats NULL
-- as never equal to NULL in a unique index, so a composite over these nullable
-- columns would only ever reject duplicates of the fully site-scoped shape and
-- would silently accept unlimited duplicate global and project grants. This is
-- the same hazard iam's UserRole hit in f9da4c5.
CREATE UNIQUE INDEX "user_scope_global_uniq"  ON "user_scope"("userId")              WHERE "level" = 'GLOBAL';
CREATE UNIQUE INDEX "user_scope_project_uniq" ON "user_scope"("userId","projectId")  WHERE "level" = 'PROJECT';
CREATE UNIQUE INDEX "user_scope_site_uniq"    ON "user_scope"("userId","siteId")     WHERE "level" = 'SITE';

CREATE TABLE "projection_watermark" (
  "name" varchar(50) PRIMARY KEY,
  "updatedAt" timestamptz NOT NULL
);

CREATE TABLE "task_type_dependency" (
  "taskTypeId" uuid NOT NULL REFERENCES "task_type"("id") ON DELETE CASCADE,
  "prerequisiteTaskTypeId" uuid NOT NULL REFERENCES "task_type"("id") ON DELETE CASCADE,
  PRIMARY KEY ("taskTypeId","prerequisiteTaskTypeId"),
  -- A self-dependency makes the task type permanently unstartable. Cycles
  -- across several types are refused in the service (Task 10); this catches
  -- the one-hop case at the cheapest possible layer.
  CONSTRAINT "task_type_dependency_not_self" CHECK ("taskTypeId" <> "prerequisiteTaskTypeId")
);

CREATE TABLE "task_type_template" (
  "taskTypeId" uuid NOT NULL REFERENCES "task_type"("id") ON DELETE CASCADE,
  "scopeVariant" varchar(100) NOT NULL,
  "templateId" uuid NOT NULL,
  PRIMARY KEY ("taskTypeId","scopeVariant")
);

CREATE TABLE "site_milestone" (
  "id" uuid PRIMARY KEY,
  "siteId" uuid NOT NULL REFERENCES "site"("id") ON DELETE CASCADE,
  "milestoneId" uuid NOT NULL REFERENCES "milestone"("id") ON DELETE CASCADE,
  "status" varchar(20) NOT NULL DEFAULT 'NOT_STARTED',
  "targetDate" date,
  "eligibleAt" timestamptz,
  "achievedAt" timestamptz,
  "declaredBy" uuid,
  UNIQUE ("siteId","milestoneId"),
  CONSTRAINT "site_milestone_status_check"
    CHECK ("status" IN ('NOT_STARTED','IN_PROGRESS','ELIGIBLE','ACHIEVED')),
  -- ACHIEVED is a declaration by an accountable actor. A row claiming
  -- achievement with no declarer and no timestamp is not a milestone, it is a
  -- bug that has already destroyed the audit story.
  CONSTRAINT "site_milestone_achieved_shape"
    CHECK ("status" <> 'ACHIEVED' OR ("declaredBy" IS NOT NULL AND "achievedAt" IS NOT NULL))
);
CREATE INDEX "site_milestone_milestoneId_status_idx" ON "site_milestone"("milestoneId","status");

CREATE TABLE "outbox_event" (
  "id" uuid PRIMARY KEY,
  "subject" varchar(100) NOT NULL,
  "payload" jsonb NOT NULL,
  "correlationId" varchar(64) NOT NULL,
  "actorId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "publishedAt" timestamptz
);
CREATE INDEX "outbox_event_publishedAt_createdAt_idx" ON "outbox_event"("publishedAt","createdAt");

-- The status vocabulary is IEPMS's, deliberately (D12). A CHECK rather than a
-- Prisma enum, so an event handler writing a status the domain does not have
-- fails at the database instead of persisting a value every read then has to
-- defend against.
ALTER TABLE "task" ADD CONSTRAINT "task_status_check"
  CHECK ("status" IN ('NOT_STARTED','ONGOING','REVIEWING','RECTIFYING','COMPLETED','CANCELLED'));

ALTER TABLE "task" ADD CONSTRAINT "task_origin_check"
  CHECK ("origin" IN ('PLANNED','AD_HOC'));

CREATE INDEX "task_siteId_taskTypeId_status_idx" ON "task"("siteId","taskTypeId","status");
CREATE INDEX "task_assigneeId_idx" ON "task"("assigneeId");
```

- [ ] **Step 5: Regenerate the client and run the test**

```bash
(cd apps/project && DATABASE_URL=postgresql://x:x@localhost:5432/x pnpm prisma generate)
pnpm nx run project:test -- schema.integration
```

Expected: PASS, 8 tests. If `prisma generate` complains about a missing opposite relation, add the back-relations from Step 3.

- [ ] **Step 6: Extract the container harness**

Six later specs need the same Postgres container, the same `migrate deploy`, and the
same seed. Write it once. Create `apps/project/src/testing/harness.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/project';
import { EventBus } from '@ipms/events';
import { uuidv7 } from '@ipms/contracts';
import type { AuthzScope } from '@ipms/authz';

export interface Harness {
  prisma: PrismaClient;
  stop(): Promise<void>;
}

export interface NatsHarness extends Harness {
  bus: EventBus;
  /** JetStream delivery is not synchronous; give the consumer time to run. */
  settle(ms?: number): Promise<void>;
}

/** Starts Postgres, applies every migration, and returns a connected client. */
export async function startDatabase(): Promise<Harness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // `new URL(..., import.meta.url).pathname` can come back percent-encoded on
    // macOS when the path contains escaped characters; fileURLToPath decodes.
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return {
    prisma,
    async stop() { await prisma.$disconnect(); await container.stop(); },
  };
}

/** Postgres plus a JetStream-enabled NATS, for the consumer specs. */
export async function startDatabaseAndBus(): Promise<NatsHarness> {
  const db = await startDatabase();
  const container: StartedTestContainer = await new GenericContainer('nats:2.10-alpine')
    .withCommand(['-js', '-sd', '/data']).withExposedPorts(4222).start();
  const bus = new EventBus();
  await bus.connect(`nats://${container.getHost()}:${container.getMappedPort(4222)}`);
  await bus.ensureStreams();
  return {
    prisma: db.prisma,
    bus,
    async settle(ms = 600) { await new Promise((resolve) => setTimeout(resolve, ms)); },
    async stop() { await bus.close(); await container.stop(); await db.stop(); },
  };
}

export interface Fixture {
  projectA: string; projectB: string;
  siteInA: string; otherSiteInA: string; siteInB: string;
  foundationId: string; erectId: string; taskTypeInB: string;
  milestoneInA: string; milestoneInB: string;
  defaultTemplate: string; rruTemplate: string;
}

export const ACTOR = '01930000-0000-7000-8000-0000000000aa';
export const ENGINEER = '01930000-0000-7000-8000-0000000000bb';
export const REVIEWER = '01930000-0000-7000-8000-0000000000cc';
export const ATTACKER = '01930000-0000-7000-8000-0000000000dd';

export const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
export const NOTHING: AuthzScope = { global: false, projectIds: [], siteIds: [] };
export const onlyProject = (id: string): AuthzScope => ({ global: false, projectIds: [id], siteIds: [] });
export const onlySite = (id: string): AuthzScope => ({ global: false, projectIds: [], siteIds: [id] });

/**
 * Two projects, so every scoping assertion has something it must NOT see.
 * ERECT depends on FOUNDATION in project A, which is what the blocking and
 * milestone tests are built on.
 */
export async function seed(prisma: PrismaClient): Promise<Fixture> {
  const f: Fixture = {
    projectA: uuidv7(), projectB: uuidv7(),
    siteInA: uuidv7(), otherSiteInA: uuidv7(), siteInB: uuidv7(),
    foundationId: uuidv7(), erectId: uuidv7(), taskTypeInB: uuidv7(),
    milestoneInA: uuidv7(), milestoneInB: uuidv7(),
    defaultTemplate: uuidv7(), rruTemplate: uuidv7(),
  };

  await prisma.project.create({ data: { id: f.projectA, code: 'NCELL14', name: 'Ncell Phase 14' } });
  await prisma.project.create({ data: { id: f.projectB, code: 'OTHER9', name: 'Other Client 9' } });
  await prisma.site.createMany({ data: [
    { id: f.siteInA, projectId: f.projectA, siteCode: 'KOS121', name: 'Koshi 121' },
    { id: f.otherSiteInA, projectId: f.projectA, siteCode: 'KOS232', name: 'Koshi 232' },
    { id: f.siteInB, projectId: f.projectB, siteCode: 'BKT900', name: 'Bhaktapur 900' },
  ] });
  await prisma.taskType.createMany({ data: [
    { id: f.foundationId, projectId: f.projectA, code: 'FOUNDATION', name: 'Foundation', category: 'QUALITY', templateId: f.defaultTemplate },
    { id: f.erectId, projectId: f.projectA, code: 'ERECT', name: 'Erection', category: 'QUALITY', templateId: f.defaultTemplate },
    { id: f.taskTypeInB, projectId: f.projectB, code: 'FOUNDATION', name: 'Foundation', category: 'QUALITY', templateId: f.defaultTemplate },
  ] });
  await prisma.taskTypeDependency.create({
    data: { taskTypeId: f.erectId, prerequisiteTaskTypeId: f.foundationId },
  });
  await prisma.milestone.createMany({ data: [
    { id: f.milestoneInA, projectId: f.projectA, code: 'CW_RFI', name: 'CW RFI', kind: 'PROJECT', sequence: 1 },
    { id: f.milestoneInB, projectId: f.projectB, code: 'CW_RFI', name: 'CW RFI', kind: 'PROJECT', sequence: 1 },
  ] });
  await prisma.milestoneRequirement.createMany({ data: [
    { milestoneId: f.milestoneInA, taskTypeId: f.foundationId },
    { milestoneId: f.milestoneInA, taskTypeId: f.erectId },
    { milestoneId: f.milestoneInB, taskTypeId: f.taskTypeInB },
  ] });
  return f;
}

/** Drops every row the fixtures create, in dependency order. */
export async function reset(prisma: PrismaClient): Promise<void> {
  await prisma.outboxEvent.deleteMany({});
  await prisma.siteMilestone.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.milestoneRequirement.deleteMany({});
  await prisma.milestone.deleteMany({});
  await prisma.taskTypeDependency.deleteMany({});
  await prisma.taskTypeTemplate.deleteMany({});
  await prisma.taskType.deleteMany({});
  await prisma.site.deleteMany({});
  await prisma.region.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.userScope.deleteMany({});
  await prisma.projectionWatermark.deleteMany({});
}
```

Every integration spec from here on opens with the same six lines, and none of them
repeats a container preamble:

```ts
let h: Harness;
let f: Fixture;
beforeAll(async () => { h = await startDatabase(); }, 240_000);
afterAll(async () => { await h?.stop(); });
beforeEach(async () => { await reset(h.prisma); f = await seed(h.prisma); });
```

- [ ] **Step 7: Commit**

```bash
git add apps/project libs/persistence
git commit -m "$(cat <<'EOF'
feat(project): add SiteMilestone, dependencies, variant templates and the scope projection

Schema for sub-project 2. Four constraints are worth calling out, because each
closes a failure that is invisible until it is expensive:

- UserScope uses three partial unique indexes, not one composite @@unique.
  Postgres treats NULL as never equal to NULL in a unique index, so a
  composite over the nullable columns would reject only the fully site-scoped
  shape and accept unlimited duplicate global grants. Same hazard, same fix as
  iam's UserRole in f9da4c5.

- user_scope_shape_check refuses a PROJECT grant with no project and a SITE
  grant with no site. Either would be a replication bug quietly widening or
  narrowing someone's access.

- site_milestone_achieved_shape refuses ACHIEVED without a declarer and a
  timestamp. Achievement is a formal act; a row without an actor has already
  destroyed the audit story.

- task.status is a CHECK rather than a Prisma enum, so an event handler
  writing a status outside the IEPMS vocabulary fails at the database instead
  of persisting a value every read then defends against.

The existing planned_task_per_site_type partial unique index is left alone --
it is already correct. The read-then-write that ignores it is fixed in the
service tasks.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `iam` — global scope as a real grant

The one place this sub-project reaches back into sub-project 1, and it is blocking:
`AuthzScope.global` is never set `true` anywhere, so the first service to enforce scope
at query level locks `SUPER_ADMIN` out of the system it administers. See the design
§4.3.

**Files:**
- Modify: `libs/authz/src/permissions.ts` — add `scope.grant_global`, `scope.revoke_global`
- Modify: `apps/iam/prisma/schema.prisma` — add `UserGlobalScope`, back-relation on `User`
- Create: `apps/iam/prisma/migrations/20260919000200_global_scope/migration.sql`
- Modify: `apps/iam/src/scopes/scopes.service.ts` — `grantGlobal`, `revokeGlobal`
- Modify: `apps/iam/src/scopes/scopes.controller.ts` — two routes
- Modify: `apps/iam/src/effective/effective.service.ts:61-67` — `toScope`
- Modify: `apps/iam/prisma/seed.ts` — grant global scope to `admin`
- Test: `apps/iam/src/scopes/scopes.service.spec.ts` (modify), `apps/iam/src/effective/effective.service.spec.ts` (modify)

**Interfaces:**
- Consumes: `SUBJECTS.IAM_SCOPE_GRANTED` / `IAM_SCOPE_REVOKED` with `level: 'GLOBAL'`, already declared in the `IamScopeGranted` payload.
- Produces: `ScopesService.grantGlobal(userId, actorId)` and `revokeGlobal(userId, actorId)`; `AuthzScope.global === true` for a user with a `UserGlobalScope` row. Task 7's projection maps the `GLOBAL` event level onto it.

- [ ] **Step 1: Write the failing tests**

Append to `apps/iam/src/effective/effective.service.spec.ts` — follow the existing fake-Prisma pattern in that file, adding `globalScopes` to whatever fixture `LoadedUser` it builds:

```ts
describe('global scope', () => {
  it('reports global when the user holds a global grant', async () => {
    const service = serviceFor({ ...baseUser, globalScopes: [{ id: 'g-1' }] });
    const result = await service.effectiveFor(baseUser.id);
    expect(result.scope.global).toBe(true);
  });

  it('reports non-global with no grant, whatever roles the user holds', async () => {
    const service = serviceFor({ ...baseUser, globalScopes: [] });
    const result = await service.effectiveFor(baseUser.id);
    // Holding SUPER_ADMIN is not itself global reach. Scope is replicated from
    // the scope tables; roles travel in the token. Conflating them would put
    // scope back in the JWT, which §6 of the architecture exists to prevent.
    expect(result.scope.global).toBe(false);
  });
});
```

Append to `apps/iam/src/scopes/scopes.service.spec.ts`:

```ts
describe('grantGlobal', () => {
  it('emits a GLOBAL scope event and audits the grant', async () => {
    const { service, outbox } = build();
    await service.grantGlobal(TARGET_USER, ACTOR);
    const subjects = outbox.map((row) => row.subject);
    expect(subjects).toContain('iam.scope.granted');
    const granted = outbox.find((row) => row.subject === 'iam.scope.granted');
    expect(granted?.payload).toMatchObject({ userId: TARGET_USER, level: 'GLOBAL', projectId: null, siteId: null });
    expect(subjects).toContain('audit.event.recorded');
  });

  it('is idempotent — a second grant writes no second row and no second event', async () => {
    const { service, outbox } = build();
    await service.grantGlobal(TARGET_USER, ACTOR);
    const after = outbox.length;
    await service.grantGlobal(TARGET_USER, ACTOR);
    expect(outbox).toHaveLength(after);
  });

  it('refuses an actor granting global scope to themselves', async () => {
    const { service } = build();
    // The same self-escalation rule createOverride enforces. Granting yourself
    // global reach is the single largest privilege escalation in the system.
    await expect(service.grantGlobal(ACTOR, ACTOR)).rejects.toThrow(/own account|themselves/i);
  });

  it('revokes and bumps the token version so the change takes effect at once', async () => {
    const { service, outbox, tokenVersions } = build();
    await service.grantGlobal(TARGET_USER, ACTOR);
    await service.revokeGlobal(TARGET_USER, ACTOR);
    expect(outbox.map((r) => r.subject)).toContain('iam.scope.revoked');
    expect(tokenVersions).toContainEqual(expect.objectContaining({ userId: TARGET_USER }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm nx run iam:test -- scopes.service effective.service
```

Expected: FAIL — `service.grantGlobal is not a function`.

- [ ] **Step 3: Add the permissions**

In `libs/authz/src/permissions.ts`, after the `scope.revoke` line:

```ts
  // Separate from scope.grant on purpose. Global reach is qualitatively
  // different from access to one project: it is the largest grant the system
  // can make, and an administrator trusted to scope a PM onto a project is not
  // thereby trusted to hand out the whole platform. Only SUPER_ADMIN holds it,
  // because SUPER_ADMIN holds every permission.
  def('scope', 'grant_global', 'Grant global scope', ['scope.view', 'scope.grant', 'user.view']),
  def('scope', 'revoke_global', 'Revoke global scope', ['scope.view', 'scope.revoke', 'user.view']),
```

- [ ] **Step 4: Add the model and migration**

In `apps/iam/prisma/schema.prisma`, add the model and a `globalScopes UserGlobalScope[]` back-relation on `User`:

```prisma
/// Global reach: this user sees every project and every site.
///
/// A table rather than a flag on User, and rather than a role code, because
/// scope is replicated to other services over NATS and must never travel in
/// the JWT (architecture §6). A row here emits iam.scope.granted with
/// level GLOBAL — a level the IamScopeGranted payload already declared; only
/// the producer was missing.
///
/// UNIQUE(userId) is safe as a plain @@unique: userId is NOT NULL, so the
/// NULL-distinctness hazard that forced partial indexes on UserRole does not
/// apply here.
model UserGlobalScope {
  id        String   @id @db.Uuid
  userId    String   @unique @db.Uuid
  createdBy String   @db.Uuid
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_global_scope")
}
```

Create `apps/iam/prisma/migrations/20260919000200_global_scope/migration.sql`:

```sql
CREATE TABLE "user_global_scope" (
  "id" uuid PRIMARY KEY,
  "userId" uuid NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
  "createdBy" uuid NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 5: Make `toScope` read it**

In `apps/iam/src/effective/effective.service.ts`, replace `toScope` and include `globalScopes` in the `LoadedUser` query's `include`:

```ts
  private toScope(user: LoadedUser): AuthzScope {
    return {
      // Was hardcoded `false`, which meant nothing in the platform ever had
      // global reach. No service noticed because none enforced scope at query
      // level; `project` is the first, and a hardcoded false locks SUPER_ADMIN
      // out of the system it administers.
      global: user.globalScopes.length > 0,
      projectIds: user.projectScopes.map((s) => s.projectId),
      siteIds: user.siteScopes.map((s) => s.siteId),
    };
  }
```

- [ ] **Step 6: Add the service methods**

In `apps/iam/src/scopes/scopes.service.ts`, mirroring `grantProject` / `revokeProject` exactly:

```ts
  /**
   * Global reach for one user.
   *
   * `revokeTokens` runs on both paths, unlike the project and site grants.
   * Those only change replicated scope, which each service re-reads from its
   * own projection on the next request. Global scope changes the answer to
   * *every* authorization question at once, so leaving outstanding tokens
   * alive for up to their full TTL after a revocation is not acceptable —
   * the same reasoning `createOverride` uses.
   */
  async grantGlobal(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      // The same self-escalation rule createOverride enforces, for the largest
      // grant the system can make.
      throw new ForbiddenException('An actor cannot grant global scope to their own account');
    }
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      const existing = await tx.userGlobalScope.findUnique({ where: { userId } });
      if (existing) return;   // idempotent: no duplicate row, no duplicate event

      await tx.userGlobalScope.create({ data: { id: uuidv7(), userId, createdBy: actorId } });
      await this.revokeTokens(tx, userId);
      await this.emit(tx, SUBJECTS.IAM_SCOPE_GRANTED, { userId, level: 'GLOBAL', projectId: null, siteId: null }, actorId);
      await this.audit(tx, actorId, 'scope.global_granted', 'User', userId, {}, { level: 'GLOBAL' });
    });
  }

  async revokeGlobal(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      // Symmetrical with grantGlobal, and with revokeOverride: an actor must
      // never edit their own authorization in either direction.
      throw new ForbiddenException('An actor cannot revoke global scope from their own account');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.userGlobalScope.deleteMany({ where: { userId } });
      if (count === 0) return;

      await this.revokeTokens(tx, userId);
      await this.emit(tx, SUBJECTS.IAM_SCOPE_REVOKED, { userId, level: 'GLOBAL', projectId: null, siteId: null }, actorId);
      await this.audit(tx, actorId, 'scope.global_revoked', 'User', userId, { level: 'GLOBAL' }, {});
    });
  }
```

- [ ] **Step 7: Add the routes**

In `apps/iam/src/scopes/scopes.controller.ts`, alongside the project and site routes:

```ts
  @Post('users/:id/global-scope')
  @RequirePermission('scope.grant_global')
  async grantGlobal(@Param('id') id: string, @Req() req: { user: AuthzUser }): Promise<void> {
    await this.service.grantGlobal(UuidSchema.parse(id), req.user.id);
  }

  @Delete('users/:id/global-scope')
  @RequirePermission('scope.revoke_global')
  async revokeGlobal(@Param('id') id: string, @Req() req: { user: AuthzUser }): Promise<void> {
    await this.service.revokeGlobal(UuidSchema.parse(id), req.user.id);
  }
```

Also include the flag in the existing `GET users/:id/scopes` response so an operator can see it: extend `ScopesService.listForUser` to return `{ global: boolean; projectIds: string[]; siteIds: string[] }`, reading `await this.prisma.userGlobalScope.findUnique({ where: { userId } }) !== null`.

- [ ] **Step 8: Seed it for `admin`**

In `apps/iam/prisma/seed.ts`, after the demo users are created:

```ts
  /**
   * The seeded SUPER_ADMIN needs global scope, not just every permission.
   * Permissions answer "may you do this kind of thing"; scope answers "to
   * which projects". Without a row here, `admin` holds every permission and
   * can see nothing at all the moment a service enforces scope at query level.
   */
  const admin = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (admin) {
    await prisma.userGlobalScope.upsert({
      where: { userId: admin.id },
      update: {},
      create: { id: uuidv7(), userId: admin.id, createdBy: admin.id },
    });
  }
```

- [ ] **Step 9: Run the tests**

```bash
(cd apps/iam && DATABASE_URL=postgresql://x:x@localhost:5432/x pnpm prisma generate)
pnpm nx run iam:test
pnpm nx run @ipms/authz:test
pnpm nx run-many -t typecheck
```

Expected: all PASS. The `permissions.spec.ts` dependency-closure test covers the two new codes automatically; if it asserts a fixed permission count, update that number.

- [ ] **Step 10: Commit**

```bash
git add libs/authz apps/iam
git commit -m "$(cat <<'EOF'
feat(iam,authz): grant global scope as a real, replicated grant

AuthzScope.global was never set true anywhere in the platform. toScope()
hardcoded false, no table granted it, and the seed created no scope rows for
admin. Nothing noticed because no service enforced scope at query level --
project is the first, and the moment it does, the seeded SUPER_ADMIN holds
every permission and can see nothing.

UserGlobalScope is a table, not a flag on User and not a role code, because
scope is replicated to other services over NATS and must never travel in the
JWT. It emits iam.scope.granted with level GLOBAL -- a level the
IamScopeGranted payload already declared, so only the producer was missing.

scope.grant_global is a separate permission from scope.grant. An administrator
trusted to scope a PM onto a project is not thereby trusted to hand out the
whole platform. Both paths refuse an actor targeting their own account, the
same self-escalation rule createOverride enforces, and both bump tokenVersion
-- global scope changes the answer to every authorization question at once, so
outstanding tokens cannot be left alive for their full TTL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `project` — the scope projection

**Files:**
- Create: `apps/project/src/scope/user-scope.repository.ts`
- Create: `apps/project/src/scope/scope.provider.ts`
- Create: `apps/project/src/scope/scope.consumer.ts`
- Test: `apps/project/src/scope/scope.consumer.spec.ts`

**Interfaces:**
- Consumes: `IamScopeGranted`, `IamScopeRevoked`, `IamUserDeactivated`, `SUBJECTS` from `@ipms/events`; `AuthzScope`, `ScopeProvider` from `@ipms/authz`; `PrismaClient` from `@prisma-clients/project`.
- Produces:
  - `class UserScopeRepository` with `applyGranted(e: IamScopeGranted): Promise<void>`, `applyRevoked(e: IamScopeRevoked): Promise<void>`, `clearUser(userId: string): Promise<void>`, `scopeFor(userId: string): Promise<AuthzScope>`, `isEmpty(): Promise<boolean>`
  - `function projectScopeProvider(repo: UserScopeRepository): ScopeProvider`
  - `class ScopeConsumer` with `register(consumer: DurableConsumer): Promise<void>`

**Why role events are not here.** `STREAMS.IAM` lists `iam.role.assigned` and
`iam.role.removed`, and it is tempting to consume them. Do not. `iam`'s authoritative
`EffectiveService.toScope()` derives scope from `UserProjectScope` and `UserSiteScope`
alone — a scoped `UserRole` contributes nothing to it. Mirroring role events into this
projection would grant reach `iam` does not recognise, and the two would disagree about
the same user. A role assignment changes the *permission* set, which travels in the JWT.

- [ ] **Step 1: Write the failing test**

Create `apps/project/src/scope/scope.consumer.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { UserScopeRepository } from './user-scope.repository.js';
import { projectScopeProvider } from './scope.provider.js';

const USER = '01930000-0000-7000-8000-0000000000aa';
const OTHER = '01930000-0000-7000-8000-0000000000bb';
const PROJECT_A = '01930000-0000-7000-8000-00000000a001';
const PROJECT_C = '01930000-0000-7000-8000-00000000a003';
const SITE_B = '01930000-0000-7000-8000-00000000b002';

/**
 * An in-memory stand-in for the two Prisma calls the repository makes. Small
 * enough to be obviously correct, which is what a fake for a boundary should
 * be; the real table's constraints are proven in the integration test.
 */
function fakePrisma() {
  const rows: Array<{ id: string; userId: string; level: string; projectId: string | null; siteId: string | null }> = [];
  return {
    rows,
    userScope: {
      async findMany({ where }: { where: { userId: string } }) {
        return rows.filter((r) => r.userId === where.userId);
      },
      async create({ data }: { data: (typeof rows)[number] }) {
        const clash = rows.find(
          (r) => r.userId === data.userId && r.level === data.level
            && r.projectId === data.projectId && r.siteId === data.siteId,
        );
        if (clash) throw Object.assign(new Error('unique'), { code: 'P2002' });
        rows.push(data);
        return data;
      },
      async deleteMany({ where }: { where: Record<string, unknown> }) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const row = rows[i]!;
          const match = Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
          if (match) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      },
      async count() { return rows.length; },
    },
  };
}

function build() {
  const prisma = fakePrisma();
  const repo = new UserScopeRepository(prisma as never);
  return { prisma, repo, provider: projectScopeProvider(repo) };
}

describe('UserScopeRepository', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => { ctx = build(); });

  it('denies a user with nothing replicated', async () => {
    // Fail-closed. An unreplicated projection is indistinguishable from "no
    // scope" for one user, and denying is the only safe reading of both.
    expect(await ctx.provider.for(USER)).toEqual({ global: false, projectIds: [], siteIds: [] });
  });

  it('maps a GLOBAL grant onto AuthzScope.global', async () => {
    await ctx.repo.applyGranted({ userId: USER, level: 'GLOBAL', projectId: null, siteId: null });
    expect(await ctx.provider.for(USER)).toEqual({ global: true, projectIds: [], siteIds: [] });
  });

  it('accumulates project and site grants for one user', async () => {
    await ctx.repo.applyGranted({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    await ctx.repo.applyGranted({ userId: USER, level: 'SITE', projectId: PROJECT_C, siteId: SITE_B });
    expect(await ctx.provider.for(USER)).toEqual({
      global: false, projectIds: [PROJECT_A], siteIds: [SITE_B],
    });
  });

  it('is idempotent on a redelivered grant', async () => {
    const event = { userId: USER, level: 'PROJECT' as const, projectId: PROJECT_A, siteId: null };
    await ctx.repo.applyGranted(event);
    await ctx.repo.applyGranted(event);
    // At-least-once delivery means this happens routinely; a duplicate row
    // would survive one revocation and silently keep access alive.
    expect(ctx.prisma.rows).toHaveLength(1);
  });

  it('revokes only the named grant', async () => {
    await ctx.repo.applyGranted({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    await ctx.repo.applyGranted({ userId: USER, level: 'SITE', projectId: PROJECT_C, siteId: SITE_B });
    await ctx.repo.applyRevoked({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    expect(await ctx.provider.for(USER)).toEqual({ global: false, projectIds: [], siteIds: [SITE_B] });
  });

  it('tolerates revoking something that was never granted', async () => {
    // A revocation can outrun its grant, or arrive twice. Neither is an error.
    await expect(
      ctx.repo.applyRevoked({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null }),
    ).resolves.toBeUndefined();
  });

  it('clears every row for a deactivated user and no one else\'s', async () => {
    await ctx.repo.applyGranted({ userId: USER, level: 'GLOBAL', projectId: null, siteId: null });
    await ctx.repo.applyGranted({ userId: OTHER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    await ctx.repo.clearUser(USER);
    expect(await ctx.provider.for(USER)).toEqual({ global: false, projectIds: [], siteIds: [] });
    expect((await ctx.provider.for(OTHER)).projectIds).toEqual([PROJECT_A]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm nx run project:test -- scope.consumer
```

Expected: FAIL at import — `Cannot find module './user-scope.repository.js'`.

- [ ] **Step 3: Write the repository**

Create `apps/project/src/scope/user-scope.repository.ts`:

```ts
import { uuidv7 } from '@ipms/contracts';
import type { AuthzScope } from '@ipms/authz';
import type { IamScopeGranted, IamScopeRevoked } from '@ipms/events';
import type { PrismaClient } from '@prisma-clients/project';

/**
 * The local projection of iam's authoritative scope grants.
 *
 * This class is the ONLY writer of `user_scope`. A request handler that writes
 * here has invented authority iam did not grant, and the two will disagree
 * about the same user until someone notices — which, for an authorization
 * table, means until someone sees data they should not have.
 */
export class UserScopeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async applyGranted(event: IamScopeGranted): Promise<void> {
    try {
      await this.prisma.userScope.create({
        data: {
          id: uuidv7(),
          userId: event.userId,
          level: event.level,
          projectId: event.projectId,
          siteId: event.siteId,
        },
      });
    } catch (err) {
      // P2002 is a unique violation on one of the three partial indexes, which
      // means this exact grant is already projected. At-least-once delivery
      // makes that routine, not exceptional. Swallowing it here keeps the
      // handler idempotent without a read-then-write that would race two
      // redeliveries against each other.
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }

  async applyRevoked(event: IamScopeRevoked): Promise<void> {
    // deleteMany, not delete: a revocation can outrun its grant or arrive
    // twice, and neither is an error. `delete` would throw P2025 on a row that
    // is already gone, and the consumer would retry it five times and
    // dead-letter a message whose desired end state already holds.
    await this.prisma.userScope.deleteMany({
      where: {
        userId: event.userId,
        level: event.level,
        projectId: event.projectId,
        siteId: event.siteId,
      },
    });
  }

  /** Every grant for a user, dropped at once. Used on `iam.user.deactivated`. */
  async clearUser(userId: string): Promise<void> {
    await this.prisma.userScope.deleteMany({ where: { userId } });
  }

  /**
   * The user's replicated scope.
   *
   * A user with nothing projected gets `{ global: false, projectIds: [], siteIds: [] }`,
   * which `scopeWhere` turns into a query matching nothing. That is the same
   * answer an unreplicated projection produces, and it is deliberate: the two
   * cases are indistinguishable from here, and denying is the only safe
   * reading of both. Recovering from the second is `replay.ts`'s job.
   */
  async scopeFor(userId: string): Promise<AuthzScope> {
    const rows = await this.prisma.userScope.findMany({ where: { userId } });
    return {
      global: rows.some((row) => row.level === 'GLOBAL'),
      projectIds: rows.filter((row) => row.level === 'PROJECT' && row.projectId !== null).map((row) => row.projectId as string),
      siteIds: rows.filter((row) => row.level === 'SITE' && row.siteId !== null).map((row) => row.siteId as string),
    };
  }

  /** True when nothing has ever been replicated. See `replay.ts`. */
  async isEmpty(): Promise<boolean> {
    return (await this.prisma.userScope.count()) === 0;
  }
}
```

- [ ] **Step 4: Write the provider**

Create `apps/project/src/scope/scope.provider.ts`:

```ts
import type { AuthzScope, ScopeProvider } from '@ipms/authz';
import type { UserScopeRepository } from './user-scope.repository.js';

/**
 * Supplies `AuthzGuard` with the caller's replicated scope.
 *
 * Unlike iam's provider, this one does real work: `project` owns project- and
 * site-scoped resources, every list query constrains itself with
 * `scopeWhere(scope)`, and `/internal/authz/explain` passes a resource into
 * `check()`. Returning a stub here would disable the platform's actual
 * authorization boundary.
 */
export function projectScopeProvider(repo: UserScopeRepository): ScopeProvider {
  return {
    async for(userId: string): Promise<AuthzScope> {
      return repo.scopeFor(userId);
    },
  };
}
```

- [ ] **Step 5: Write the consumer**

Create `apps/project/src/scope/scope.consumer.ts`:

```ts
import {
  SUBJECTS, type DurableConsumer,
  type IamScopeGranted, type IamScopeRevoked, type IamUserDeactivated,
} from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { UserScopeRepository } from './user-scope.repository.js';

const log = createLogger('project');

export const SCOPE_DURABLE = 'project-scope-cache';

/**
 * Keeps `user_scope` in step with iam.
 *
 * Subscribes to the scope subjects and to deactivation, and to nothing else.
 * `iam.role.assigned` / `.removed` are deliberately not consumed: iam's own
 * `EffectiveService.toScope()` derives scope from the scope tables alone, so a
 * scoped role assignment contributes no reach there. Projecting it here would
 * grant access iam does not recognise and leave the two disagreeing about the
 * same user. A role change alters the *permission* set, which travels in the
 * JWT and is handled by token re-issue.
 */
export class ScopeConsumer {
  constructor(private readonly repo: UserScopeRepository) {}

  async register(consumer: DurableConsumer): Promise<void> {
    await consumer.subscribe<IamScopeGranted>(SUBJECTS.IAM_SCOPE_GRANTED, SCOPE_DURABLE, async (envelope) => {
      await this.repo.applyGranted(envelope.payload);
      log.debug({ eventId: envelope.eventId, userId: envelope.payload.userId }, 'scope granted');
    });

    await consumer.subscribe<IamScopeRevoked>(SUBJECTS.IAM_SCOPE_REVOKED, SCOPE_DURABLE, async (envelope) => {
      await this.repo.applyRevoked(envelope.payload);
      log.debug({ eventId: envelope.eventId, userId: envelope.payload.userId }, 'scope revoked');
    });

    await consumer.subscribe<IamUserDeactivated>(SUBJECTS.IAM_USER_DEACTIVATED, SCOPE_DURABLE, async (envelope) => {
      await this.repo.clearUser(envelope.payload.userId);
      log.info({ eventId: envelope.eventId, userId: envelope.payload.userId }, 'scope cleared for deactivated user');
    });
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm nx run project:test -- scope.consumer
pnpm nx run-many -t typecheck
```

Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/project/src/scope
git commit -m "$(cat <<'EOF'
feat(project): replicate iam's scope grants into a local projection

UserScopeRepository is the only writer of user_scope. A request handler that
writes here would invent authority iam did not grant, and the two would
disagree about the same user until someone sees data they should not have.

Idempotence is structural rather than checked: applyGranted swallows P2002 on
the partial unique indexes, and applyRevoked uses deleteMany. At-least-once
delivery makes both routine. A read-then-write would race two redeliveries
against each other, and `delete` would dead-letter a message whose desired end
state already holds.

Role events are deliberately not consumed, though STREAMS.IAM lists them.
iam's authoritative toScope() derives scope from the scope tables alone, so a
scoped UserRole contributes no reach there; projecting it would grant access
iam does not recognise.

A user with nothing projected gets an empty, non-global scope, which
scopeWhere turns into a query matching nothing -- the same answer an
unreplicated projection gives, and the safe reading of both.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `project` — cold-start replay, proven against real Postgres and NATS

**Files:**
- Create: `apps/project/src/scope/replay.ts`
- Test: `apps/project/src/scope/scope.integration.spec.ts`

**Interfaces:**
- Consumes: `UserScopeRepository`, `SCOPE_DURABLE` from Task 7; `EventBus`, `STREAMS` from `@ipms/events`.
- Produces: `ensureProjectionReplay(bus: EventBus, prisma: PrismaClient, repo: UserScopeRepository): Promise<boolean>` — resolves `true` when it recreated the durable. Task 16 calls it during bootstrap, before the consumer subscribes.

**The problem it solves.** `DurableConsumer` creates its durable with `DeliverPolicy.All`,
so a *new* durable replays the stream from the beginning. An *existing* durable resumes
from its stored position — which is exactly wrong when the projection database was
rebuilt underneath it, because every grant it already acknowledged is gone from the
table and will never be redelivered. An empty table and a live durable together mean
every non-global user is denied forever, silently.

- [ ] **Step 1: Write the failing test**

Create `apps/project/src/scope/scope.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/project';
import { EventBus, DurableConsumer, InMemoryDedupeStore, SUBJECTS } from '@ipms/events';
import { uuidv7 } from '@ipms/contracts';
import { UserScopeRepository } from './user-scope.repository.js';
import { projectScopeProvider } from './scope.provider.js';
import { ScopeConsumer, SCOPE_DURABLE } from './scope.consumer.js';
import { ensureProjectionReplay } from './replay.js';

let pg: StartedPostgreSqlContainer;
let nats: StartedTestContainer;
let prisma: PrismaClient;
let bus: EventBus;
let connectionString: string;

const USER = '01930000-0000-7000-8000-0000000000aa';
const PROJECT_A = '01930000-0000-7000-8000-00000000a001';
const SITE_B = '01930000-0000-7000-8000-00000000b002';

async function settle(ms = 600): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:17-alpine').start();
  connectionString = pg.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  nats = await new GenericContainer('nats:2.10-alpine')
    .withCommand(['-js', '-sd', '/data'])
    .withExposedPorts(4222)
    .start();

  bus = new EventBus();
  await bus.connect(`nats://${nats.getHost()}:${nats.getMappedPort(4222)}`);
  await bus.ensureStreams();
}, 240_000);

afterAll(async () => {
  await bus?.close();
  await prisma?.$disconnect();
  await nats?.stop();
  await pg?.stop();
});

beforeEach(async () => {
  await prisma.userScope.deleteMany({});
  await prisma.projectionWatermark.deleteMany({});
});

describe('scope projection over real NATS', () => {
  it('projects a grant published by iam', async () => {
    const repo = new UserScopeRepository(prisma);
    const consumer = new DurableConsumer(bus, new InMemoryDedupeStore());
    await new ScopeConsumer(repo).register(consumer);

    await bus.publish(SUBJECTS.IAM_SCOPE_GRANTED, {
      userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null,
    });
    await settle();

    expect(await projectScopeProvider(repo).for(USER)).toEqual({
      global: false, projectIds: [PROJECT_A], siteIds: [],
    });
  }, 60_000);

  it('enforces the partial unique indexes against a redelivered grant', async () => {
    const repo = new UserScopeRepository(prisma);
    const event = { userId: USER, level: 'PROJECT' as const, projectId: PROJECT_A, siteId: null };
    await repo.applyGranted(event);
    await repo.applyGranted(event);
    // The real index, not the fake from the unit test. A second row here would
    // survive one revocation and keep access alive after it was withdrawn.
    expect(await prisma.userScope.count({ where: { userId: USER } })).toBe(1);
  });

  it('lets all three grant levels coexist for one user', async () => {
    const repo = new UserScopeRepository(prisma);
    await repo.applyGranted({ userId: USER, level: 'GLOBAL', projectId: null, siteId: null });
    await repo.applyGranted({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    await repo.applyGranted({ userId: USER, level: 'SITE', projectId: PROJECT_A, siteId: SITE_B });
    expect(await projectScopeProvider(repo).for(USER)).toEqual({
      global: true, projectIds: [PROJECT_A], siteIds: [SITE_B],
    });
  });

  it('refuses a PROJECT grant carrying no project', async () => {
    // user_scope_shape_check. A malformed replication event must not sit in
    // the table quietly widening or narrowing someone's access.
    await expect(
      prisma.userScope.create({ data: { id: uuidv7(), userId: USER, level: 'PROJECT', projectId: null, siteId: null } }),
    ).rejects.toThrow();
  });
});

describe('cold start', () => {
  it('rebuilds a wiped projection by recreating the durable', async () => {
    const repo = new UserScopeRepository(prisma);

    // First boot: consume a grant, then mark the projection populated.
    const first = new DurableConsumer(bus, new InMemoryDedupeStore());
    await new ScopeConsumer(repo).register(first);
    await bus.publish(SUBJECTS.IAM_SCOPE_GRANTED, {
      userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null,
    });
    await settle();
    await prisma.projectionWatermark.upsert({
      where: { name: 'user_scope' }, update: {}, create: { name: 'user_scope' },
    });
    expect(await prisma.userScope.count()).toBe(1);

    // The database is rebuilt underneath a durable that has already acked
    // everything. Without the replay, this user is denied forever.
    await prisma.userScope.deleteMany({});
    await prisma.projectionWatermark.deleteMany({});

    const recreated = await ensureProjectionReplay(bus, prisma, repo);
    expect(recreated).toBe(true);

    const second = new DurableConsumer(bus, new InMemoryDedupeStore());
    await new ScopeConsumer(repo).register(second);
    await settle(1200);

    expect(await projectScopeProvider(repo).for(USER)).toEqual({
      global: false, projectIds: [PROJECT_A], siteIds: [],
    });
    expect(await prisma.projectionWatermark.findUnique({ where: { name: 'user_scope' } })).not.toBeNull();
  }, 90_000);

  it('does not replay when the projection is already populated', async () => {
    const repo = new UserScopeRepository(prisma);
    await repo.applyGranted({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    await prisma.projectionWatermark.upsert({
      where: { name: 'user_scope' }, update: {}, create: { name: 'user_scope' },
    });
    // Recreating a healthy durable would replay a week of events on every
    // ordinary restart, for no benefit.
    expect(await ensureProjectionReplay(bus, prisma, repo)).toBe(false);
  }, 60_000);

  it('does not replay when a user genuinely has no scope', async () => {
    const repo = new UserScopeRepository(prisma);
    // The projection is empty but the watermark says it has been populated —
    // i.e. every grant really was revoked. Replaying would be harmless but
    // wrong-headed; the distinction is exactly what the watermark buys.
    await prisma.projectionWatermark.upsert({
      where: { name: 'user_scope' }, update: {}, create: { name: 'user_scope' },
    });
    expect(await ensureProjectionReplay(bus, prisma, repo)).toBe(false);
  }, 60_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm nx run project:test -- scope.integration
```

Expected: FAIL at import — `Cannot find module './replay.js'`. Docker must be running.

- [ ] **Step 3: Write the replay**

Create `apps/project/src/scope/replay.ts`:

```ts
import { STREAMS, type EventBus } from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { PrismaClient } from '@prisma-clients/project';
import type { UserScopeRepository } from './user-scope.repository.js';
import { SCOPE_DURABLE } from './scope.consumer.js';

const log = createLogger('project');

export const WATERMARK = 'user_scope';

/**
 * Rebuilds the scope projection when it has been lost.
 *
 * `DurableConsumer` creates its durable with `DeliverPolicy.All`, so a *new*
 * durable replays the stream from the beginning. An *existing* durable resumes
 * from its stored position — which is exactly wrong when the projection
 * database has been rebuilt underneath it: every grant it already acked is
 * gone from the table and will never be redelivered. An empty table plus a
 * live durable means every non-global user is denied forever, silently, and
 * the denial looks like correct fail-closed behaviour.
 *
 * The watermark is what makes the two cases distinguishable. An empty table
 * with a watermark means every grant was genuinely revoked — leave it alone.
 * An empty table with no watermark means nothing has ever been replicated, or
 * the database was rebuilt — delete the durable so the next subscribe recreates
 * it and replays.
 *
 * Bounded by the IAM stream's 7-day retention. Beyond that a replay recovers
 * only what the stream still holds, and the documented recovery is an
 * iam-side re-emit. Denying in the meantime is the safe direction.
 *
 * Returns true when it recreated the durable.
 */
export async function ensureProjectionReplay(
  bus: EventBus,
  prisma: PrismaClient,
  repo: UserScopeRepository,
): Promise<boolean> {
  const watermark = await prisma.projectionWatermark.findUnique({ where: { name: WATERMARK } });
  if (watermark !== null) return false;

  if (!await repo.isEmpty()) {
    // Rows but no watermark: a previous boot replicated successfully and was
    // killed before stamping. Stamp it and carry on rather than replaying.
    await prisma.projectionWatermark.upsert({ where: { name: WATERMARK }, update: {}, create: { name: WATERMARK } });
    return false;
  }

  log.warn({ durable: SCOPE_DURABLE }, 'scope projection is empty and unstamped; recreating the durable to replay');
  try {
    await bus.manager().consumers.delete(STREAMS.IAM.name, SCOPE_DURABLE);
  } catch (err) {
    // Not found is the ordinary first-boot case: there is no durable to
    // delete, and the subscribe that follows creates one that replays anyway.
    if (!String(err).includes('consumer not found')) throw err;
  }

  await prisma.projectionWatermark.upsert({ where: { name: WATERMARK }, update: {}, create: { name: WATERMARK } });
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm nx run project:test -- scope.integration
```

Expected: PASS, 7 tests. If the replay test is flaky, raise the `settle(1200)` value — JetStream redelivery after a durable is recreated is not instant.

- [ ] **Step 5: Commit**

```bash
git add apps/project/src/scope
git commit -m "$(cat <<'EOF'
feat(project): rebuild the scope projection after it is lost

DurableConsumer creates its durable with DeliverPolicy.All, so a new durable
replays from the start -- but an existing one resumes from its stored
position. That is exactly wrong when the projection database has been rebuilt
underneath it: every grant the durable already acked is gone from the table
and will never be redelivered, so every non-global user is denied forever and
the denial looks like correct fail-closed behaviour.

The watermark makes the two indistinguishable cases distinguishable. Empty
table with a watermark means every grant was genuinely revoked; leave it.
Empty table without one means nothing has been replicated or the database was
rebuilt; delete the durable so the next subscribe replays.

Rows without a watermark are stamped rather than replayed -- that is a boot
killed between replicating and stamping, not a lost projection.

Integration-tested against real Postgres and NATS, including the partial
unique indexes under redelivery and the shape check refusing a PROJECT grant
that carries no project.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: query-level scope enforcement

The defect the spike embodies. `check()` returns `allowed: true` as soon as the
permission is held when no `resource` is passed, and `AuthzGuard` never passes one —
deliberately, because §6 puts the real boundary at query level. The spike then never
built that boundary, so any holder of `project.view` lists every project in the system.

**Files:**
- Modify: `libs/authz/src/nest/authz.guard.ts` — stash the resolved scope on the request
- Modify: `libs/authz/src/nest/authz.guard.spec.ts`
- Create: `apps/project/src/scope/project-scope.ts`
- Create: `apps/project/src/http/scope.decorator.ts`
- Rewrite: `apps/project/src/project/project.service.ts`
- Rewrite: `apps/project/src/project/project.controller.ts`
- Test: `apps/project/src/project/project.service.integration.spec.ts`

**Interfaces:**
- Consumes: `scopeWhere`, `DEFAULT_SCOPE_FIELDS` (Task 2); `AuthzScope`.
- Produces:
  - `AuthzGuard` sets `request.authzScope: AuthzScope`
  - `@ScopeOf()` param decorator returning `AuthzScope`
  - `ProjectService` methods, each taking `scope` as its first argument: `listProjects(scope)`, `getProject(scope, id)`, `createProject(dto, actorId)`, `updateProject(scope, id, dto, actorId)`, `listSites(scope, projectId)`, `createSite(scope, projectId, dto, actorId)`, `dashboard(scope)`

- [ ] **Step 1: Write the failing guard test**

Append to `libs/authz/src/nest/authz.guard.spec.ts`:

```ts
  it('stashes the resolved scope on the request for query-level enforcement', async () => {
    const request: Record<string, unknown> = { user: activeUser(['project.view']) };
    const scope = { global: false, projectIds: ['p-1'], siteIds: [] };
    const guard = new AuthzGuard(
      reflectorFor('project.view'),
      { async for() { return scope; } },
      emptyOverrideProvider,
    );

    await guard.canActivate(contextFor(request));

    // The guard already paid for this read. Without stashing it, every handler
    // that needs to constrain a query has to resolve the same scope a second
    // time, and the two reads can disagree across a concurrent revocation.
    expect(request['authzScope']).toEqual(scope);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm nx run @ipms/authz:test -- authz.guard
```

Expected: FAIL — `expected undefined to equal { global: false, … }`.

- [ ] **Step 3: Stash the scope**

In `libs/authz/src/nest/authz.guard.ts`, widen the request type and assign, immediately after the `check()` call:

```ts
    const request = context.switchToHttp().getRequest<{
      user?: AuthzUser; authzDecision?: unknown; authzScope?: AuthzScope;
    }>();
```

```ts
    request.authzDecision = decision;

    /**
     * The guard has already resolved this user's replicated scope to answer
     * the permission question. Handlers need the same value to constrain their
     * queries — `scopeWhere(scope)` is the platform's actual authorization
     * boundary, since `check()` returns allowed as soon as the permission is
     * held when no resource is passed.
     *
     * Stashed rather than re-read, so a handler cannot see a different scope
     * from the one the guard just decided on. Two independent reads either
     * side of a concurrent revocation would disagree, and the handler's read
     * is the one that governs what data leaves the process.
     */
    request.authzScope = scope;
```

- [ ] **Step 4: Run the guard tests**

```bash
pnpm nx run @ipms/authz:test
```

Expected: PASS.

- [ ] **Step 5: Write the failing enforcement test**

Create `apps/project/src/project/project.service.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/project';
import { NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@ipms/contracts';
import type { AuthzScope } from '@ipms/authz';
import { ProjectService } from './project.service.js';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: ProjectService;

const ACTOR = '01930000-0000-7000-8000-0000000000aa';
let projectA: string;
let projectB: string;
let siteInA: string;
let siteInB: string;

const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const NOTHING: AuthzScope = { global: false, projectIds: [], siteIds: [] };
const onlyA = (): AuthzScope => ({ global: false, projectIds: [projectA], siteIds: [] });
const onlySiteInB = (): AuthzScope => ({ global: false, projectIds: [], siteIds: [siteInB] });

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  service = new ProjectService(prisma);
}, 240_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.site.deleteMany({});
  await prisma.project.deleteMany({});
  projectA = uuidv7();
  projectB = uuidv7();
  siteInA = uuidv7();
  siteInB = uuidv7();
  await prisma.project.create({ data: { id: projectA, code: 'NCELL14', name: 'Ncell Phase 14' } });
  await prisma.project.create({ data: { id: projectB, code: 'OTHER9', name: 'Other Client 9' } });
  await prisma.site.create({ data: { id: siteInA, projectId: projectA, siteCode: 'KOS121', name: 'Koshi 121' } });
  await prisma.site.create({ data: { id: siteInB, projectId: projectB, siteCode: 'BKT900', name: 'Bhaktapur 900' } });
});

describe('list scoping', () => {
  it('shows a global user every project', async () => {
    expect((await service.listProjects(GLOBAL)).map((p) => p.id).sort()).toEqual([projectA, projectB].sort());
  });

  it('shows a project-scoped user only their project', async () => {
    // The defect the spike has: it returns both.
    expect((await service.listProjects(onlyA())).map((p) => p.id)).toEqual([projectA]);
  });

  it('shows a user with no scope nothing at all', async () => {
    expect(await service.listProjects(NOTHING)).toEqual([]);
  });

  it('shows a site-scoped user the project containing their site', async () => {
    // Project and site grants are alternatives. A user scoped only to a site
    // in project B must still be able to see project B, or the site is
    // unreachable through every list that starts from a project.
    expect((await service.listProjects(onlySiteInB())).map((p) => p.id)).toEqual([projectB]);
  });
});

describe('read-by-id scoping', () => {
  it('returns 404, not 403, for a project outside scope', async () => {
    // §6 response discipline: the existence of a project the caller cannot see
    // is not disclosed. A 403 would confirm the id is real.
    await expect(service.getProject(onlyA(), projectB)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 for an id that does not exist, indistinguishably', async () => {
    await expect(service.getProject(GLOBAL, uuidv7())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the project when it is in scope', async () => {
    expect((await service.getProject(onlyA(), projectA)).id).toBe(projectA);
  });
});

describe('nested list scoping', () => {
  it('refuses to list sites of a project outside scope', async () => {
    await expect(service.listSites(onlyA(), projectB)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only the sites of a project in scope', async () => {
    expect((await service.listSites(onlyA(), projectA)).map((s) => s.id)).toEqual([siteInA]);
  });
});

describe('write scoping', () => {
  it('refuses to create a site in a project outside scope', async () => {
    // Without this, a caller holding site.create writes into any project whose
    // id they can guess -- an IDOR that list scoping alone does not close.
    await expect(
      service.createSite(onlyA(), projectB, { siteCode: 'NEW1', name: 'New' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a site in a project in scope', async () => {
    const site = await service.createSite(onlyA(), projectA, { siteCode: 'NEW1', name: 'New' }, ACTOR);
    expect(site.projectId).toBe(projectA);
  });

  it('refuses to update a project outside scope', async () => {
    await expect(
      service.updateProject(onlyA(), projectB, { name: 'Renamed' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to update a site outside scope', async () => {
    await expect(
      service.updateSite(onlyA(), siteInB, { name: 'Renamed' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to delete a site outside scope', async () => {
    await expect(service.deleteSite(onlyA(), siteInB, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to delete a site that still carries tasks', async () => {
    // The FK cascades. Without this the database would take the site and
    // every task hanging off it -- a deletion nobody intends and the ledger
    // cannot reconstruct.
    await prisma.taskType.create({
      data: { id: taskTypeId, projectId: projectA, code: 'T1', name: 'T', category: 'QUALITY' },
    });
    await prisma.task.create({
      data: {
        id: uuidv7(), projectId: projectA, siteId: siteInA, taskTypeId,
        title: 'Work', origin: 'PLANNED', createdBy: ACTOR,
      },
    });
    await expect(service.deleteSite(GLOBAL, siteInA, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes an empty site in scope', async () => {
    await expect(service.deleteSite(onlyA(), siteInA, ACTOR)).resolves.toBeUndefined();
  });
});

describe('dashboard scoping', () => {
  it('counts only what the caller may see', async () => {
    await prisma.project.updateMany({ data: { status: 'ACTIVE' } });
    const scoped = await service.dashboard(onlyA());
    expect(scoped.activeProjectCount).toBe(1);
    const all = await service.dashboard(GLOBAL);
    expect(all.activeProjectCount).toBe(2);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm nx run project:test -- project.service.integration
```

Expected: FAIL — `service.listProjects` takes a scope argument the current implementation ignores, so the scoped assertions return both projects.

- [ ] **Step 7: Write the implementation**

First create `apps/project/src/scope/project-scope.ts`. Three services need this
predicate; it gets one definition. Copies of an authorization rule drift, and the
failure mode of a drifted copy is that one of them silently stops enforcing:

```ts
import type { AuthzScope } from '@ipms/authz';

/**
 * The `where` fragment matching projects this caller may see.
 *
 * `scopeWhere` does not fit the Project model: Project scopes on its own `id`
 * and has no `siteId` column. A site grant reaches its project through the
 * `sites` relation instead, because project and site grants are alternatives
 * — a user scoped only to a site in project B must still see project B, or
 * that site is unreachable from every list that starts at a project.
 *
 * Used by ProjectService, TaskTypeService and MilestoneService. Do not inline
 * a copy: this is the definition of "visible project" for the whole service.
 */
export function projectScope(scope: AuthzScope): Record<string, unknown> {
  if (scope.global) return {};
  return {
    OR: [
      { id: { in: scope.projectIds } },
      { sites: { some: { id: { in: scope.siteIds } } } },
    ],
  };
}

/** Projects visible to this caller, further narrowed to one id. */
export function visibleProject(scope: AuthzScope, id: string): Record<string, unknown> {
  return { AND: [{ id }, projectScope(scope)] };
}
```

Then replace `apps/project/src/project/project.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import {
  uuidv7,
  type CreateProjectDto, type CreateSiteDto, type UpdateProjectDto, type UpdateSiteDto,
} from '@ipms/contracts';
import { projectScope, visibleProject } from '../scope/project-scope.js';

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaClient) {}

  async listProjects(scope: AuthzScope) {
    return this.prisma.project.findMany({
      where: projectScope(scope),
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { sites: true, tasks: true } } },
    });
  }

  /**
   * NotFound, never Forbidden, for a project outside scope. A 403 confirms the
   * id names something real, which is exactly what an enumeration attack is
   * looking for. §6 response discipline.
   */
  async getProject(scope: AuthzScope, id: string) {
    const project = await this.prisma.project.findFirst({
      where: visibleProject(scope, id),
      include: {
        sites: { include: { region: true }, orderBy: { siteCode: 'asc' } },
        milestones: { include: { requirements: true }, orderBy: { sequence: 'asc' } },
        _count: { select: { tasks: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async createProject(dto: CreateProjectDto, actorId: string) {
    try {
      return await this.prisma.project.create({
        data: {
          id: uuidv7(), code: dto.code, name: dto.name,
          clientName: dto.clientName ?? null, phase: dto.phase ?? null,
          startDate: dto.startDate ?? null, targetDate: dto.targetDate ?? null,
          status: 'DRAFT',
        },
      });
    } catch (err) {
      // Narrow: only a unique violation on `code` means "already in use". A
      // bare catch here would report a connection failure as a duplicate code.
      if ((err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Project code is already in use');
      }
      throw err;
    }
  }

  async updateProject(scope: AuthzScope, id: string, dto: UpdateProjectDto, _actorId: string) {
    await this.requireProject(scope, id);
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.clientName === undefined ? {} : { clientName: dto.clientName }),
        ...(dto.phase === undefined ? {} : { phase: dto.phase }),
        ...(dto.startDate === undefined ? {} : { startDate: dto.startDate }),
        ...(dto.targetDate === undefined ? {} : { targetDate: dto.targetDate }),
        ...(dto.status === undefined ? {} : { status: dto.status }),
      },
    });
  }

  async listSites(scope: AuthzScope, projectId: string) {
    await this.requireProject(scope, projectId);
    return this.prisma.site.findMany({
      where: { AND: [{ projectId }, scopeWhere(scope)] },
      include: { region: true },
      orderBy: { siteCode: 'asc' },
    });
  }

  async createSite(scope: AuthzScope, projectId: string, dto: CreateSiteDto, _actorId: string) {
    // Scope-check the parent before writing. Without it, a caller holding
    // site.create writes into any project whose id they can guess — an IDOR
    // that list scoping alone does not close.
    await this.requireProject(scope, projectId);

    let regionId: string | null = null;
    if (dto.regionName) {
      const region = await this.prisma.region.upsert({
        where: { projectId_name: { projectId, name: dto.regionName } },
        update: {},
        create: { id: uuidv7(), projectId, name: dto.regionName },
      });
      regionId = region.id;
    }

    try {
      return await this.prisma.site.create({
        data: {
          id: uuidv7(), projectId, regionId,
          siteCode: dto.siteCode, name: dto.name,
          latitude: dto.latitude ?? null, longitude: dto.longitude ?? null,
          geofenceRadiusM: dto.geofenceRadiusM ?? 100,
          address: dto.address ?? null, city: dto.city ?? null,
          area: dto.area ?? null, scopeVariant: dto.scopeVariant ?? null,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Site code is already in use in this project');
      }
      throw err;
    }
  }

  async dashboard(scope: AuthzScope) {
    const visible = projectScope(scope);
    const taskScope = scopeWhere(scope);
    const [projects, reviewCount, rectifying] = await Promise.all([
      this.prisma.project.findMany({
        where: { AND: [{ status: 'ACTIVE' }, visible] },
        include: { _count: { select: { sites: true } } },
        take: 12, orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.task.count({ where: { AND: [{ status: 'REVIEWING' }, taskScope] } }),
      this.prisma.task.count({ where: { AND: [{ status: 'RECTIFYING' }, taskScope] } }),
    ]);
    return {
      activeProjectCount: projects.length,
      sitesInDelivery: projects.reduce((total, p) => total + p._count.sites, 0),
      pendingReviews: reviewCount,
      rectifyingTasks: rectifying,
      projects,
    };
  }

  /** Throws NotFound when the project does not exist OR is outside scope — indistinguishably. */
  private async requireProject(scope: AuthzScope, id: string): Promise<void> {
    const found = await this.prisma.project.findFirst({
      where: visibleProject(scope, id), select: { id: true },
    });
    if (!found) throw new NotFoundException('Project not found');
  }
}
```

`createProject` takes `actorId` but does not store it. `Project` has no `createdBy`
column and does not gain one: the creator is already recorded in the audit ledger by
Task 15, which is where "who did this" belongs. The parameter stays in the signature
because Task 15 passes it to the outbox row.

- [ ] **Step 8: Write the scope decorator and controller**

Create `apps/project/src/http/scope.decorator.ts`:

```ts
import { createParamDecorator, InternalServerErrorException, type ExecutionContext } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';

/**
 * The caller's replicated scope, as resolved by `AuthzGuard`.
 *
 * Throws rather than defaulting when it is absent. An absent scope means the
 * route has no `@RequirePermission`, so the guard short-circuited and never
 * resolved one — and the only safe default would be "see nothing", which would
 * present as a mysterious empty list rather than the wiring bug it is.
 */
export const ScopeOf = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthzScope => {
  const request = ctx.switchToHttp().getRequest<{ authzScope?: AuthzScope }>();
  if (!request.authzScope) {
    throw new InternalServerErrorException('Route is missing @RequirePermission; no scope was resolved');
  }
  return request.authzScope;
});
```

Replace `apps/project/src/project/project.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzScope, type AuthzUser } from '@ipms/authz';
import {
  CreateProjectSchema, CreateSiteSchema, UpdateProjectSchema, UuidSchema,
} from '@ipms/contracts';
import { ScopeOf } from '../http/scope.decorator.js';
import { ProjectService } from './project.service.js';

@Controller()
export class ProjectController {
  constructor(private readonly service: ProjectService) {}

  @Get('dashboard')
  @RequirePermission('project.view')
  dashboard(@ScopeOf() scope: AuthzScope) {
    return this.service.dashboard(scope);
  }

  @Get('projects')
  @RequirePermission('project.view')
  list(@ScopeOf() scope: AuthzScope) {
    return this.service.listProjects(scope);
  }

  @Get('projects/:id')
  @RequirePermission('project.view')
  get(@ScopeOf() scope: AuthzScope, @Param('id') id: string) {
    return this.service.getProject(scope, UuidSchema.parse(id));
  }

  @Post('projects')
  @RequirePermission('project.create')
  create(@Body() body: unknown, @Req() req: { user: AuthzUser }) {
    // No scope argument: creating a project cannot be constrained by scope the
    // project does not yet have. The permission is the whole gate here.
    return this.service.createProject(CreateProjectSchema.parse(body), req.user.id);
  }

  @Patch('projects/:id')
  @RequirePermission('project.update')
  update(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.service.updateProject(scope, UuidSchema.parse(id), UpdateProjectSchema.parse(body), req.user.id);
  }

  @Get('projects/:id/sites')
  @RequirePermission('site.view')
  listSites(@ScopeOf() scope: AuthzScope, @Param('id') id: string) {
    return this.service.listSites(scope, UuidSchema.parse(id));
  }

  @Post('projects/:id/sites')
  @RequirePermission('site.create')
  createSite(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.service.createSite(scope, UuidSchema.parse(id), CreateSiteSchema.parse(body), req.user.id);
  }

  @Patch('sites/:id')
  @RequirePermission('site.update')
  updateSite(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.service.updateSite(scope, UuidSchema.parse(id), UpdateSiteSchema.parse(body), req.user.id);
  }

  @Delete('sites/:id')
  @RequirePermission('site.delete')
  deleteSite(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Req() req: { user: AuthzUser }) {
    return this.service.deleteSite(scope, UuidSchema.parse(id), req.user.id);
  }
}
```

Add `Delete` to the `@nestjs/common` import and `UpdateSiteSchema` to the contracts
import. `UpdateSiteSchema` goes in `libs/contracts/src/project/project.ts` alongside the
others:

```ts
export const UpdateSiteSchema = CreateSiteSchema.omit({ siteCode: true }).partial()
  .extend({ status: SiteStatusSchema.optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided' });
export type UpdateSiteDto = z.infer<typeof UpdateSiteSchema>;
```

And the two service methods, on `ProjectService`:

```ts
  async updateSite(scope: AuthzScope, id: string, dto: UpdateSiteDto, _actorId: string) {
    await this.requireSite(scope, id);
    return this.prisma.site.update({
      where: { id },
      data: Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)),
    });
  }

  /**
   * Refused while the site still carries tasks. The FK is ON DELETE CASCADE,
   * so the database would happily take the site and every task and submission
   * trail hanging off it -- which is exactly the deletion nobody intends and
   * the audit ledger cannot reconstruct.
   */
  async deleteSite(scope: AuthzScope, id: string, _actorId: string) {
    await this.requireSite(scope, id);
    const tasks = await this.prisma.task.count({ where: { siteId: id } });
    if (tasks > 0) {
      throw new ConflictException('Cancel or remove this site\'s tasks before deleting it');
    }
    await this.prisma.site.delete({ where: { id } });
  }

  private async requireSite(scope: AuthzScope, id: string): Promise<void> {
    const site = await this.prisma.site.findFirst({
      where: { AND: [{ id }, scopeWhere(scope)] }, select: { id: true },
    });
    if (!site) throw new NotFoundException('Site not found');
  }
```

`ConflictException` joins the `@nestjs/common` import.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
pnpm nx run project:test
pnpm nx run-many -t typecheck
```

Expected: PASS, including all 12 enforcement assertions.

- [ ] **Step 10: Commit**

```bash
git add libs/authz apps/project
git commit -m "$(cat <<'EOF'
feat(project): enforce scope at query level

The boundary the architecture actually relies on, and the one the spike never
built. check() returns allowed as soon as the permission is held when no
resource is passed, and AuthzGuard never passes one -- deliberately, because
§6 puts enforcement at query level. Without it, any holder of project.view
listed every project in the system.

Every list constrains itself with scopeWhere, every read-by-id and every write
scope-checks its parent first, and every miss is a 404 rather than a 403: a
403 confirms the id names something real, which is what enumeration is
looking for.

The Project model scopes on its own id and reaches site grants through its
sites relation, because project and site grants are alternatives -- a user
scoped only to a site in project B must still see project B, or that site is
unreachable from every list that starts at a project.

AuthzGuard now stashes the scope it already resolved on the request, so a
handler cannot see a different scope from the one the guard just decided on.
Two independent reads either side of a concurrent revocation would disagree,
and the handler's read governs what data leaves the process.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: task-type dependencies, variant templates, and blocking

**Files:**
- Create: `apps/project/src/task-types/graph.ts` — pure cycle and blocking logic
- Create: `apps/project/src/task-types/graph.spec.ts`
- Create: `apps/project/src/task-types/task-type.service.ts`
- Create: `apps/project/src/task-types/task-type.controller.ts`
- Test: `apps/project/src/task-types/task-type.service.integration.spec.ts`

**Interfaces:**
- Consumes: `AuthzScope`; `AddDependencyDto`, `MapTemplateDto`, `CreateTaskTypeDto` from `@ipms/contracts`.
- Produces:
  - `wouldCreateCycle(edges: ReadonlyArray<readonly [string, string]>, taskTypeId: string, prerequisiteId: string): boolean` — `edges` are `[dependent, prerequisite]` pairs
  - `TaskTypeService.addDependency(scope, taskTypeId, dto)`, `.mapTemplate(scope, taskTypeId, dto)`, `.resolveTemplate(taskTypeId, scopeVariant): Promise<string | null>`, `.outstandingPrerequisites(siteId, taskTypeId): Promise<string[]>`
  - Task 11 calls `outstandingPrerequisites`; Task 12 calls `resolveTemplate`.

- [ ] **Step 1: Write the failing test for the pure logic**

Create `apps/project/src/task-types/graph.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { wouldCreateCycle } from './graph.js';

// Edges are [dependent, prerequisite]: ['ERECT', 'FOUNDATION'] reads
// "ERECT depends on FOUNDATION".
describe('wouldCreateCycle', () => {
  it('allows a first dependency', () => {
    expect(wouldCreateCycle([], 'ERECT', 'FOUNDATION')).toBe(false);
  });

  it('allows a diamond', () => {
    // RFI depends on both ERECT and CABLE; both depend on FOUNDATION.
    // Converging paths are not a cycle.
    const edges: Array<[string, string]> = [['ERECT', 'FOUNDATION'], ['CABLE', 'FOUNDATION'], ['RFI', 'ERECT']];
    expect(wouldCreateCycle(edges, 'RFI', 'CABLE')).toBe(false);
  });

  it('refuses a direct two-cycle', () => {
    expect(wouldCreateCycle([['ERECT', 'FOUNDATION']], 'FOUNDATION', 'ERECT')).toBe(true);
  });

  it('refuses a cycle several hops away', () => {
    // A task type that transitively requires itself can never be started, and
    // the blocking query would otherwise recurse forever looking for it.
    const edges: Array<[string, string]> = [['B', 'A'], ['C', 'B'], ['D', 'C']];
    expect(wouldCreateCycle(edges, 'A', 'D')).toBe(true);
  });

  it('refuses a self-dependency', () => {
    expect(wouldCreateCycle([], 'A', 'A')).toBe(true);
  });

  it('ignores unrelated branches', () => {
    const edges: Array<[string, string]> = [['B', 'A'], ['Y', 'X']];
    expect(wouldCreateCycle(edges, 'X', 'B')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm nx run project:test -- graph
```

Expected: FAIL — `Cannot find module './graph.js'`.

- [ ] **Step 3: Write the pure logic**

Create `apps/project/src/task-types/graph.ts`:

```ts
/**
 * Whether adding "taskTypeId depends on prerequisiteId" would close a cycle.
 *
 * Edges are `[dependent, prerequisite]`. A cycle means a task type
 * transitively requires itself, which makes it permanently unstartable — and
 * because blocking is computed by walking prerequisites on every read, a cycle
 * in the table is a hang, not merely bad data. Refusing the edge that would
 * close it is cheaper than defending every traversal.
 *
 * Walks up from the proposed prerequisite looking for the dependent: if
 * `prerequisiteId` already depends on `taskTypeId`, however indirectly, then
 * adding this edge closes the loop.
 */
export function wouldCreateCycle(
  edges: ReadonlyArray<readonly [string, string]>,
  taskTypeId: string,
  prerequisiteId: string,
): boolean {
  if (taskTypeId === prerequisiteId) return true;

  const prerequisitesOf = new Map<string, string[]>();
  for (const [dependent, prerequisite] of edges) {
    const list = prerequisitesOf.get(dependent) ?? [];
    list.push(prerequisite);
    prerequisitesOf.set(dependent, list);
  }

  const seen = new Set<string>();
  const stack = [prerequisiteId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === taskTypeId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(prerequisitesOf.get(current) ?? []));
  }
  return false;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm nx run project:test -- graph
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing service test**

Create `apps/project/src/task-types/task-type.service.integration.spec.ts`, opening with
the six-line harness preamble from Task 5 Step 6 and
`const service = new TaskTypeService(h.prisma)`. Task 15 adds the outbox
parameter and updates this line with it:

```ts
describe('dependencies', () => {
  it('refuses a dependency that would close a cycle', async () => {
    await service.addDependency(GLOBAL, erectId, { prerequisiteTaskTypeId: foundationId });
    await expect(
      service.addDependency(GLOBAL, foundationId, { prerequisiteTaskTypeId: erectId }),
    ).rejects.toThrow(/cycle|circular/i);
  });

  it('refuses a prerequisite from another project', async () => {
    // A cross-project dependency would make a task in project A unstartable
    // until work completes in a project its PM cannot even see.
    await expect(
      service.addDependency(GLOBAL, erectId, { prerequisiteTaskTypeId: foreignTaskTypeId }),
    ).rejects.toThrow(/same project/i);
  });

  it('refuses to touch a task type outside scope', async () => {
    await expect(
      service.addDependency(NOTHING, erectId, { prerequisiteTaskTypeId: foundationId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('outstandingPrerequisites', () => {
  it('reports nothing for a task type with no prerequisites', async () => {
    expect(await service.outstandingPrerequisites(siteInA, foundationId)).toEqual([]);
  });

  it('reports a prerequisite with no task at that site', async () => {
    await service.addDependency(GLOBAL, erectId, { prerequisiteTaskTypeId: foundationId });
    expect(await service.outstandingPrerequisites(siteInA, erectId)).toEqual([foundationId]);
  });

  it('reports a prerequisite whose task is not yet COMPLETED', async () => {
    await service.addDependency(GLOBAL, erectId, { prerequisiteTaskTypeId: foundationId });
    await prisma.task.create({
      data: {
        id: uuidv7(), projectId: projectA, siteId: siteInA, taskTypeId: foundationId,
        title: 'Foundation', origin: 'PLANNED', status: 'ONGOING', createdBy: ACTOR,
      },
    });
    expect(await service.outstandingPrerequisites(siteInA, erectId)).toEqual([foundationId]);
  });

  it('reports nothing once the prerequisite is COMPLETED at that site', async () => {
    await service.addDependency(GLOBAL, erectId, { prerequisiteTaskTypeId: foundationId });
    await prisma.task.create({
      data: {
        id: uuidv7(), projectId: projectA, siteId: siteInA, taskTypeId: foundationId,
        title: 'Foundation', origin: 'PLANNED', status: 'COMPLETED', createdBy: ACTOR,
      },
    });
    expect(await service.outstandingPrerequisites(siteInA, erectId)).toEqual([]);
  });

  it('is per site — completing at one site does not unblock another', async () => {
    // D11: the dependency is a rule about work, not about KOS121. It is
    // evaluated per site, or finishing one site's foundation would release
    // erection everywhere.
    await service.addDependency(GLOBAL, erectId, { prerequisiteTaskTypeId: foundationId });
    await prisma.task.create({
      data: {
        id: uuidv7(), projectId: projectA, siteId: siteInA, taskTypeId: foundationId,
        title: 'Foundation', origin: 'PLANNED', status: 'COMPLETED', createdBy: ACTOR,
      },
    });
    expect(await service.outstandingPrerequisites(siteInA, erectId)).toEqual([]);
    expect(await service.outstandingPrerequisites(otherSiteInA, erectId)).toEqual([foundationId]);
  });
});

describe('resolveTemplate', () => {
  it('prefers the variant mapping', async () => {
    await service.mapTemplate(GLOBAL, erectId, { scopeVariant: 'RRU Only', templateId: rruTemplate });
    expect(await service.resolveTemplate(erectId, 'RRU Only')).toBe(rruTemplate);
  });

  it('falls back to the task type default for an unmapped variant', async () => {
    await service.mapTemplate(GLOBAL, erectId, { scopeVariant: 'RRU Only', templateId: rruTemplate });
    expect(await service.resolveTemplate(erectId, 'Board + Jumper')).toBe(defaultTemplate);
  });

  it('falls back to the default when the site has no variant at all', async () => {
    expect(await service.resolveTemplate(erectId, null)).toBe(defaultTemplate);
  });

  it('returns null when nothing resolves, rather than guessing', async () => {
    expect(await service.resolveTemplate(untemplatedTaskType, 'RRU Only')).toBeNull();
  });

  it('replaces an existing mapping rather than failing on the primary key', async () => {
    await service.mapTemplate(GLOBAL, erectId, { scopeVariant: 'RRU Only', templateId: rruTemplate });
    await service.mapTemplate(GLOBAL, erectId, { scopeVariant: 'RRU Only', templateId: replacementTemplate });
    expect(await service.resolveTemplate(erectId, 'RRU Only')).toBe(replacementTemplate);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm nx run project:test -- task-type.service.integration
```

Expected: FAIL — `Cannot find module './task-type.service.js'`.

- [ ] **Step 7: Write the service**

Create `apps/project/src/task-types/task-type.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7, type AddDependencyDto, type CreateTaskTypeDto, type MapTemplateDto } from '@ipms/contracts';
import { visibleProject } from '../scope/project-scope.js';
import { wouldCreateCycle } from './graph.js';

@Injectable()
export class TaskTypeService {
  constructor(private readonly prisma: PrismaClient) {}

  async createTaskType(scope: AuthzScope, projectId: string, dto: CreateTaskTypeDto) {
    await this.requireProject(scope, projectId);
    try {
      return await this.prisma.taskType.create({
        data: {
          id: uuidv7(), projectId, code: dto.code, name: dto.name,
          category: dto.category, templateId: dto.templateId ?? null, order: dto.order ?? 0,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Task type code is already in use in this project');
      }
      throw err;
    }
  }

  /**
   * "Foundation before erection" (D11).
   *
   * Two rules beyond the database's self-dependency CHECK. Both sides must
   * belong to the same project — a cross-project prerequisite would leave a
   * task unstartable until work completes in a project its PM cannot see. And
   * the edge must not close a cycle: a task type that transitively requires
   * itself is permanently unstartable, and since blocking is computed by
   * walking prerequisites on every read, a cycle in the table is a hang.
   */
  async addDependency(scope: AuthzScope, taskTypeId: string, dto: AddDependencyDto) {
    const taskType = await this.requireTaskType(scope, taskTypeId);

    const prerequisite = await this.prisma.taskType.findFirst({
      where: { id: dto.prerequisiteTaskTypeId, projectId: taskType.projectId },
      select: { id: true },
    });
    if (!prerequisite) {
      throw new BadRequestException('A prerequisite must belong to the same project');
    }

    const existing = await this.prisma.taskTypeDependency.findMany({
      where: { taskType: { projectId: taskType.projectId } },
      select: { taskTypeId: true, prerequisiteTaskTypeId: true },
    });
    const edges = existing.map((e) => [e.taskTypeId, e.prerequisiteTaskTypeId] as const);
    if (wouldCreateCycle(edges, taskTypeId, dto.prerequisiteTaskTypeId)) {
      throw new BadRequestException('That dependency would create a cycle');
    }

    return this.prisma.taskTypeDependency.upsert({
      where: {
        taskTypeId_prerequisiteTaskTypeId: {
          taskTypeId, prerequisiteTaskTypeId: dto.prerequisiteTaskTypeId,
        },
      },
      update: {},
      create: { taskTypeId, prerequisiteTaskTypeId: dto.prerequisiteTaskTypeId },
    });
  }

  /** Upsert, not create: re-mapping a variant to a corrected template is routine. */
  async mapTemplate(scope: AuthzScope, taskTypeId: string, dto: MapTemplateDto) {
    await this.requireTaskType(scope, taskTypeId);
    return this.prisma.taskTypeTemplate.upsert({
      where: { taskTypeId_scopeVariant: { taskTypeId, scopeVariant: dto.scopeVariant } },
      update: { templateId: dto.templateId },
      create: { taskTypeId, scopeVariant: dto.scopeVariant, templateId: dto.templateId },
    });
  }

  /**
   * The checklist a site of this variant receives.
   *
   * Variant mapping first, then the task type's own default. Returns null when
   * neither resolves; bulk generation reports that site as skipped with a
   * reason rather than creating a task with no checklist, which would present
   * to a field engineer as a task they cannot complete.
   */
  async resolveTemplate(taskTypeId: string, scopeVariant: string | null): Promise<string | null> {
    if (scopeVariant !== null) {
      const mapped = await this.prisma.taskTypeTemplate.findUnique({
        where: { taskTypeId_scopeVariant: { taskTypeId, scopeVariant } },
        select: { templateId: true },
      });
      if (mapped) return mapped.templateId;
    }
    const taskType = await this.prisma.taskType.findUnique({
      where: { id: taskTypeId }, select: { templateId: true },
    });
    return taskType?.templateId ?? null;
  }

  /**
   * Prerequisite task types with no COMPLETED task at this site.
   *
   * Evaluated per site, not per project: D11 makes the rule about work, and a
   * project-wide evaluation would release erection everywhere as soon as one
   * site's foundation finished.
   *
   * One query, not one per prerequisite. A site with a dozen prerequisites is
   * ordinary and this runs on every task read.
   */
  async outstandingPrerequisites(siteId: string, taskTypeId: string): Promise<string[]> {
    const dependencies = await this.prisma.taskTypeDependency.findMany({
      where: { taskTypeId }, select: { prerequisiteTaskTypeId: true },
    });
    if (dependencies.length === 0) return [];

    const required = dependencies.map((d) => d.prerequisiteTaskTypeId);
    const satisfied = await this.prisma.task.findMany({
      where: { siteId, taskTypeId: { in: required }, status: 'COMPLETED' },
      select: { taskTypeId: true },
      distinct: ['taskTypeId'],
    });
    const done = new Set(satisfied.map((t) => t.taskTypeId));
    return required.filter((id) => !done.has(id));
  }

  // visibleProject, not a local copy. This predicate is the definition of
  // "project you may see"; a second copy here would drift from the one in
  // scope/project-scope.ts, and a drifted authorization rule fails open.
  private async requireProject(scope: AuthzScope, id: string): Promise<void> {
    const found = await this.prisma.project.findFirst({
      where: visibleProject(scope, id), select: { id: true },
    });
    if (!found) throw new NotFoundException('Project not found');
  }

  private async requireTaskType(scope: AuthzScope, id: string): Promise<{ id: string; projectId: string }> {
    const taskType = await this.prisma.taskType.findUnique({
      where: { id }, select: { id: true, projectId: true },
    });
    // NotFound for both "no such task type" and "outside your scope", checked
    // in that order so the second is indistinguishable from the first.
    if (!taskType) throw new NotFoundException('Task type not found');
    await this.requireProject(scope, taskType.projectId);
    return taskType;
  }
}
```

- [ ] **Step 8: Write the controller**

Create `apps/project/src/task-types/task-type.controller.ts`:

```ts
import { Body, Controller, Post, Param } from '@nestjs/common';
import { RequirePermission, type AuthzScope } from '@ipms/authz';
import { AddDependencySchema, CreateTaskTypeSchema, MapTemplateSchema, UuidSchema } from '@ipms/contracts';
import { ScopeOf } from '../http/scope.decorator.js';
import { TaskTypeService } from './task-type.service.js';

@Controller()
export class TaskTypeController {
  constructor(private readonly service: TaskTypeService) {}

  @Post('projects/:id/task-types')
  @RequirePermission('task.create')
  create(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown) {
    return this.service.createTaskType(scope, UuidSchema.parse(id), CreateTaskTypeSchema.parse(body));
  }

  @Post('task-types/:id/dependencies')
  @RequirePermission('task.update')
  addDependency(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown) {
    return this.service.addDependency(scope, UuidSchema.parse(id), AddDependencySchema.parse(body));
  }

  @Post('task-types/:id/templates')
  @RequirePermission('task.update')
  mapTemplate(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown) {
    return this.service.mapTemplate(scope, UuidSchema.parse(id), MapTemplateSchema.parse(body));
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
pnpm nx run project:test
pnpm nx run-many -t typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/project/src/task-types
git commit -m "$(cat <<'EOF'
feat(project): task-type dependencies, variant templates, and blocking

Dependencies are held at the task type level (D11) and evaluated per site: a
project-wide evaluation would release erection everywhere as soon as one
site's foundation finished.

Cycles are refused at the edge that would close them, not defended against on
traversal. Blocking is computed by walking prerequisites on every read, so a
cycle in the table is a hang rather than merely bad data -- and a task type
that transitively requires itself is permanently unstartable anyway. The
database CHECK catches the one-hop case; wouldCreateCycle catches the rest.

Cross-project prerequisites are refused: they would leave a task unstartable
until work completes in a project its PM cannot even see.

resolveTemplate returns null rather than guessing when neither the variant
mapping nor the task type default resolves. Bulk generation reports that as a
skip with a reason; creating a task with no checklist would present to a field
engineer as work they cannot complete.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: tasks — creation, transitions, and assignment

**Files:**
- Create: `apps/project/src/tasks/transitions.ts` + `transitions.spec.ts`
- Create: `apps/project/src/tasks/task.service.ts`
- Create: `apps/project/src/tasks/task.controller.ts`
- Test: `apps/project/src/tasks/task.service.integration.spec.ts`

**Interfaces:**
- Consumes: `TaskTypeService.outstandingPrerequisites` and `.resolveTemplate` (Task 10).
- Produces:
  - `type TaskStatus = 'NOT_STARTED' | 'ONGOING' | 'REVIEWING' | 'RECTIFYING' | 'COMPLETED' | 'CANCELLED'`
  - `type Channel = 'MANUAL' | 'REVIEW'`
  - `canTransition(from: TaskStatus, to: TaskStatus, channel: Channel): boolean`
  - `TaskService.createTask(scope, projectId, dto, actorId)`, `.getTask(scope, id)`, `.updateTask(scope, id, dto, actorId)`, `.assignTask(scope, id, dto, actorId)`, `.cancelTask(scope, id, actorId)`
  - Task 14's consumer calls `canTransition(..., 'REVIEW')`.

- [ ] **Step 1: Write the failing test**

Create `apps/project/src/tasks/transitions.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canTransition } from './transitions.js';

describe('canTransition — MANUAL', () => {
  it('lets a PM start a task', () => {
    expect(canTransition('NOT_STARTED', 'ONGOING', 'MANUAL')).toBe(true);
  });

  it('lets a PM un-start a task', () => {
    expect(canTransition('ONGOING', 'NOT_STARTED', 'MANUAL')).toBe(true);
  });

  it('lets a PM cancel anything that is not finished', () => {
    for (const from of ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'] as const) {
      expect(canTransition(from, 'CANCELLED', 'MANUAL')).toBe(true);
    }
  });

  it('refuses to mark a task COMPLETED by hand', () => {
    // Completion is earned by an approved submission, not asserted. A manual
    // path here would let a PM complete a task with no evidence at all, which
    // is the one thing the whole QC pipeline exists to prevent.
    expect(canTransition('REVIEWING', 'COMPLETED', 'MANUAL')).toBe(false);
    expect(canTransition('ONGOING', 'COMPLETED', 'MANUAL')).toBe(false);
  });

  it('refuses to put a task under review by hand', () => {
    expect(canTransition('ONGOING', 'REVIEWING', 'MANUAL')).toBe(false);
  });

  it('refuses to reopen a cancelled or completed task', () => {
    expect(canTransition('CANCELLED', 'ONGOING', 'MANUAL')).toBe(false);
    expect(canTransition('COMPLETED', 'ONGOING', 'MANUAL')).toBe(false);
  });
});

describe('canTransition — REVIEW', () => {
  it('accepts the submission lifecycle', () => {
    expect(canTransition('ONGOING', 'REVIEWING', 'REVIEW')).toBe(true);
    expect(canTransition('REVIEWING', 'COMPLETED', 'REVIEW')).toBe(true);
    expect(canTransition('REVIEWING', 'RECTIFYING', 'REVIEW')).toBe(true);
    expect(canTransition('RECTIFYING', 'REVIEWING', 'REVIEW')).toBe(true);
  });

  it('accepts a submission against a task nobody started', () => {
    // A field engineer can submit without anyone having pressed "start". The
    // event is the ground truth about what happened; refusing it would strand
    // a real submission behind a bookkeeping step.
    expect(canTransition('NOT_STARTED', 'REVIEWING', 'REVIEW')).toBe(true);
  });

  it('refuses to move a cancelled task', () => {
    // A late redelivery for work that was called off must not resurrect it.
    expect(canTransition('CANCELLED', 'REVIEWING', 'REVIEW')).toBe(false);
    expect(canTransition('CANCELLED', 'COMPLETED', 'REVIEW')).toBe(false);
  });

  it('treats a repeat of the current status as a no-op, not a failure', () => {
    // At-least-once delivery. A redelivered approval for an already-COMPLETED
    // task must not dead-letter.
    expect(canTransition('COMPLETED', 'COMPLETED', 'REVIEW')).toBe(true);
    expect(canTransition('REVIEWING', 'REVIEWING', 'REVIEW')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm nx run project:test -- transitions
```

Expected: FAIL — `Cannot find module './transitions.js'`.

- [ ] **Step 3: Write the transitions**

Create `apps/project/src/tasks/transitions.ts`:

```ts
export type TaskStatus = 'NOT_STARTED' | 'ONGOING' | 'REVIEWING' | 'RECTIFYING' | 'COMPLETED' | 'CANCELLED';

/**
 * Who is asking. MANUAL is a PM or engineer through the HTTP API; REVIEW is
 * the qc.submission.* consumer.
 *
 * They are different vocabularies on purpose. COMPLETED is reachable only
 * through REVIEW, because completion is earned by an approved submission
 * rather than asserted — a manual path would let a PM complete a task with no
 * evidence, which is the one thing the QC pipeline exists to prevent.
 */
export type Channel = 'MANUAL' | 'REVIEW';

const MANUAL: Record<TaskStatus, TaskStatus[]> = {
  NOT_STARTED: ['ONGOING', 'CANCELLED'],
  ONGOING: ['NOT_STARTED', 'CANCELLED'],
  REVIEWING: ['CANCELLED'],
  RECTIFYING: ['ONGOING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const REVIEW: Record<TaskStatus, TaskStatus[]> = {
  // A submission can arrive for a task nobody pressed "start" on. The event is
  // the ground truth about what happened in the field; refusing it would
  // strand a real submission behind a bookkeeping step.
  NOT_STARTED: ['REVIEWING'],
  ONGOING: ['REVIEWING'],
  REVIEWING: ['COMPLETED', 'RECTIFYING'],
  RECTIFYING: ['REVIEWING'],
  // A late approval for work already complete is a redelivery, handled below.
  COMPLETED: [],
  // Cancelled is terminal for both channels: a redelivered event for work that
  // was called off must not resurrect it.
  CANCELLED: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus, channel: Channel): boolean {
  // At-least-once delivery makes a repeat of the current status routine. It is
  // a no-op, not a failure — treating it as one would dead-letter a message
  // whose desired end state already holds.
  if (channel === 'REVIEW' && from === to) return true;
  return (channel === 'MANUAL' ? MANUAL : REVIEW)[from].includes(to);
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm nx run project:test -- transitions
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Write the failing service test**

Create `apps/project/src/tasks/task.service.integration.spec.ts`, opening with the
harness preamble from Task 5 Step 6. `seed()` already gives you `ERECT` depending on
`FOUNDATION` in project A:

```ts
describe('createTask', () => {
  it('refuses a site from another project', async () => {
    await expect(
      service.createTask(GLOBAL, projectA, { siteId: siteInB, taskTypeId: erectId, title: 'X', origin: 'AD_HOC' }, ACTOR),
    ).rejects.toThrow(/belong to this project/i);
  });

  it('returns 409, not 500, on a duplicate planned task', async () => {
    const dto = { siteId: siteInA, taskTypeId: erectId, title: 'Erect', origin: 'PLANNED' as const };
    await service.createTask(GLOBAL, projectA, dto, ACTOR);
    // The partial unique index already prevented the duplicate row. The spike
    // read-then-wrote and let P2002 escape as a 500.
    await expect(service.createTask(GLOBAL, projectA, dto, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows any number of ad-hoc tasks for the same site and type', async () => {
    // The unique index is partial on origin='PLANNED' precisely so spot checks
    // never collide with planned scope.
    const dto = { siteId: siteInA, taskTypeId: erectId, title: 'Spot check', origin: 'AD_HOC' as const };
    await service.createTask(GLOBAL, projectA, dto, ACTOR);
    await expect(service.createTask(GLOBAL, projectA, dto, ACTOR)).resolves.toBeDefined();
  });

  it('inherits the template resolved for the site variant', async () => {
    await prisma.site.update({ where: { id: siteInA }, data: { scopeVariant: 'RRU Only' } });
    await prisma.taskTypeTemplate.create({ data: { taskTypeId: erectId, scopeVariant: 'RRU Only', templateId: rruTemplate } });
    const task = await service.createTask(
      GLOBAL, projectA, { siteId: siteInA, taskTypeId: erectId, title: 'Erect', origin: 'AD_HOC' }, ACTOR,
    );
    expect(task.templateId).toBe(rruTemplate);
  });
});

describe('blocking', () => {
  it('refuses to start a task whose prerequisite is outstanding', async () => {
    const task = await service.createTask(
      GLOBAL, projectA, { siteId: siteInA, taskTypeId: erectId, title: 'Erect', origin: 'PLANNED' }, ACTOR,
    );
    await expect(service.updateTask(GLOBAL, task.id, { status: 'ONGOING' }, ACTOR))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('names the outstanding prerequisites in the refusal', async () => {
    const task = await service.createTask(
      GLOBAL, projectA, { siteId: siteInA, taskTypeId: erectId, title: 'Erect', origin: 'PLANNED' }, ACTOR,
    );
    // "Blocked" with no explanation sends the PM hunting. Name what is missing.
    await expect(service.updateTask(GLOBAL, task.id, { status: 'ONGOING' }, ACTOR))
      .rejects.toThrow(new RegExp(foundationCode, 'i'));
  });

  it('starts once the prerequisite is COMPLETED at that site', async () => {
    await prisma.task.create({
      data: {
        id: uuidv7(), projectId: projectA, siteId: siteInA, taskTypeId: foundationId,
        title: 'Foundation', origin: 'PLANNED', status: 'COMPLETED', createdBy: ACTOR,
      },
    });
    const task = await service.createTask(
      GLOBAL, projectA, { siteId: siteInA, taskTypeId: erectId, title: 'Erect', origin: 'PLANNED' }, ACTOR,
    );
    const started = await service.updateTask(GLOBAL, task.id, { status: 'ONGOING' }, ACTOR);
    expect(started.status).toBe('ONGOING');
  });

  it('still allows assignment while blocked, so a PM can plan ahead', async () => {
    const task = await service.createTask(
      GLOBAL, projectA, { siteId: siteInA, taskTypeId: erectId, title: 'Erect', origin: 'PLANNED' }, ACTOR,
    );
    await expect(service.assignTask(GLOBAL, task.id, { assigneeId: ENGINEER }, ACTOR)).resolves.toBeDefined();
  });

  it('reports blocked and its reasons on read', async () => {
    const task = await service.createTask(
      GLOBAL, projectA, { siteId: siteInA, taskTypeId: erectId, title: 'Erect', origin: 'PLANNED' }, ACTOR,
    );
    const read = await service.getTask(GLOBAL, task.id);
    expect(read.blocked).toBe(true);
    expect(read.outstandingPrerequisites).toEqual([foundationId]);
  });
});

describe('transitions', () => {
  it('refuses to mark a task COMPLETED through the API', async () => {
    const task = await service.createTask(
      GLOBAL, projectA, { siteId: siteInA, taskTypeId: foundationId, title: 'F', origin: 'PLANNED' }, ACTOR,
    );
    await expect(service.updateTask(GLOBAL, task.id, { status: 'COMPLETED' }, ACTOR))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('scope', () => {
  it('returns 404 for a task outside scope', async () => {
    const task = await service.createTask(
      GLOBAL, projectB, { siteId: siteInB, taskTypeId: foreignTaskTypeId, title: 'X', origin: 'AD_HOC' }, ACTOR,
    );
    await expect(service.getTask(onlyA(), task.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to assign a task outside scope', async () => {
    const task = await service.createTask(
      GLOBAL, projectB, { siteId: siteInB, taskTypeId: foreignTaskTypeId, title: 'X', origin: 'AD_HOC' }, ACTOR,
    );
    await expect(service.assignTask(onlyA(), task.id, { assigneeId: ENGINEER }, ACTOR))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm nx run project:test -- task.service.integration
```

Expected: FAIL — `Cannot find module './task.service.js'`.

- [ ] **Step 7: Write the service**

Create `apps/project/src/tasks/task.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { uuidv7, type AssignTaskDto, type CreateTaskDto, type UpdateTaskDto } from '@ipms/contracts';
import type { TaskTypeService } from '../task-types/task-type.service.js';
import { canTransition, type TaskStatus } from './transitions.js';

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly taskTypes: TaskTypeService,
  ) {}

  async listTasks(scope: AuthzScope, filters: { projectId?: string; siteId?: string; status?: TaskStatus }) {
    return this.prisma.task.findMany({
      where: {
        AND: [
          scopeWhere(scope),
          ...(filters.projectId === undefined ? [] : [{ projectId: filters.projectId }]),
          ...(filters.siteId === undefined ? [] : [{ siteId: filters.siteId }]),
          ...(filters.status === undefined ? [] : [{ status: filters.status }]),
        ],
      },
      orderBy: [{ siteId: 'asc' }, { title: 'asc' }],
    });
  }

  async getTask(scope: AuthzScope, id: string) {
    const task = await this.requireTask(scope, id);
    const outstanding = await this.taskTypes.outstandingPrerequisites(task.siteId, task.taskTypeId);
    return { ...task, blocked: outstanding.length > 0, outstandingPrerequisites: outstanding };
  }

  async createTask(scope: AuthzScope, projectId: string, dto: CreateTaskDto, actorId: string) {
    const [site, taskType] = await Promise.all([
      this.prisma.site.findFirst({
        where: { AND: [{ id: dto.siteId, projectId }, scopeWhere(scope)] },
        select: { id: true, scopeVariant: true },
      }),
      this.prisma.taskType.findFirst({ where: { id: dto.taskTypeId, projectId }, select: { id: true } }),
    ]);
    if (!site || !taskType) throw new BadRequestException('Site and task type must belong to this project');

    const templateId = dto.templateId ?? await this.taskTypes.resolveTemplate(dto.taskTypeId, site.scopeVariant);

    try {
      return await this.prisma.task.create({
        data: {
          id: uuidv7(), projectId, siteId: dto.siteId, taskTypeId: dto.taskTypeId,
          title: dto.title, origin: dto.origin, assigneeId: dto.assigneeId ?? null,
          plannedCompletionAt: dto.plannedCompletionAt ?? null,
          createdBy: actorId, templateId,
        },
      });
    } catch (err) {
      // The partial unique index planned_task_per_site_type already prevents
      // the duplicate row. Trusting it, rather than reading first, is what
      // makes this correct under concurrent bulk generation — a pre-read lets
      // two callers both pass the check and one then 500s on P2002.
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('A planned task already exists for this site and task type');
      }
      throw err;
    }
  }

  async updateTask(scope: AuthzScope, id: string, dto: UpdateTaskDto, _actorId: string) {
    const task = await this.requireTask(scope, id);

    if (dto.status !== undefined && dto.status !== task.status) {
      if (!canTransition(task.status as TaskStatus, dto.status, 'MANUAL')) {
        throw new ConflictException(`Cannot move a task from ${task.status} to ${dto.status}`);
      }
      if (dto.status === 'ONGOING') {
        const outstanding = await this.taskTypes.outstandingPrerequisites(task.siteId, task.taskTypeId);
        if (outstanding.length > 0) {
          // Name what is missing. "Blocked" on its own sends the PM hunting
          // through the dependency table to find out why.
          const codes = await this.prisma.taskType.findMany({
            where: { id: { in: outstanding } }, select: { code: true },
          });
          throw new ConflictException(
            `Blocked by incomplete prerequisites at this site: ${codes.map((c) => c.code).join(', ')}`,
          );
        }
      }
    }

    return this.prisma.task.update({
      where: { id },
      data: {
        ...(dto.title === undefined ? {} : { title: dto.title }),
        ...(dto.status === undefined ? {} : { status: dto.status }),
        ...(dto.plannedCompletionAt === undefined ? {} : { plannedCompletionAt: dto.plannedCompletionAt }),
      },
    });
  }

  /**
   * Assignment is never refused for a blocked task. A PM plans next week's
   * work before this week's finishes; blocking gates *starting*, not queueing.
   */
  async assignTask(scope: AuthzScope, id: string, dto: AssignTaskDto, _actorId: string) {
    await this.requireTask(scope, id);
    return this.prisma.task.update({ where: { id }, data: { assigneeId: dto.assigneeId } });
  }

  async cancelTask(scope: AuthzScope, id: string, _actorId: string) {
    const task = await this.requireTask(scope, id);
    if (!canTransition(task.status as TaskStatus, 'CANCELLED', 'MANUAL')) {
      throw new ConflictException(`Cannot cancel a task that is ${task.status}`);
    }
    return this.prisma.task.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  private async requireTask(scope: AuthzScope, id: string) {
    const task = await this.prisma.task.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] } });
    // NotFound covers both "no such task" and "outside your scope". A 403
    // would confirm the id names a real task in a project the caller cannot see.
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
```

- [ ] **Step 8: Write the controller**

Create `apps/project/src/tasks/task.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzScope, type AuthzUser } from '@ipms/authz';
import { AssignTaskSchema, CreateTaskSchema, TaskStatusSchema, UpdateTaskSchema, UuidSchema } from '@ipms/contracts';
import { ScopeOf } from '../http/scope.decorator.js';
import { TaskService } from './task.service.js';

@Controller()
export class TaskController {
  constructor(private readonly service: TaskService) {}

  @Get('tasks')
  @RequirePermission('task.view')
  list(
    @ScopeOf() scope: AuthzScope,
    @Query('projectId') projectId?: string,
    @Query('siteId') siteId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listTasks(scope, {
      ...(projectId === undefined ? {} : { projectId: UuidSchema.parse(projectId) }),
      ...(siteId === undefined ? {} : { siteId: UuidSchema.parse(siteId) }),
      ...(status === undefined ? {} : { status: TaskStatusSchema.parse(status) }),
    });
  }

  @Get('tasks/:id')
  @RequirePermission('task.view')
  get(@ScopeOf() scope: AuthzScope, @Param('id') id: string) {
    return this.service.getTask(scope, UuidSchema.parse(id));
  }

  @Post('projects/:id/tasks')
  @RequirePermission('task.create')
  create(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.service.createTask(scope, UuidSchema.parse(id), CreateTaskSchema.parse(body), req.user.id);
  }

  @Patch('tasks/:id')
  @RequirePermission('task.update')
  update(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.service.updateTask(scope, UuidSchema.parse(id), UpdateTaskSchema.parse(body), req.user.id);
  }

  @Post('tasks/:id/assign')
  @RequirePermission('task.assign')
  assign(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.service.assignTask(scope, UuidSchema.parse(id), AssignTaskSchema.parse(body), req.user.id);
  }

  @Post('tasks/:id/cancel')
  @RequirePermission('task.cancel')
  cancel(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Req() req: { user: AuthzUser }) {
    return this.service.cancelTask(scope, UuidSchema.parse(id), req.user.id);
  }
}
```

- [ ] **Step 9: Run the tests and commit**

```bash
pnpm nx run project:test
pnpm nx run-many -t typecheck
git add apps/project/src/tasks
git commit -m "$(cat <<'EOF'
feat(project): task creation, transitions, and dependency blocking

COMPLETED and REVIEWING are reachable only through the REVIEW channel, never
through the HTTP API. Completion is earned by an approved submission rather
than asserted; a manual path would let a PM complete a task with no evidence,
which is the one thing the QC pipeline exists to prevent.

Creation trusts the existing partial unique index instead of reading first.
The spike's read-then-write let two concurrent callers both pass the check,
after which one escaped P2002 as a 500; now a genuine duplicate is a 409 and
concurrent bulk generation converges. Ad-hoc tasks are unaffected -- the index
is partial on origin='PLANNED' precisely so spot checks never collide with
planned scope.

Blocking gates starting, not queueing: a blocked task can still be assigned,
because a PM plans next week's work before this week's finishes. The refusal
names the outstanding prerequisite codes rather than saying "blocked", which
would send the PM hunting through the dependency table.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: bulk generation

"Generate CW RFI scope for all sites." Idempotent by construction, so re-running after
adding a site gives that site its missing tasks and changes nothing else.

**Files:**
- Create: `apps/project/src/tasks/generation.service.ts`
- Test: `apps/project/src/tasks/generation.service.integration.spec.ts`

**Interfaces:**
- Consumes: `TaskTypeService.resolveTemplate` (Task 10).
- Produces: `GenerationService.generate(scope, projectId, milestoneId, dto, actorId): Promise<GenerationReport>` where

```ts
export interface GenerationReport {
  created: number;
  skipped: Array<{ siteId: string; taskTypeId: string; reason: 'ALREADY_EXISTS' | 'NO_TEMPLATE' }>;
}
```

- [ ] **Step 1: Write the failing test**

Create `apps/project/src/tasks/generation.service.integration.spec.ts`, opening with the
harness preamble from Task 5 Step 6. `seed()` gives project A two sites and a `CW_RFI`
milestone requiring two task types; add a third site in `beforeEach` where a test needs
one:

```ts
describe('generate', () => {
  it('creates one task per site per required task type', async () => {
    const report = await service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR);
    expect(report.created).toBe(6);   // 3 sites x 2 required task types
    expect(await prisma.task.count({ where: { projectId: projectA } })).toBe(6);
  });

  it('creates nothing on a second run', async () => {
    await service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR);
    const second = await service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR);
    expect(second.created).toBe(0);
    expect(second.skipped.every((s) => s.reason === 'ALREADY_EXISTS')).toBe(true);
    expect(await prisma.task.count({ where: { projectId: projectA } })).toBe(6);
  });

  it('gives a site added later exactly its missing tasks', async () => {
    await service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR);
    const lateSite = uuidv7();
    await prisma.site.create({ data: { id: lateSite, projectId: projectA, siteCode: 'LATE1', name: 'Late' } });
    const report = await service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR);
    expect(report.created).toBe(2);
    expect(await prisma.task.count({ where: { siteId: lateSite } })).toBe(2);
  });

  it('converges under two concurrent runs instead of racing', async () => {
    // The spike read-then-wrote, so both callers passed the existence check
    // and one 500d on P2002. ON CONFLICT DO NOTHING makes the loser a no-op.
    const [a, b] = await Promise.all([
      service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR),
      service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR),
    ]);
    expect(a.created + b.created).toBe(6);
    expect(await prisma.task.count({ where: { projectId: projectA } })).toBe(6);
  });

  it('reports a task type with no resolvable template as skipped, without aborting', async () => {
    // Partial scope is more useful than an aborted batch: one misconfigured
    // task type must not deny every other site its work.
    await prisma.taskType.update({ where: { id: untemplatedId }, data: { templateId: null } });
    const report = await service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR);
    expect(report.created).toBe(3);
    expect(report.skipped.filter((s) => s.reason === 'NO_TEMPLATE')).toHaveLength(3);
  });

  it('resolves each site\'s variant to its own template', async () => {
    await prisma.site.update({ where: { id: siteInA }, data: { scopeVariant: 'RRU Only' } });
    await prisma.taskTypeTemplate.create({ data: { taskTypeId: erectId, scopeVariant: 'RRU Only', templateId: rruTemplate } });
    await service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR);
    const scoped = await prisma.task.findFirst({ where: { siteId: siteInA, taskTypeId: erectId } });
    const other = await prisma.task.findFirst({ where: { siteId: otherSiteInA, taskTypeId: erectId } });
    expect(scoped?.templateId).toBe(rruTemplate);
    expect(other?.templateId).toBe(defaultTemplate);
  });

  it('generates only for the named sites when given a subset', async () => {
    const report = await service.generate(GLOBAL, projectA, milestoneId, { siteIds: [siteInA] }, ACTOR);
    expect(report.created).toBe(2);
  });

  it('generates only within the caller\'s scope', async () => {
    // A PM scoped to one site must not generate work across the whole project.
    const report = await service.generate(onlySite(siteInA), projectA, milestoneId, { siteIds: [] }, ACTOR);
    expect(report.created).toBe(2);
    expect(await prisma.task.count({ where: { siteId: otherSiteInA } })).toBe(0);
  });

  it('refuses a milestone from another project', async () => {
    await expect(service.generate(GLOBAL, projectA, foreignMilestoneId, { siteIds: [] }, ACTOR))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('opens a SiteMilestone row for every site it touches', async () => {
    await service.generate(GLOBAL, projectA, milestoneId, { siteIds: [] }, ACTOR);
    expect(await prisma.siteMilestone.count({ where: { milestoneId } })).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm nx run project:test -- generation.service.integration
```

Expected: FAIL — `Cannot find module './generation.service.js'`.

- [ ] **Step 3: Write the service**

Create `apps/project/src/tasks/generation.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { uuidv7, type GenerateScopeDto } from '@ipms/contracts';
import type { TaskTypeService } from '../task-types/task-type.service.js';

export interface GenerationReport {
  created: number;
  skipped: Array<{ siteId: string; taskTypeId: string; reason: 'ALREADY_EXISTS' | 'NO_TEMPLATE' }>;
}

@Injectable()
export class GenerationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly taskTypes: TaskTypeService,
  ) {}

  /**
   * Creates the tasks a milestone's scope requires, for every site in range
   * that does not already have them.
   *
   * Idempotence comes from the partial unique index
   * `planned_task_per_site_type`, not from a pre-read. `createMany` with
   * `skipDuplicates` emits `ON CONFLICT DO NOTHING` with no conflict target,
   * which catches a violation of any unique constraint including a partial
   * one — so two concurrent runs converge on the same six rows instead of one
   * of them losing a race and returning 500.
   */
  async generate(
    scope: AuthzScope,
    projectId: string,
    milestoneId: string,
    dto: GenerateScopeDto,
    actorId: string,
  ): Promise<GenerationReport> {
    const milestone = await this.prisma.milestone.findFirst({
      where: { id: milestoneId, projectId },
      include: { requirements: { select: { taskTypeId: true } } },
    });
    // NotFound for a milestone in another project, indistinguishably from one
    // that does not exist.
    if (!milestone) throw new NotFoundException('Milestone not found');

    const sites = await this.prisma.site.findMany({
      where: {
        AND: [
          { projectId },
          scopeWhere(scope),
          ...(dto.siteIds.length === 0 ? [] : [{ id: { in: dto.siteIds } }]),
        ],
      },
      select: { id: true, siteCode: true, scopeVariant: true },
    });

    const required = milestone.requirements.map((r) => r.taskTypeId);
    const taskTypes = await this.prisma.taskType.findMany({
      where: { id: { in: required } },
      select: { id: true, code: true, name: true },
    });
    const byId = new Map(taskTypes.map((t) => [t.id, t]));

    const rows: Array<{
      id: string; projectId: string; siteId: string; taskTypeId: string;
      templateId: string; title: string; origin: string; createdBy: string;
    }> = [];
    const skipped: GenerationReport['skipped'] = [];

    for (const site of sites) {
      for (const taskTypeId of required) {
        const taskType = byId.get(taskTypeId);
        if (!taskType) continue;

        const templateId = await this.taskTypes.resolveTemplate(taskTypeId, site.scopeVariant);
        if (templateId === null) {
          // Reported, not thrown. One misconfigured task type must not deny
          // every other site its work; partial scope beats an aborted batch.
          skipped.push({ siteId: site.id, taskTypeId, reason: 'NO_TEMPLATE' });
          continue;
        }

        rows.push({
          id: uuidv7(), projectId, siteId: site.id, taskTypeId, templateId,
          title: `${taskType.name} — ${site.siteCode}`,
          origin: 'PLANNED', createdBy: actorId,
        });
      }
    }

    const { count } = rows.length === 0
      ? { count: 0 }
      : await this.prisma.task.createMany({ data: rows, skipDuplicates: true });

    // Whatever did not insert already existed. Derived from the count rather
    // than from a second query, so the report cannot disagree with the write.
    if (count < rows.length) {
      const existing = await this.prisma.task.findMany({
        where: { projectId, origin: 'PLANNED', taskTypeId: { in: required }, siteId: { in: sites.map((s) => s.id) } },
        select: { siteId: true, taskTypeId: true, id: true },
      });
      const written = new Set(rows.map((r) => `${r.siteId}:${r.taskTypeId}`));
      for (const row of existing) {
        const key = `${row.siteId}:${row.taskTypeId}`;
        if (written.has(key) && !rows.some((r) => r.id === row.id)) {
          skipped.push({ siteId: row.siteId, taskTypeId: row.taskTypeId, reason: 'ALREADY_EXISTS' });
        }
      }
    }

    // Open a SiteMilestone row for every site in range, so the milestone shows
    // up on the site's dashboard as NOT_STARTED rather than being absent until
    // the first task completes.
    await this.prisma.siteMilestone.createMany({
      data: sites.map((site) => ({
        id: uuidv7(), siteId: site.id, milestoneId,
        status: 'NOT_STARTED',
        targetDate: milestone.targetDate,
      })),
      skipDuplicates: true,
    });

    return { created: count, skipped };
  }
}
```

- [ ] **Step 4: Run the tests and commit**

```bash
pnpm nx run project:test -- generation.service.integration
pnpm nx run-many -t typecheck
git add apps/project/src/tasks/generation.service.ts apps/project/src/tasks/generation.service.integration.spec.ts
git commit -m "$(cat <<'EOF'
feat(project): idempotent bulk generation of a milestone's scope

Idempotence comes from the partial unique index, not from a pre-read.
createMany with skipDuplicates emits ON CONFLICT DO NOTHING with no conflict
target, which catches a violation of any unique constraint including a partial
one, so two concurrent runs converge instead of one losing the race and
returning 500. Re-running after adding a site gives that site its missing
tasks and changes nothing else.

A task type with no resolvable template is reported as skipped rather than
aborting the run. One misconfigured task type must not deny every other site
its work.

Generation respects the caller's scope: a PM scoped to one site generates for
that site, not across the whole project.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: milestone recomputation, declaration, and progress

**Files:**
- Create: `apps/project/src/milestones/recompute.ts` + `recompute.spec.ts`
- Create: `apps/project/src/milestones/milestone.service.ts`
- Create: `apps/project/src/milestones/milestone.controller.ts`
- Test: `apps/project/src/milestones/milestone.service.integration.spec.ts`

**Interfaces:**
- Produces:
  - `recomputeStatus(required: readonly string[], tasks: ReadonlyArray<{ taskTypeId: string; status: string }>, current: SiteMilestoneStatus): SiteMilestoneStatus`
  - `MilestoneService.createMilestone(scope, projectId, dto)`, `.recomputeForSite(siteId)`, `.listForSite(scope, siteId)`, `.declare(scope, siteMilestoneId, dto, actorId)`, `.progress(scope, projectId, milestoneId)`
  - Task 14's consumer calls `recomputeForSite`.

- [ ] **Step 1: Write the failing test**

Create `apps/project/src/milestones/recompute.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { recomputeStatus } from './recompute.js';

const FOUNDATION = 'tt-foundation';
const ERECT = 'tt-erect';
const REQUIRED = [FOUNDATION, ERECT];

describe('recomputeStatus', () => {
  it('is NOT_STARTED when no required task exists yet', () => {
    expect(recomputeStatus(REQUIRED, [], 'NOT_STARTED')).toBe('NOT_STARTED');
  });

  it('is NOT_STARTED when every task exists but none has begun', () => {
    const tasks = [
      { taskTypeId: FOUNDATION, status: 'NOT_STARTED' },
      { taskTypeId: ERECT, status: 'NOT_STARTED' },
    ];
    expect(recomputeStatus(REQUIRED, tasks, 'NOT_STARTED')).toBe('NOT_STARTED');
  });

  it('is IN_PROGRESS once any task has begun', () => {
    const tasks = [
      { taskTypeId: FOUNDATION, status: 'ONGOING' },
      { taskTypeId: ERECT, status: 'NOT_STARTED' },
    ];
    expect(recomputeStatus(REQUIRED, tasks, 'NOT_STARTED')).toBe('IN_PROGRESS');
  });

  it('is IN_PROGRESS when some but not all required types are complete', () => {
    const tasks = [
      { taskTypeId: FOUNDATION, status: 'COMPLETED' },
      { taskTypeId: ERECT, status: 'ONGOING' },
    ];
    expect(recomputeStatus(REQUIRED, tasks, 'IN_PROGRESS')).toBe('IN_PROGRESS');
  });

  it('is ELIGIBLE when every required type has a completed task', () => {
    const tasks = [
      { taskTypeId: FOUNDATION, status: 'COMPLETED' },
      { taskTypeId: ERECT, status: 'COMPLETED' },
    ];
    expect(recomputeStatus(REQUIRED, tasks, 'IN_PROGRESS')).toBe('ELIGIBLE');
  });

  it('ignores a cancelled task when judging completeness', () => {
    // A cancelled task is not completed work. Counting it would make a
    // milestone eligible because someone called the work off.
    const tasks = [
      { taskTypeId: FOUNDATION, status: 'COMPLETED' },
      { taskTypeId: ERECT, status: 'CANCELLED' },
    ];
    expect(recomputeStatus(REQUIRED, tasks, 'IN_PROGRESS')).toBe('IN_PROGRESS');
  });

  it('counts a type complete when any of its tasks is complete', () => {
    // Ad-hoc spot checks share a task type with planned work. One completed
    // task of that type satisfies the requirement.
    const tasks = [
      { taskTypeId: FOUNDATION, status: 'RECTIFYING' },
      { taskTypeId: FOUNDATION, status: 'COMPLETED' },
      { taskTypeId: ERECT, status: 'COMPLETED' },
    ];
    expect(recomputeStatus(REQUIRED, tasks, 'IN_PROGRESS')).toBe('ELIGIBLE');
  });

  it('never downgrades an ACHIEVED milestone', () => {
    // Achievement is a formal declaration by an accountable actor. It is
    // withdrawn explicitly, never as a side effect of reopening a task.
    const tasks = [{ taskTypeId: FOUNDATION, status: 'RECTIFYING' }];
    expect(recomputeStatus(REQUIRED, tasks, 'ACHIEVED')).toBe('ACHIEVED');
  });

  it('downgrades ELIGIBLE when a completed task is reopened', () => {
    // ELIGIBLE is computed, so it follows the tasks both ways.
    const tasks = [
      { taskTypeId: FOUNDATION, status: 'RECTIFYING' },
      { taskTypeId: ERECT, status: 'COMPLETED' },
    ];
    expect(recomputeStatus(REQUIRED, tasks, 'ELIGIBLE')).toBe('IN_PROGRESS');
  });

  it('is ELIGIBLE for a milestone that requires nothing', () => {
    // Vacuously true, and the honest answer: a milestone with no requirements
    // has nothing outstanding. Reporting NOT_STARTED forever would be worse.
    expect(recomputeStatus([], [], 'NOT_STARTED')).toBe('ELIGIBLE');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm nx run project:test -- recompute
```

Expected: FAIL — `Cannot find module './recompute.js'`.

- [ ] **Step 3: Write the pure function**

Create `apps/project/src/milestones/recompute.ts`:

```ts
export type SiteMilestoneStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'ELIGIBLE' | 'ACHIEVED';

/**
 * A site milestone's status, derived entirely from that site's tasks.
 *
 * Pure, and a total function of its inputs, which is what makes at-least-once
 * event delivery safe: running it twice is indistinguishable from running it
 * once, so a redelivered approval cannot double-count anything.
 *
 * ELIGIBLE is computed and follows the tasks in both directions. ACHIEVED is
 * declared, and is never downgraded here — it is a formal act by an
 * accountable actor, withdrawn explicitly rather than as a side effect of
 * someone reopening a task.
 */
export function recomputeStatus(
  required: readonly string[],
  tasks: ReadonlyArray<{ taskTypeId: string; status: string }>,
  current: SiteMilestoneStatus,
): SiteMilestoneStatus {
  if (current === 'ACHIEVED') return 'ACHIEVED';

  const relevant = tasks.filter((t) => required.includes(t.taskTypeId));
  const completedTypes = new Set(relevant.filter((t) => t.status === 'COMPLETED').map((t) => t.taskTypeId));

  // A milestone requiring nothing has nothing outstanding. Vacuously eligible
  // is the honest answer; NOT_STARTED forever would be worse.
  if (required.every((id) => completedTypes.has(id))) return 'ELIGIBLE';

  // CANCELLED is not progress and not completion — it is work called off.
  const started = relevant.some((t) => t.status !== 'NOT_STARTED' && t.status !== 'CANCELLED');
  return started ? 'IN_PROGRESS' : 'NOT_STARTED';
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm nx run project:test -- recompute
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Write the service**

Create `apps/project/src/milestones/milestone.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { uuidv7, type CreateMilestoneDto, type DeclareMilestoneDto } from '@ipms/contracts';
import { visibleProject } from '../scope/project-scope.js';
import { recomputeStatus, type SiteMilestoneStatus } from './recompute.js';

export interface MilestoneTransition {
  siteMilestoneId: string;
  milestoneId: string;
  siteId: string;
  projectId: string;
  from: SiteMilestoneStatus;
  to: SiteMilestoneStatus;
}

@Injectable()
export class MilestoneService {
  constructor(private readonly prisma: PrismaClient) {}

  async createMilestone(scope: AuthzScope, projectId: string, dto: CreateMilestoneDto) {
    await this.requireProject(scope, projectId);
    const owned = dto.taskTypeIds.length === 0
      ? 0
      : await this.prisma.taskType.count({ where: { id: { in: dto.taskTypeIds }, projectId } });
    if (owned !== dto.taskTypeIds.length) {
      throw new ConflictException('Every required task type must belong to this project');
    }
    return this.prisma.$transaction(async (tx) => {
      const milestone = await tx.milestone.create({
        data: {
          id: uuidv7(), projectId, code: dto.code, name: dto.name,
          kind: dto.kind, sequence: dto.sequence, targetDate: dto.targetDate ?? null,
        },
      });
      if (dto.taskTypeIds.length > 0) {
        await tx.milestoneRequirement.createMany({
          data: dto.taskTypeIds.map((taskTypeId) => ({ milestoneId: milestone.id, taskTypeId })),
        });
      }
      return milestone;
    });
  }

  /**
   * Recomputes every milestone touching this site, and reports what changed.
   *
   * Returns the transitions rather than publishing them, so the caller owns
   * the transaction and the outbox write. Publishing from in here would emit
   * project.milestone.eligible before the status row was durable.
   */
  async recomputeForSite(siteId: string): Promise<MilestoneTransition[]> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true, projectId: true } });
    if (!site) return [];

    const [tasks, milestones] = await Promise.all([
      this.prisma.task.findMany({ where: { siteId }, select: { taskTypeId: true, status: true } }),
      this.prisma.milestone.findMany({
        where: { projectId: site.projectId },
        include: { requirements: { select: { taskTypeId: true } } },
      }),
    ]);

    const transitions: MilestoneTransition[] = [];
    for (const milestone of milestones) {
      const required = milestone.requirements.map((r) => r.taskTypeId);
      const existing = await this.prisma.siteMilestone.findUnique({
        where: { siteId_milestoneId: { siteId, milestoneId: milestone.id } },
      });
      const current = (existing?.status ?? 'NOT_STARTED') as SiteMilestoneStatus;
      const next = recomputeStatus(required, tasks, current);
      if (existing !== null && next === current) continue;

      const row = await this.prisma.siteMilestone.upsert({
        where: { siteId_milestoneId: { siteId, milestoneId: milestone.id } },
        update: {
          status: next,
          // Stamped on the first crossing into ELIGIBLE and left alone after,
          // so a downgrade-and-recovery does not rewrite when it first became
          // deliverable.
          ...(next === 'ELIGIBLE' && existing?.eligibleAt == null ? { eligibleAt: new Date() } : {}),
        },
        create: {
          id: uuidv7(), siteId, milestoneId: milestone.id, status: next,
          targetDate: milestone.targetDate,
          ...(next === 'ELIGIBLE' ? { eligibleAt: new Date() } : {}),
        },
      });

      if (next !== current) {
        transitions.push({
          siteMilestoneId: row.id, milestoneId: milestone.id, siteId,
          projectId: site.projectId, from: current, to: next,
        });
      }
    }
    return transitions;
  }

  async listForSite(scope: AuthzScope, siteId: string) {
    const site = await this.prisma.site.findFirst({
      where: { AND: [{ id: siteId }, scopeWhere(scope)] }, select: { id: true },
    });
    if (!site) throw new NotFoundException('Site not found');
    return this.prisma.siteMilestone.findMany({
      where: { siteId },
      include: { milestone: true },
      orderBy: { milestone: { sequence: 'asc' } },
    });
  }

  /**
   * The formal act. Refused unless the row is currently ELIGIBLE: declaring a
   * milestone achieved while its work is outstanding is precisely the claim
   * the audit ledger exists to make impossible to fake.
   */
  async declare(scope: AuthzScope, siteMilestoneId: string, dto: DeclareMilestoneDto, actorId: string) {
    const row = await this.prisma.siteMilestone.findFirst({
      where: { AND: [{ id: siteMilestoneId }, { site: scopeWhere(scope) }] },
      include: { site: { select: { projectId: true } } },
    });
    if (!row) throw new NotFoundException('Site milestone not found');
    if (row.status === 'ACHIEVED') throw new ConflictException('This milestone is already achieved');
    if (row.status !== 'ELIGIBLE') {
      throw new ConflictException('A milestone can only be declared achieved once it is eligible');
    }
    return this.prisma.siteMilestone.update({
      where: { id: siteMilestoneId },
      data: { status: 'ACHIEVED', achievedAt: new Date(), declaredBy: actorId },
    });
  }

  /**
   * Project-level progress, computed. Never a stored column (D10) — nothing
   * stored means nothing to drift out of step with the site rows.
   */
  async progress(scope: AuthzScope, projectId: string, milestoneId: string) {
    await this.requireProject(scope, projectId);
    const rows = await this.prisma.siteMilestone.findMany({
      where: { milestoneId, site: { AND: [{ projectId }, scopeWhere(scope)] } },
      select: { status: true },
    });
    const achieved = rows.filter((r) => r.status === 'ACHIEVED').length;
    const eligible = rows.filter((r) => r.status === 'ELIGIBLE').length;
    return {
      total: rows.length,
      achieved,
      eligible,
      // NULLIF semantics, in TypeScript: a milestone with no sites is 0, not NaN.
      ratio: rows.length === 0 ? 0 : achieved / rows.length,
    };
  }

  // visibleProject, not a local copy — see the note in TaskTypeService.
  private async requireProject(scope: AuthzScope, id: string): Promise<void> {
    if (!await this.prisma.project.findFirst({ where: visibleProject(scope, id), select: { id: true } })) {
      throw new NotFoundException('Project not found');
    }
  }
}
```

- [ ] **Step 6: Write the integration test and controller**

Create `apps/project/src/milestones/milestone.service.integration.spec.ts` with the
harness preamble from Task 5 Step 6 and
`const service = new MilestoneService(h.prisma)`. Task 15 adds the outbox
parameter and updates this line with it:

```ts
async function completeAll(siteId: string): Promise<void> {
  for (const taskTypeId of [f.foundationId, f.erectId]) {
    await h.prisma.task.create({
      data: {
        id: uuidv7(), projectId: f.projectA, siteId, taskTypeId,
        title: 'done', origin: 'PLANNED', status: 'COMPLETED', createdBy: ACTOR,
      },
    });
  }
}

describe('recomputeForSite', () => {
  it('reports one transition into ELIGIBLE once every requirement is complete', async () => {
    await completeAll(f.siteInA);
    const transitions = await service.recomputeForSite(f.siteInA);
    const eligible = transitions.filter((t) => t.to === 'ELIGIBLE');
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.milestoneId).toBe(f.milestoneInA);
  });

  it('reports nothing on a second run with no task change', async () => {
    // What makes at-least-once delivery safe: the second recomputation is a
    // no-op, so no second project.milestone.eligible is ever emitted.
    await completeAll(f.siteInA);
    await service.recomputeForSite(f.siteInA);
    expect(await service.recomputeForSite(f.siteInA)).toEqual([]);
  });

  it('does not touch a site in another project', async () => {
    await completeAll(f.siteInA);
    await service.recomputeForSite(f.siteInA);
    expect(await h.prisma.siteMilestone.count({ where: { siteId: f.siteInB } })).toBe(0);
  });

  it('stamps eligibleAt once and leaves it alone across a downgrade and recovery', async () => {
    await completeAll(f.siteInA);
    await service.recomputeForSite(f.siteInA);
    const first = await h.prisma.siteMilestone.findFirst({ where: { siteId: f.siteInA } });

    await h.prisma.task.updateMany({ where: { siteId: f.siteInA, taskTypeId: f.erectId }, data: { status: 'RECTIFYING' } });
    await service.recomputeForSite(f.siteInA);
    await h.prisma.task.updateMany({ where: { siteId: f.siteInA, taskTypeId: f.erectId }, data: { status: 'COMPLETED' } });
    await service.recomputeForSite(f.siteInA);

    const again = await h.prisma.siteMilestone.findFirst({ where: { siteId: f.siteInA } });
    // When the site first became deliverable is a fact about the past.
    expect(again?.eligibleAt?.getTime()).toBe(first?.eligibleAt?.getTime());
  });
});

describe('declare', () => {
  async function eligibleRow(): Promise<string> {
    await completeAll(f.siteInA);
    await service.recomputeForSite(f.siteInA);
    const row = await h.prisma.siteMilestone.findFirstOrThrow({ where: { siteId: f.siteInA, milestoneId: f.milestoneInA } });
    return row.id;
  }

  it('records the declarer and the timestamp', async () => {
    const updated = await service.declare(GLOBAL, await eligibleRow(), { note: 'RFI accepted' }, ACTOR);
    expect(updated.status).toBe('ACHIEVED');
    expect(updated.declaredBy).toBe(ACTOR);
    expect(updated.achievedAt).not.toBeNull();
  });

  it('refuses a milestone that is not yet eligible', async () => {
    await service.recomputeForSite(f.siteInA);
    const row = await h.prisma.siteMilestone.findFirstOrThrow({ where: { siteId: f.siteInA } });
    await expect(service.declare(GLOBAL, row.id, { note: 'ship it' }, ACTOR))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a second declaration', async () => {
    const id = await eligibleRow();
    await service.declare(GLOBAL, id, { note: 'RFI accepted' }, ACTOR);
    await expect(service.declare(GLOBAL, id, { note: 'again' }, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a site milestone outside scope', async () => {
    await expect(service.declare(NOTHING, await eligibleRow(), { note: 'x' }, ACTOR))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('survives a completed task being reopened', async () => {
    // Achievement is a formal act, withdrawn explicitly. Recomputation must
    // never quietly undo it because someone sent work back for rework.
    const id = await eligibleRow();
    await service.declare(GLOBAL, id, { note: 'RFI accepted' }, ACTOR);
    await h.prisma.task.updateMany({ where: { siteId: f.siteInA, taskTypeId: f.erectId }, data: { status: 'RECTIFYING' } });
    await service.recomputeForSite(f.siteInA);
    expect((await h.prisma.siteMilestone.findUniqueOrThrow({ where: { id } })).status).toBe('ACHIEVED');
  });
});

describe('progress', () => {
  it('is computed from the site rows, with nothing stored', async () => {
    const thirdSite = uuidv7();
    await h.prisma.site.create({ data: { id: thirdSite, projectId: f.projectA, siteCode: 'KOS333', name: 'Koshi 333' } });
    for (const siteId of [f.siteInA, f.otherSiteInA, thirdSite]) {
      await service.recomputeForSite(siteId);
    }
    await completeAll(f.siteInA);
    await service.recomputeForSite(f.siteInA);
    const row = await h.prisma.siteMilestone.findFirstOrThrow({ where: { siteId: f.siteInA, milestoneId: f.milestoneInA } });
    await service.declare(GLOBAL, row.id, { note: 'RFI accepted' }, ACTOR);

    const progress = await service.progress(GLOBAL, f.projectA, f.milestoneInA);
    expect(progress).toEqual({ total: 3, achieved: 1, eligible: 0, ratio: 1 / 3 });
  });

  it('returns zero rather than NaN for a milestone with no sites', async () => {
    expect((await service.progress(GLOBAL, f.projectB, f.milestoneInB)).ratio).toBe(0);
  });

  it('counts only the sites the caller may see', async () => {
    await completeAll(f.siteInA);
    await service.recomputeForSite(f.siteInA);
    await service.recomputeForSite(f.otherSiteInA);
    expect((await service.progress(onlySite(f.siteInA), f.projectA, f.milestoneInA)).total).toBe(1);
  });
});
```

Create `apps/project/src/milestones/milestone.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzScope, type AuthzUser } from '@ipms/authz';
import { CreateMilestoneSchema, DeclareMilestoneSchema, UuidSchema } from '@ipms/contracts';
import { ScopeOf } from '../http/scope.decorator.js';
import { MilestoneService } from './milestone.service.js';

@Controller()
export class MilestoneController {
  constructor(private readonly service: MilestoneService) {}

  @Post('projects/:id/milestones')
  @RequirePermission('milestone.create')
  create(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown) {
    return this.service.createMilestone(scope, UuidSchema.parse(id), CreateMilestoneSchema.parse(body));
  }

  @Get('projects/:id/milestones/:mid/progress')
  @RequirePermission('milestone.view')
  progress(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Param('mid') mid: string) {
    return this.service.progress(scope, UuidSchema.parse(id), UuidSchema.parse(mid));
  }

  @Get('sites/:id/milestones')
  @RequirePermission('milestone.view')
  listForSite(@ScopeOf() scope: AuthzScope, @Param('id') id: string) {
    return this.service.listForSite(scope, UuidSchema.parse(id));
  }

  @Post('site-milestones/:id/declare')
  @RequirePermission('milestone.declare')
  declare(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.service.declare(scope, UuidSchema.parse(id), DeclareMilestoneSchema.parse(body), req.user.id);
  }
}
```

- [ ] **Step 7: Run the tests and commit**

```bash
pnpm nx run project:test
pnpm nx run-many -t typecheck
git add apps/project/src/milestones
git commit -m "$(cat <<'EOF'
feat(project): milestone recomputation, declaration, and progress

recomputeStatus is pure and total, which is what makes at-least-once event
delivery safe: running it twice is indistinguishable from running it once, so
a redelivered approval cannot double-count.

ELIGIBLE is computed and follows the tasks in both directions. ACHIEVED is
declared and is never downgraded by recomputation -- it is a formal act by an
accountable actor, withdrawn explicitly rather than as a side effect of
someone reopening a task. eligibleAt is stamped on the first crossing and left
alone, so a downgrade and recovery does not rewrite when the site first became
deliverable.

CANCELLED counts as neither progress nor completion. Counting it as either
would make a milestone eligible because someone called the work off.

recomputeForSite returns its transitions rather than publishing them, so the
caller owns the transaction and the outbox write; publishing from inside would
emit project.milestone.eligible before the row was durable.

Project progress is computed, never stored (D10).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: the QC submission consumer

**Files:**
- Create: `apps/project/src/ingest/qc.consumer.ts`
- Test: `apps/project/src/ingest/qc.consumer.integration.spec.ts`

**Interfaces:**
- Consumes: `canTransition` (Task 11), `MilestoneService.recomputeForSite` (Task 13), `OutboxWriter` (Task 15 — until then, publish directly through `EventBus` and switch the call in Task 15).
- Produces: `QcConsumer.register(consumer: DurableConsumer): Promise<void>`, durable `project-qc-tasks`.

- [ ] **Step 1: Write the failing test**

Create `apps/project/src/ingest/qc.consumer.integration.spec.ts`, using the combined
Postgres + NATS preamble from Task 8:

```ts
describe('qc.submission.submitted', () => {
  it('moves the task to REVIEWING and records the submission', async () => {
    await bus.publish(SUBJECTS.QC_SUBMISSION_SUBMITTED, {
      submissionId, taskId, siteId: siteInA, projectId: projectA, attemptNo: 1, submittedBy: ENGINEER,
    });
    await settle();
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.status).toBe('REVIEWING');
    expect(task?.currentSubmissionId).toBe(submissionId);
  }, 60_000);
});

describe('qc.submission.approved', () => {
  it('completes the task and makes its milestone eligible', async () => {
    await bus.publish(SUBJECTS.QC_SUBMISSION_APPROVED, {
      submissionId, taskId, siteId: siteInA, projectId: projectA,
      attemptNo: 1, reviewedBy: REVIEWER, overallVerdict: 'PASS',
    });
    await settle();
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.status).toBe('COMPLETED');
    expect(task?.actualCompletionAt).not.toBeNull();
    const milestone = await prisma.siteMilestone.findFirst({ where: { siteId: siteInA, milestoneId } });
    expect(milestone?.status).toBe('ELIGIBLE');
  }, 60_000);

  it('changes nothing and emits nothing on redelivery', async () => {
    const event = {
      submissionId, taskId, siteId: siteInA, projectId: projectA,
      attemptNo: 1, reviewedBy: REVIEWER, overallVerdict: 'PASS' as const,
    };
    await bus.publish(SUBJECTS.QC_SUBMISSION_APPROVED, event);
    await settle();
    const first = await prisma.task.findUnique({ where: { id: taskId } });
    const eligibleEvents = await countOutbox(SUBJECTS.PROJECT_MILESTONE_ELIGIBLE);

    // A different eventId carrying the same fact: the dedupe store cannot help,
    // so the handler itself has to be idempotent.
    await bus.publish(SUBJECTS.QC_SUBMISSION_APPROVED, event);
    await settle();

    const second = await prisma.task.findUnique({ where: { id: taskId } });
    expect(second?.actualCompletionAt?.getTime()).toBe(first?.actualCompletionAt?.getTime());
    expect(await countOutbox(SUBJECTS.PROJECT_MILESTONE_ELIGIBLE)).toBe(eligibleEvents);
  }, 90_000);

  it('leaves a cancelled task cancelled', async () => {
    // A late approval for work that was called off must not resurrect it.
    await prisma.task.update({ where: { id: taskId }, data: { status: 'CANCELLED' } });
    await bus.publish(SUBJECTS.QC_SUBMISSION_APPROVED, {
      submissionId, taskId, siteId: siteInA, projectId: projectA,
      attemptNo: 1, reviewedBy: REVIEWER, overallVerdict: 'PASS',
    });
    await settle();
    expect((await prisma.task.findUnique({ where: { id: taskId } }))?.status).toBe('CANCELLED');
  }, 60_000);

  it('acks an event naming a task this service does not have', async () => {
    // qc may know about a task project has since deleted, or the two may be
    // rebuilt out of step. Retrying five times and dead-lettering helps nobody.
    await bus.publish(SUBJECTS.QC_SUBMISSION_APPROVED, {
      submissionId: uuidv7(), taskId: uuidv7(), siteId: siteInA, projectId: projectA,
      attemptNo: 1, reviewedBy: REVIEWER, overallVerdict: 'PASS',
    });
    await settle();
    // Nothing thrown, nothing written.
    expect(await prisma.task.count({ where: { status: 'COMPLETED' } })).toBe(0);
  }, 60_000);
});

describe('qc.submission.rejected', () => {
  it('moves the task to RECTIFYING', async () => {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'REVIEWING' } });
    await bus.publish(SUBJECTS.QC_SUBMISSION_REJECTED, {
      submissionId, taskId, siteId: siteInA, projectId: projectA,
      attemptNo: 1, reviewedBy: REVIEWER, reason: 'Photo 3 is out of focus',
    });
    await settle();
    expect((await prisma.task.findUnique({ where: { id: taskId } }))?.status).toBe('RECTIFYING');
  }, 60_000);

  it('downgrades an ELIGIBLE milestone when a completed task is reopened', async () => {
    await bus.publish(SUBJECTS.QC_SUBMISSION_APPROVED, {
      submissionId, taskId, siteId: siteInA, projectId: projectA,
      attemptNo: 1, reviewedBy: REVIEWER, overallVerdict: 'PASS',
    });
    await settle();
    await prisma.task.update({ where: { id: taskId }, data: { status: 'REVIEWING' } });
    await bus.publish(SUBJECTS.QC_SUBMISSION_REJECTED, {
      submissionId, taskId, siteId: siteInA, projectId: projectA,
      attemptNo: 2, reviewedBy: REVIEWER, reason: 'Rework required',
    });
    await settle();
    const milestone = await prisma.siteMilestone.findFirst({ where: { siteId: siteInA, milestoneId } });
    expect(milestone?.status).toBe('IN_PROGRESS');
  }, 90_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm nx run project:test -- qc.consumer.integration
```

Expected: FAIL — `Cannot find module './qc.consumer.js'`.

- [ ] **Step 3: Write the consumer**

Create `apps/project/src/ingest/qc.consumer.ts`:

```ts
import {
  SUBJECTS, type DurableConsumer,
  type QcSubmissionApproved, type QcSubmissionRejected, type QcSubmissionSubmitted,
} from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { PrismaClient } from '@prisma-clients/project';
import type { MilestoneService } from '../milestones/milestone.service.js';
import type { OutboxWriter } from '../outbox/outbox.writer.js';
import { canTransition, type TaskStatus } from '../tasks/transitions.js';

const log = createLogger('project');

export const QC_DURABLE = 'project-qc-tasks';

/**
 * Drives task status from QC's review decisions.
 *
 * Every handler is idempotent in its own right, not only through the dedupe
 * store. Deduplication keys on `eventId`, so it catches a redelivery of the
 * *same* message — but qc can legitimately publish two messages carrying the
 * same fact (a retried publish after a failed ack, a replay after a rebuild),
 * and those have different ids. `canTransition` treating `from === to` as a
 * no-op, plus the no-change early return, is what makes the second one free.
 */
export class QcConsumer {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly milestones: MilestoneService,
    private readonly outbox: OutboxWriter,
  ) {}

  async register(consumer: DurableConsumer): Promise<void> {
    await consumer.subscribe<QcSubmissionSubmitted>(SUBJECTS.QC_SUBMISSION_SUBMITTED, QC_DURABLE, async (e) => {
      await this.moveTo(e.payload.taskId, 'REVIEWING', e.payload.submittedBy, {
        currentSubmissionId: e.payload.submissionId,
      });
    });

    await consumer.subscribe<QcSubmissionApproved>(SUBJECTS.QC_SUBMISSION_APPROVED, QC_DURABLE, async (e) => {
      const moved = await this.moveTo(e.payload.taskId, 'COMPLETED', e.payload.reviewedBy, {
        currentSubmissionId: e.payload.submissionId,
        actualCompletionAt: new Date(),
      });
      if (moved) await this.recompute(e.payload.siteId, e.payload.reviewedBy);
    });

    await consumer.subscribe<QcSubmissionRejected>(SUBJECTS.QC_SUBMISSION_REJECTED, QC_DURABLE, async (e) => {
      const moved = await this.moveTo(e.payload.taskId, 'RECTIFYING', e.payload.reviewedBy, {
        currentSubmissionId: e.payload.submissionId,
      });
      // Reopening completed work can drop a milestone out of ELIGIBLE.
      if (moved) await this.recompute(e.payload.siteId, e.payload.reviewedBy);
    });
  }

  /** Returns true when the task actually changed status. */
  private async moveTo(
    taskId: string,
    to: TaskStatus,
    actorId: string,
    extra: Record<string, unknown>,
  ): Promise<boolean> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { id: true, status: true } });
    if (!task) {
      // qc may know about a task project no longer has, or the two may have
      // been rebuilt out of step. Ack and move on: retrying five times and
      // dead-lettering helps nobody and blocks the durable behind it.
      log.warn({ taskId, to }, 'submission event names an unknown task; acking');
      return false;
    }

    const from = task.status as TaskStatus;
    if (!canTransition(from, to, 'REVIEW')) {
      // Includes the cancelled case: a late approval for work that was called
      // off must not resurrect it.
      log.warn({ taskId, from, to }, 'refusing an invalid review transition; acking');
      return false;
    }
    if (from === to) return false;   // redelivery of a fact already applied

    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { status: to, ...extra } });
      await this.outbox.audit(tx, actorId, `task.${to.toLowerCase()}`, 'Task', taskId, { status: from }, { status: to });
    });
    return true;
  }

  private async recompute(siteId: string, actorId: string): Promise<void> {
    const transitions = await this.milestones.recomputeForSite(siteId);
    for (const transition of transitions) {
      if (transition.to !== 'ELIGIBLE') continue;
      await this.prisma.$transaction(async (tx) => {
        await this.outbox.event(tx, SUBJECTS.PROJECT_MILESTONE_ELIGIBLE, {
          siteMilestoneId: transition.siteMilestoneId,
          milestoneId: transition.milestoneId,
          siteId: transition.siteId,
          projectId: transition.projectId,
          eligibleAt: new Date().toISOString(),
        }, actorId);
      });
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm nx run project:test -- qc.consumer.integration
pnpm nx run-many -t typecheck
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/project/src/ingest
git commit -m "$(cat <<'EOF'
feat(project): drive task status from qc review decisions

Every handler is idempotent in its own right, not only through the dedupe
store. Deduplication keys on eventId, so it catches a redelivery of the same
message -- but qc can legitimately publish two messages carrying the same fact
after a retried publish or a replay, and those carry different ids.
canTransition treating from === to as a no-op, plus the no-change early
return, is what makes the second one free and stops a second
project.milestone.eligible being emitted.

An event naming a task this service does not have is acked, not retried: the
two services can be rebuilt out of step, and dead-lettering blocks the durable
behind it. A late approval for a cancelled task is refused -- work that was
called off must not be resurrected.

Rejection recomputes too, because reopening completed work can drop a
milestone out of ELIGIBLE.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: audit emission through the outbox

Every mutation lands in the ledger, in the same transaction as the change it describes.

**Files:**
- Create: `apps/project/src/outbox/outbox.writer.ts`
- Create: `apps/project/src/outbox/outbox.drainer.ts`
- Test: `apps/project/src/outbox/outbox.drainer.spec.ts`
- Modify: every service from Tasks 9–13 to wrap its mutations

**Interfaces:**
- Consumes: `buildOutboxRecord`, `JsonObject` from `@ipms/persistence`; `EventBus`, `SUBJECTS` from `@ipms/events`; `getCorrelationId` from `@ipms/observability`.
- Produces:
  - `OutboxWriter.event(tx, subject, payload, actorId?)` and `.audit(tx, actorId, action, objectType, objectId, previousState, newState)`
  - `OutboxDrainer` — `OnModuleInit`/`OnModuleDestroy`, polling every 500 ms

- [ ] **Step 1: Write the writer**

Create `apps/project/src/outbox/outbox.writer.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';

/** The transaction-scoped client Prisma hands a `$transaction` callback. */
type Tx = { outboxEvent: { create(args: { data: unknown }): Promise<unknown> } };

/**
 * Writes an event as a row in the same transaction as the change it describes.
 *
 * The point is the atomicity, not the indirection. Publishing to NATS directly
 * from a service method means a crash between the commit and the publish loses
 * the event silently — and for `audit.event.recorded` that is a mutation that
 * happened and was never recorded, which is precisely the hole the ledger
 * exists to close. A row committed with the change cannot be lost; the drainer
 * retries until it is published, and consumers deduplicate on eventId.
 */
@Injectable()
export class OutboxWriter {
  async event(tx: Tx, subject: string, payload: JsonObject, actorId?: string): Promise<void> {
    await tx.outboxEvent.create({
      data: buildOutboxRecord(subject, payload, getCorrelationId() ?? 'unknown', actorId),
    });
  }

  async audit(
    tx: Tx, actorId: string, action: string, objectType: string, objectId: string,
    previousState: JsonObject, newState: JsonObject,
  ): Promise<void> {
    await this.event(tx, SUBJECTS.AUDIT_EVENT, {
      actorId, action, objectType, objectId, previousState, newState, details: {},
    }, actorId);
  }
}
```

- [ ] **Step 2: Write the drainer**

Create `apps/project/src/outbox/outbox.drainer.ts`:

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package.
import type { PrismaClient } from '@prisma-clients/project';
import type { EventBus } from '@ipms/events';
import { createLogger } from '@ipms/observability';

const log = createLogger('project');
const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 100;

@Injectable()
export class OutboxDrainer implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.drain().catch((err: unknown) => log.error({ err }, 'outbox drain failed'));
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const row of pending) {
      try {
        await this.bus.publish(row.subject, row.payload, {
          correlationId: row.correlationId,
          // The row id IS the event id, so a retry after a failed ack
          // deduplicates at the consumer instead of appending the fact twice.
          eventId: row.id,
          ...(row.actorId === null ? {} : { actorId: row.actorId }),
        });
        await this.prisma.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date() } });
      } catch (err) {
        // Leave publishedAt null; the next poll retries. Marking it published
        // regardless would silently drop an audit record — the one thing the
        // ledger must never do.
        log.warn({ err, outboxId: row.id, subject: row.subject }, 'outbox publish failed, will retry');
      }
    }
  }
}
```

- [ ] **Step 3: Write the drainer test**

Create `apps/project/src/outbox/outbox.drainer.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { OutboxDrainer } from './outbox.drainer.js';

function fakePrisma(rows: Array<Record<string, unknown>>) {
  return {
    outboxEvent: {
      async findMany() { return rows.filter((r) => r['publishedAt'] === null); },
      async update({ where, data }: { where: { id: string }; data: { publishedAt: Date } }) {
        const row = rows.find((r) => r['id'] === where.id);
        if (row) row['publishedAt'] = data.publishedAt;
        return row;
      },
    },
  };
}

const row = (id: string) => ({
  id, subject: 'audit.event.recorded', payload: { action: 'project.created' },
  correlationId: 'c-1', actorId: null, createdAt: new Date(), publishedAt: null,
});

describe('OutboxDrainer', () => {
  it('publishes pending rows and marks them published', async () => {
    const rows = [row('r-1'), row('r-2')];
    const bus = { publish: vi.fn().mockResolvedValue(undefined) };
    await new OutboxDrainer(fakePrisma(rows) as never, bus as never).drain();
    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect(rows.every((r) => r['publishedAt'] !== null)).toBe(true);
  });

  it('leaves a row pending when the publish fails', async () => {
    // publishedAt stays null so the next poll retries. Marking it published
    // regardless would silently drop an audit record.
    const rows = [row('r-1')];
    const bus = { publish: vi.fn().mockRejectedValue(new Error('NATS down')) };
    await new OutboxDrainer(fakePrisma(rows) as never, bus as never).drain();
    expect(rows[0]!['publishedAt']).toBeNull();
  });

  it('publishes with the row id as the event id, so a retry deduplicates', async () => {
    const rows = [row('r-1')];
    const bus = { publish: vi.fn().mockResolvedValue(undefined) };
    await new OutboxDrainer(fakePrisma(rows) as never, bus as never).drain();
    expect(bus.publish).toHaveBeenCalledWith(
      'audit.event.recorded', { action: 'project.created' },
      expect.objectContaining({ eventId: 'r-1' }),
    );
  });
});
```

- [ ] **Step 4: Wrap every mutation**

Every service constructor gains `private readonly outbox: OutboxWriter` as its last
parameter — `ProjectService(prisma, outbox)`, `TaskTypeService(prisma, outbox)`,
`MilestoneService(prisma, outbox)`, `TaskService(prisma, taskTypes, outbox)`,
`GenerationService(prisma, taskTypes, outbox)`. Task 16's module registers them with
exactly those argument orders, so they must match.

Each mutation below becomes a `$transaction` that writes the change and its audit row
together. The action names are fixed here so the ledger has a stable vocabulary:

| Service method | Action | Object |
|---|---|---|
| `ProjectService.createProject` | `project.created` | `Project` |
| `ProjectService.updateProject` | `project.updated` | `Project` |
| `ProjectService.createSite` | `site.created` | `Site` |
| `TaskTypeService.createTaskType` | `task_type.created` | `TaskType` |
| `TaskTypeService.addDependency` | `task_type.dependency_added` | `TaskType` |
| `TaskTypeService.mapTemplate` | `task_type.template_mapped` | `TaskType` |
| `MilestoneService.createMilestone` | `milestone.created` | `Milestone` |
| `MilestoneService.declare` | `milestone.achieved` | `SiteMilestone` |
| `TaskService.createTask` | `task.created` | `Task` |
| `TaskService.updateTask` | `task.updated` | `Task` |
| `TaskService.assignTask` | `task.assigned` | `Task` |
| `TaskService.cancelTask` | `task.cancelled` | `Task` |
| `GenerationService.generate` | `task.generated` | `Milestone` |

`updateProject`, `updateTask`, `assignTask` and `declare` pass the pre-image they
already read as `previousState`. `generate` records `{ created, skipped: skipped.length }`
as `newState` — one ledger entry per run, not per task, because the run is the
accountable act.

`MilestoneService.declare` additionally publishes `PROJECT_MILESTONE_ACHIEVED`, and
`TaskService.createTask` / `.assignTask` publish `PROJECT_TASK_CREATED` /
`PROJECT_TASK_ASSIGNED`, through `OutboxWriter.event` in the same transaction.

- [ ] **Step 5: Run everything and commit**

```bash
pnpm nx run project:test
pnpm nx run-many -t lint typecheck test
git add apps/project
git commit -m "$(cat <<'EOF'
feat(project): write every mutation to the audit ledger through an outbox

The row is committed in the same transaction as the change it describes.
Publishing to NATS directly from a service method loses the event when the
process dies between the commit and the publish -- and for
audit.event.recorded that is a mutation that happened and was never recorded,
exactly the hole the ledger exists to close.

The drainer leaves publishedAt null on a failed publish so the next poll
retries, and publishes with the row id as the eventId so a retry deduplicates
at the consumer rather than appending the same fact twice.

Bulk generation writes one ledger entry per run, not per task: the run is the
accountable act, and six hundred rows would bury it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: the access simulator seam, and bootstrap

**Files:**
- Create: `apps/project/src/internal/explain.controller.ts`
- Test: `apps/project/src/internal/explain.controller.spec.ts`
- Rewrite: `apps/project/src/app.module.ts`, `apps/project/src/main.ts`
- Modify: `docker/docker-compose.yml` — a healthcheck for `project`

**Interfaces:**
- Consumes: everything built so far.
- Produces: `POST /internal/authz/explain` returning `AuthzDecision`; a bootable service.

- [ ] **Step 1: Write the failing test**

Create `apps/project/src/internal/explain.controller.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ExplainController } from './explain.controller.js';

const USER = '01930000-0000-7000-8000-0000000000aa';
const PROJECT_A = '01930000-0000-7000-8000-00000000a001';
const PROJECT_B = '01930000-0000-7000-8000-00000000a002';

function build(overrides: { scope?: unknown; task?: unknown; user?: unknown } = {}) {
  const prisma = {
    task: { async findUnique() { return overrides.task ?? null; } },
    project: { async findUnique() { return { id: PROJECT_A }; } },
    site: { async findUnique() { return null; } },
    siteMilestone: { async findUnique() { return null; } },
  };
  const users = {
    async load() {
      return overrides.user ?? { id: USER, roles: ['PROJECT_MANAGER'], permissions: ['task.update'], tokenVersion: 1, isActive: true };
    },
  };
  const scopes = { async for() { return overrides.scope ?? { global: false, projectIds: [PROJECT_A], siteIds: [] }; } };
  return new ExplainController(prisma as never, scopes as never, users as never);
}

describe('POST /internal/authz/explain', () => {
  it('allows a held permission with no resource', async () => {
    const decision = await build().explain({ userId: USER, permission: 'task.update' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ALLOWED');
  });

  it('reports the missing permission by name', async () => {
    const decision = await build().explain({ userId: USER, permission: 'task.generate' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PERMISSION_MISSING');
  });

  it('reports out-of-scope for a resource in another project', async () => {
    const decision = await build({
      task: { id: 't-1', projectId: PROJECT_B, siteId: null, assigneeId: null, status: 'ONGOING' },
    }).explain({ userId: USER, permission: 'task.update', resourceType: 'Task', resourceId: 't-1' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('OUT_OF_PROJECT_SCOPE');
  });

  it('returns RESOURCE_NOT_EVALUATED rather than the unscoped answer', async () => {
    // The caller asked about a specific resource. Answering the broader
    // question instead would hand them a permissive verdict to a question they
    // did not ask -- which is exactly what the simulator must never do.
    const decision = await build({ task: null })
      .explain({ userId: USER, permission: 'task.update', resourceType: 'Task', resourceId: 'missing' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('RESOURCE_NOT_EVALUATED');
  });

  it('returns the check chain, not just a verdict', async () => {
    const decision = await build().explain({ userId: USER, permission: 'task.update' });
    expect(decision.checks.map((c) => c.name)).toContain('permission_held');
    expect(decision.checks.every((c) => typeof c.passed === 'boolean')).toBe(true);
  });

  it('denies an inactive user before anything else', async () => {
    const decision = await build({
      user: { id: USER, roles: [], permissions: ['task.update'], tokenVersion: 1, isActive: false },
    }).explain({ userId: USER, permission: 'task.update' });
    expect(decision.reason).toBe('USER_INACTIVE');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm nx run project:test -- explain.controller
```

Expected: FAIL — `Cannot find module './explain.controller.js'`.

- [ ] **Step 3: Write the controller**

Create `apps/project/src/internal/explain.controller.ts`:

```ts
import { Body, Controller, Inject, Post } from '@nestjs/common';
import { check, type AuthzDecision, type AuthzResource, type AuthzUser, type ScopeProvider } from '@ipms/authz';
import { ExplainRequestSchema, type ExplainRequestDto } from '@ipms/contracts';
import { SCOPE_PROVIDER } from '@ipms/authz';
import type { PrismaClient } from '@prisma-clients/project';

/** Loads the subject's claims. In the stack this is a call to iam's effective-permissions API. */
export interface UserLoader {
  load(userId: string): Promise<AuthzUser | null>;
}

export const USER_LOADER = Symbol('USER_LOADER');
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

/**
 * The access simulator's view into this service.
 *
 * It calls the *same* `check()` the guard calls, with the same scope provider
 * and the same resource shape. That is the whole point: a simulator that
 * reimplemented the rules would drift from enforcement, and the drift would be
 * invisible until someone trusted a "would be allowed" that was wrong.
 *
 * Unreachable through the gateway — `resolveUpstream` refuses any path
 * containing `/internal/`, so this is service-to-service only.
 */
@Controller('internal/authz')
export class ExplainController {
  constructor(
    // `@Inject` on all three, and `PRISMA_CLIENT` rather than the class. Nest
    // resolves controller parameters by `design:paramtypes` reflection, and
    // `PrismaClient` arrives here as an `import type` — TypeScript erases it,
    // the emitted metadata says `Object`, and bootstrap fails on an
    // unresolvable token. The class is not a provider either; `PrismaService`
    // is, and it wraps the client.
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(SCOPE_PROVIDER) private readonly scopes: ScopeProvider,
    @Inject(USER_LOADER) private readonly users: UserLoader,
  ) {}

  @Post('explain')
  async explain(@Body() body: unknown): Promise<AuthzDecision> {
    const dto: ExplainRequestDto = ExplainRequestSchema.parse(body);

    const user = await this.users.load(dto.userId);
    if (!user) {
      return { allowed: false, reason: 'USER_INACTIVE', checks: [{ name: 'account_active', passed: false, detail: 'Unknown user' }] };
    }

    const scope = await this.scopes.for(dto.userId);

    if (dto.resourceId === undefined) {
      return check({ user, permission: dto.permission, scope });
    }

    const resource = await this.loadResource(dto.resourceType as string, dto.resourceId);
    if (!resource) {
      // Not the unscoped answer. The caller asked about a specific resource;
      // returning the broader verdict would report "allowed" for a question
      // they did not ask.
      return {
        allowed: false,
        reason: 'RESOURCE_NOT_EVALUATED',
        checks: [{ name: 'resource_loaded', passed: false, detail: `${dto.resourceType} ${dto.resourceId} not found in project` }],
      };
    }

    return check({ user, permission: dto.permission, scope, resource });
  }

  private async loadResource(type: string, id: string): Promise<AuthzResource | null> {
    switch (type) {
      case 'Project': {
        const row = await this.prisma.project.findUnique({ where: { id }, select: { id: true } });
        return row ? { type, id: row.id, projectId: row.id } : null;
      }
      case 'Site': {
        const row = await this.prisma.site.findUnique({ where: { id }, select: { id: true, projectId: true } });
        return row ? { type, id: row.id, projectId: row.projectId, siteId: row.id } : null;
      }
      case 'Task': {
        const row = await this.prisma.task.findUnique({
          where: { id }, select: { id: true, projectId: true, siteId: true, assigneeId: true, status: true },
        });
        return row
          ? {
              type, id: row.id, projectId: row.projectId, siteId: row.siteId,
              ...(row.assigneeId === null ? {} : { assigneeId: row.assigneeId }),
              state: row.status,
            }
          : null;
      }
      case 'SiteMilestone': {
        const row = await this.prisma.siteMilestone.findUnique({
          where: { id }, include: { site: { select: { projectId: true } } },
        });
        return row ? { type, id: row.id, projectId: row.site.projectId, siteId: row.siteId, state: row.status } : null;
      }
      default:
        return null;
    }
  }
}
```

- [ ] **Step 4: Wire the module**

Replace `apps/project/src/app.module.ts`. Note every domain service is registered
through a factory with an explicit `inject` list — their constructors take
`PrismaClient` as an `import type`, which TypeScript erases, and a bare class entry
fails at bootstrap with an unresolvable token. This is the trap `apps/iam/src/app.module.ts`
documents at length; do not "simplify" these entries.

```ts
import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Redis } from 'ioredis';
import { AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider } from '@ipms/authz';
import { DurableConsumer, EventBus, RedisDedupeStore } from '@ipms/events';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { PrismaService } from './prisma.service.js';
import { UserScopeRepository } from './scope/user-scope.repository.js';
import { projectScopeProvider } from './scope/scope.provider.js';
import { ScopeConsumer } from './scope/scope.consumer.js';
import { ensureProjectionReplay } from './scope/replay.js';
import { ProjectController } from './project/project.controller.js';
import { ProjectService } from './project/project.service.js';
import { TaskTypeController } from './task-types/task-type.controller.js';
import { TaskTypeService } from './task-types/task-type.service.js';
import { TaskController } from './tasks/task.controller.js';
import { TaskService } from './tasks/task.service.js';
import { GenerationController } from './tasks/generation.controller.js';
import { GenerationService } from './tasks/generation.service.js';
import { MilestoneController } from './milestones/milestone.controller.js';
import { MilestoneService } from './milestones/milestone.service.js';
import { QcConsumer } from './ingest/qc.consumer.js';
import { OutboxWriter } from './outbox/outbox.writer.js';
import { OutboxDrainer } from './outbox/outbox.drainer.js';
import { ExplainController, PRISMA_CLIENT, USER_LOADER, type UserLoader } from './internal/explain.controller.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Starts both durables once the module is up, after rebuilding the scope
 * projection if it has been lost.
 *
 * Ordering matters: the replay must run *before* the scope consumer
 * subscribes, because it works by deleting the durable so the subscribe that
 * follows recreates it and replays from the start.
 */
class ConsumerBootstrap implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly prisma: PrismaService,
    private readonly scopes: UserScopeRepository,
    private readonly scopeConsumer: ScopeConsumer,
    private readonly qcConsumer: QcConsumer,
  ) {}

  async onModuleInit(): Promise<void> {
    await ensureProjectionReplay(this.bus, this.prisma.db, this.scopes);
    const dedupe = new RedisDedupeStore(new Redis(requireEnv('REDIS_URL')));
    const consumer = new DurableConsumer(this.bus, dedupe);
    await this.scopeConsumer.register(consumer);
    await this.qcConsumer.register(consumer);
  }
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    ProjectController, TaskTypeController, TaskController, GenerationController,
    MilestoneController, ExplainController, HealthController, MetricsController,
  ],
  providers: [
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
    {
      provide: EventBus,
      useFactory: async (): Promise<EventBus> => {
        const bus = new EventBus();
        await bus.connect(requireEnv('NATS_URL'));
        await bus.ensureStreams();
        registerReadinessCheck('nats', () => bus.isHealthy());
        return bus;
      },
    },
    OutboxWriter,
    {
      // Controllers cannot be given `PrismaService.db` by class, because the
      // client type is erased. This token is how ExplainController reaches it.
      provide: PRISMA_CLIENT,
      useFactory: (prisma: PrismaService) => prisma.db,
      inject: [PrismaService],
    },
    {
      provide: UserScopeRepository,
      useFactory: (prisma: PrismaService) => new UserScopeRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: SCOPE_PROVIDER,
      useFactory: (repo: UserScopeRepository) => projectScopeProvider(repo),
      inject: [UserScopeRepository],
    },
    // project/site-scoped overrides are replicated in a later sub-project;
    // global ones are already folded into the JWT permissions claim, so this
    // enforces global suspensions correctly today. See @ipms/authz.
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: USER_LOADER,
      useFactory: (): UserLoader => ({
        async load(userId: string) {
          const base = requireEnv('IAM_INTERNAL_URL');
          const response = await fetch(`${base}/internal/users/${userId}/effective`);
          if (!response.ok) return null;
          const body = await response.json() as { user: AuthzUser };
          return body.user;
        },
      }),
    },
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    {
      provide: ProjectService,
      useFactory: (prisma: PrismaService, outbox: OutboxWriter) => new ProjectService(prisma.db, outbox),
      inject: [PrismaService, OutboxWriter],
    },
    {
      provide: TaskTypeService,
      useFactory: (prisma: PrismaService, outbox: OutboxWriter) => new TaskTypeService(prisma.db, outbox),
      inject: [PrismaService, OutboxWriter],
    },
    {
      provide: MilestoneService,
      useFactory: (prisma: PrismaService, outbox: OutboxWriter) => new MilestoneService(prisma.db, outbox),
      inject: [PrismaService, OutboxWriter],
    },
    {
      provide: TaskService,
      useFactory: (prisma: PrismaService, types: TaskTypeService, outbox: OutboxWriter) =>
        new TaskService(prisma.db, types, outbox),
      inject: [PrismaService, TaskTypeService, OutboxWriter],
    },
    {
      provide: GenerationService,
      useFactory: (prisma: PrismaService, types: TaskTypeService, outbox: OutboxWriter) =>
        new GenerationService(prisma.db, types, outbox),
      inject: [PrismaService, TaskTypeService, OutboxWriter],
    },
    {
      provide: ScopeConsumer,
      useFactory: (repo: UserScopeRepository) => new ScopeConsumer(repo),
      inject: [UserScopeRepository],
    },
    {
      provide: QcConsumer,
      useFactory: (prisma: PrismaService, milestones: MilestoneService, outbox: OutboxWriter) =>
        new QcConsumer(prisma.db, milestones, outbox),
      inject: [PrismaService, MilestoneService, OutboxWriter],
    },
    {
      provide: OutboxDrainer,
      useFactory: (prisma: PrismaService, bus: EventBus) => new OutboxDrainer(prisma.db, bus),
      inject: [PrismaService, EventBus],
    },
    {
      provide: ConsumerBootstrap,
      useFactory: (
        bus: EventBus, prisma: PrismaService, repo: UserScopeRepository,
        scopeConsumer: ScopeConsumer, qcConsumer: QcConsumer,
      ) => new ConsumerBootstrap(bus, prisma, repo, scopeConsumer, qcConsumer),
      inject: [EventBus, PrismaService, UserScopeRepository, ScopeConsumer, QcConsumer],
    },
  ],
})
export class AppModule {}
```

Also create `apps/project/src/tasks/generation.controller.ts`:

```ts
import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzScope, type AuthzUser } from '@ipms/authz';
import { GenerateScopeSchema, UuidSchema } from '@ipms/contracts';
import { ScopeOf } from '../http/scope.decorator.js';
import { GenerationService } from './generation.service.js';

@Controller()
export class GenerationController {
  constructor(private readonly service: GenerationService) {}

  @Post('projects/:id/milestones/:mid/generate')
  @RequirePermission('task.generate')
  generate(
    @ScopeOf() scope: AuthzScope, @Param('id') id: string, @Param('mid') mid: string,
    @Body() body: unknown, @Req() req: { user: AuthzUser },
  ) {
    return this.service.generate(
      scope, UuidSchema.parse(id), UuidSchema.parse(mid), GenerateScopeSchema.parse(body), req.user.id,
    );
  }
}
```

- [ ] **Step 5: Write a bootstrap test**

Create `apps/project/src/app.module.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { APP_GUARD } from '@nestjs/core';
import { AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER } from '@ipms/authz';
import { AppModule } from './app.module.js';

interface Provider {
  provide: unknown;
  useClass?: unknown;
  useFactory?: unknown;
  useValue?: unknown;
  inject?: unknown[];
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'object' && value !== null && 'provide' in value;
}

/**
 * Reads the module's own `@Module()` metadata rather than booting it, because
 * every factory here dials Postgres, NATS or Redis. Same approach as
 * apps/iam/src/app.module.spec.ts.
 */
const reflectMetadata = Reflect as unknown as { getMetadata(key: string, target: object): unknown };

describe('AppModule', () => {
  const providers = (reflectMetadata.getMetadata('providers', AppModule) as unknown[]).filter(isProvider);

  it('registers JwtUserGuard before AuthzGuard, so request.user exists when AuthzGuard reads it', () => {
    const guards = providers.filter((p) => p.provide === APP_GUARD);
    expect(guards[0]?.useClass).toBe(JwtUserGuard);
    expect(guards[1]?.useClass).toBe(AuthzGuard);
  });

  it('backs SCOPE_PROVIDER with a factory over the projection, not a stub', () => {
    // A stub here boots fine and silently disables the platform's actual
    // authorization boundary -- every query would run unconstrained. iam can
    // afford a constant because it passes no resource to check(); project
    // cannot.
    const provider = providers.find((p) => p.provide === SCOPE_PROVIDER);
    expect(typeof provider?.useFactory).toBe('function');
    expect(provider?.inject).toBeDefined();
  });

  it('provides OVERRIDE_PROVIDER, without which AuthzGuard cannot be constructed', () => {
    expect(providers.some((p) => p.provide === OVERRIDE_PROVIDER)).toBe(true);
  });

  it('gives every factory provider an inject list', () => {
    // The trap this whole module is written around: a constructor parameter
    // typed with `import type` is erased, emitDecoratorMetadata records
    // `Object`, and Nest fails at bootstrap on an unresolvable token. A factory
    // without an explicit inject list gets called with no arguments, which
    // fails the same way -- and no unit test that constructs the service
    // directly can see it.
    for (const provider of providers) {
      if (typeof provider.useFactory !== 'function') continue;
      if (provider.useFactory.length === 0) continue;
      expect(provider.inject, String(String(provider.provide))).toHaveLength(provider.useFactory.length);
    }
  });
});
```

- [ ] **Step 6: Give `project` a healthcheck in Compose**

In `docker/docker-compose.yml`, add to the `project` service, and change the gateway's
`depends_on` entry for `project` from `service_started` to `service_healthy`:

```yaml
    environment:
      <<: *service-env
      PORT: 3004
      PROJECT_DATABASE_URL: postgresql://ipms_project:ipms_project@postgres:5432/ipms_project
      IAM_INTERNAL_URL: http://iam:3001
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3004/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

- [ ] **Step 7: Bring the stack up and verify**

```bash
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml ps
```

Expected: every service healthy, and only `gateway` publishing a port. Then:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/projects
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/internal/authz/explain
```

Expected: `401` for the first — authentication is required, and the route exists. `404`
for the second — `/internal/` is refused at the edge.

- [ ] **Step 8: Commit**

```bash
git add apps/project docker
git commit -m "$(cat <<'EOF'
feat(project): access simulator seam and service bootstrap

/internal/authz/explain calls the same check() the guard calls, with the same
scope provider and the same resource shape. A simulator that reimplemented the
rules would drift from enforcement, and the drift would stay invisible until
someone trusted a "would be allowed" that was wrong.

A resource the caller named but that cannot be loaded returns
RESOURCE_NOT_EVALUATED rather than the unscoped verdict. Falling back to the
broader question would report "allowed" for a question they did not ask.

Bootstrap runs the projection replay before the scope consumer subscribes --
the replay works by deleting the durable so the subscribe recreates it, so the
order is load-bearing.

Every domain service is registered through a factory with an explicit inject
list. Their constructors take PrismaClient as an import type, which TypeScript
erases; a bare class entry fails at bootstrap with an unresolvable token, and
no unit test that constructs the service directly can catch it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: the security suite

The most valuable tests in this sub-project. Every one of them fails against the spike.

**Files:**
- Create: `apps/project/src/security.integration.spec.ts`

**Interfaces:**
- Consumes: every service. Asserts against them directly, with hand-built `AuthzScope`
  values, so a failure names the boundary that broke rather than an HTTP status.

- [ ] **Step 1: Write the suite**

Create `apps/project/src/security.integration.spec.ts` with the harness preamble from
Task 5 Step 6. `seed()` already provides the two projects every scoping assertion needs;
create one task and one site-milestone in each project in `beforeEach`. Then:

```ts
describe('IDOR — read by id', () => {
  it.each([
    ['project', () => projects.getProject(onlyA(), projectB)],
    ['site list', () => projects.listSites(onlyA(), projectB)],
    ['task', () => tasks.getTask(onlyA(), taskInB)],
    ['site milestones', () => milestones.listForSite(onlyA(), siteInB)],
    ['milestone progress', () => milestones.progress(onlyA(), projectB, milestoneInB)],
  ])('refuses a %s in another project with 404, not 403', async (_label, call) => {
    // 404 and not 403 throughout: a 403 confirms the id names something real,
    // which is what an enumeration attack is looking for.
    await expect(call()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('IDOR — write by id', () => {
  it.each([
    ['update a project', () => projects.updateProject(onlyA(), projectB, { name: 'x' }, ATTACKER)],
    ['create a site', () => projects.createSite(onlyA(), projectB, { siteCode: 'X1', name: 'x' }, ATTACKER)],
    ['assign a task', () => tasks.assignTask(onlyA(), taskInB, { assigneeId: ATTACKER }, ATTACKER)],
    ['cancel a task', () => tasks.cancelTask(onlyA(), taskInB, ATTACKER)],
    ['add a dependency', () => taskTypes.addDependency(onlyA(), taskTypeInB, { prerequisiteTaskTypeId: otherTaskTypeInB })],
    ['declare a milestone', () => milestones.declare(onlyA(), siteMilestoneInB, { note: 'x' }, ATTACKER)],
    ['generate scope', () => generation.generate(onlyA(), projectB, milestoneInB, { siteIds: [] }, ATTACKER)],
  ])('refuses to %s in another project', async (_label, call) => {
    await expect(call()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('scope escalation', () => {
  it('cannot reach project B by naming its site in a project-A request', async () => {
    await expect(
      tasks.createTask(onlyA(), projectA, { siteId: siteInB, taskTypeId: taskTypeInA, title: 'x', origin: 'AD_HOC' }, ATTACKER),
    ).rejects.toThrow();
  });

  it('cannot generate outside scope by passing explicit site ids', async () => {
    // The siteIds parameter is a filter, never a widener. Intersecting it with
    // scope rather than trusting it is the whole difference.
    const report = await generation.generate(onlySite(siteInA), projectA, milestoneInA, { siteIds: [siteInA, otherSiteInA] }, ATTACKER);
    expect(await prisma.task.count({ where: { siteId: otherSiteInA } })).toBe(0);
    expect(report.created).toBeGreaterThan(0);
  });

  it('cannot borrow another project\'s task type as a prerequisite', async () => {
    await expect(
      taskTypes.addDependency(GLOBAL, taskTypeInA, { prerequisiteTaskTypeId: taskTypeInB }),
    ).rejects.toThrow(/same project/i);
  });
});

describe('an empty projection denies', () => {
  it('shows nothing to a user with no replicated scope', async () => {
    // The cold-start case. It must read as "no access", never as "no filter".
    expect(await projects.listProjects(NOTHING)).toEqual([]);
    expect(await tasks.listTasks(NOTHING, {})).toEqual([]);
    await expect(projects.getProject(NOTHING, projectA)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('evidence-free completion', () => {
  it('cannot be reached through the HTTP surface', async () => {
    // The single most valuable assertion here: no API path marks work complete
    // without an approved submission.
    await expect(tasks.updateTask(GLOBAL, taskInA, { status: 'COMPLETED' }, ATTACKER))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('cannot be reached by declaring a milestone that is not eligible', async () => {
    await expect(milestones.declare(GLOBAL, siteMilestoneInA, { note: 'ship it' }, ATTACKER))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: Run it**

```bash
pnpm nx run project:test -- security.integration
```

Expected: PASS, 18 assertions. Any failure is a real hole — fix the service, never the test.

- [ ] **Step 3: Commit**

```bash
git add apps/project/src/security.integration.spec.ts
git commit -m "$(cat <<'EOF'
test(project): IDOR and scope-escalation suite

Every assertion here fails against the spike in 033af6c, which is the point.

404 and not 403 throughout: a 403 confirms the id names something real, which
is exactly what an enumeration attack is looking for.

Two escalation paths are pinned specifically. The siteIds parameter on bulk
generation is a filter and never a widener -- it is intersected with scope
rather than trusted. And no HTTP path marks a task COMPLETED or declares a
milestone achieved without the evidence that earns it, which is the single
claim the whole QC pipeline exists to protect.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: end-to-end critical path

**Files:**
- Create: `e2e/project-tracking.e2e.spec.ts`
- Modify: `e2e/helpers/stack.ts` if it hardcodes the service list

**Interfaces:**
- Consumes: the running Compose stack, through `http://localhost:3000` only.

- [ ] **Step 1: Write the E2E test**

Create `e2e/project-tracking.e2e.spec.ts`, following the structure of
`e2e/foundation.e2e.spec.ts`. It drives the gateway alone — no direct service calls:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { connect, JSONCodec, type NatsConnection } from 'nats';

const GATEWAY = process.env['GATEWAY_URL'] ?? 'http://localhost:3000';
const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';
// No default, matching the seed: IAM_DEMO_PASSWORD has none either, so that a
// known SUPER_ADMIN credential never sits in the repository.
const DEMO_PASSWORD = process.env['IAM_DEMO_PASSWORD'];
if (!DEMO_PASSWORD) throw new Error('IAM_DEMO_PASSWORD is not set; the seed needs it too');
const codec = JSONCodec();

let adminToken: string;
let nats: NatsConnection;
const ids: Record<string, string> = {};

async function api(
  path: string, init: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${GATEWAY}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

/**
 * Stands in for sub-project 3's producer, publishing against the contract
 * fixed in @ipms/events. This is the payoff for declaring that contract before
 * the producer existed: the critical path is demonstrable with qc unwritten.
 */
async function publishApproval(taskId: string, siteId: string, projectId: string): Promise<void> {
  await nats.publish('qc.submission.approved', codec.encode({
    eventId: crypto.randomUUID(),
    subject: 'qc.submission.approved',
    occurredAt: new Date().toISOString(),
    version: 1,
    correlationId: crypto.randomUUID(),
    actorId: null,
    payload: {
      submissionId: crypto.randomUUID(), taskId, siteId, projectId,
      attemptNo: 1, reviewedBy: ids['adminId'], overallVerdict: 'PASS',
    },
  }));
}

async function eventually<T>(read: () => Promise<T>, until: (value: T) => boolean, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (until(value)) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the expected state');
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

beforeAll(async () => {
  nats = await connect({ servers: NATS_URL });
  const login = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: DEMO_PASSWORD } });
  expect(login.status).toBe(200);
  adminToken = login.body.accessToken;
  const me = await api('/auth/me', { token: adminToken });
  ids['adminId'] = me.body.id;
}, 60_000);

describe('critical path: generate → block → approve → eligible → declare', () => {
  it('creates the project scaffold', async () => {
    const project = await api('/projects', {
      method: 'POST', token: adminToken,
      body: { code: `E2E${Date.now()}`, name: 'E2E Project' },
    });
    expect(project.status).toBe(201);
    ids['project'] = project.body.id;

    for (const [key, code, variant] of [['siteA', 'E2E121', 'RRU Only'], ['siteB', 'E2E232', null]] as const) {
      const site = await api(`/projects/${ids['project']}/sites`, {
        method: 'POST', token: adminToken,
        body: { siteCode: code, name: code, ...(variant === null ? {} : { scopeVariant: variant }) },
      });
      expect(site.status).toBe(201);
      ids[key] = site.body.id;
    }

    ids['defaultTemplate'] = crypto.randomUUID();
    ids['rruTemplate'] = crypto.randomUUID();
    for (const [key, code] of [['foundation', 'FOUNDATION'], ['erect', 'ERECT']] as const) {
      const taskType = await api(`/projects/${ids['project']}/task-types`, {
        method: 'POST', token: adminToken,
        body: { code, name: code, category: 'QUALITY', templateId: ids['defaultTemplate'] },
      });
      expect(taskType.status).toBe(201);
      ids[key] = taskType.body.id;
    }

    expect((await api(`/task-types/${ids['erect']}/dependencies`, {
      method: 'POST', token: adminToken, body: { prerequisiteTaskTypeId: ids['foundation'] },
    })).status).toBe(201);

    expect((await api(`/task-types/${ids['erect']}/templates`, {
      method: 'POST', token: adminToken, body: { scopeVariant: 'RRU Only', templateId: ids['rruTemplate'] },
    })).status).toBe(201);

    const milestone = await api(`/projects/${ids['project']}/milestones`, {
      method: 'POST', token: adminToken,
      body: { code: 'CW_RFI', name: 'CW RFI', kind: 'PROJECT', sequence: 1, taskTypeIds: [ids['foundation'], ids['erect']] },
    });
    expect(milestone.status).toBe(201);
    ids['milestone'] = milestone.body.id;
  }, 60_000);

  it('generates four tasks, resolving each site\'s variant to its own template', async () => {
    const report = await api(`/projects/${ids['project']}/milestones/${ids['milestone']}/generate`, {
      method: 'POST', token: adminToken, body: {},
    });
    expect(report.status).toBe(201);
    expect(report.body.created).toBe(4);

    const tasks = await api(`/tasks?projectId=${ids['project']}`, { token: adminToken });
    const erectOnA = tasks.body.find((t: any) => t.siteId === ids['siteA'] && t.taskTypeId === ids['erect']);
    const erectOnB = tasks.body.find((t: any) => t.siteId === ids['siteB'] && t.taskTypeId === ids['erect']);
    expect(erectOnA.templateId).toBe(ids['rruTemplate']);
    expect(erectOnB.templateId).toBe(ids['defaultTemplate']);
    ids['erectTask'] = erectOnA.id;
    ids['foundationTask'] = tasks.body.find(
      (t: any) => t.siteId === ids['siteA'] && t.taskTypeId === ids['foundation'],
    ).id;
  }, 60_000);

  it('creates nothing on a second generation', async () => {
    const report = await api(`/projects/${ids['project']}/milestones/${ids['milestone']}/generate`, {
      method: 'POST', token: adminToken, body: {},
    });
    expect(report.body.created).toBe(0);
    const tasks = await api(`/tasks?projectId=${ids['project']}`, { token: adminToken });
    expect(tasks.body).toHaveLength(4);
  }, 60_000);

  it('refuses to start the blocked task, and names what blocks it', async () => {
    const refused = await api(`/tasks/${ids['erectTask']}`, {
      method: 'PATCH', token: adminToken, body: { status: 'ONGOING' },
    });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('FOUNDATION');
  });

  it('completes the prerequisite through the qc contract and unblocks erection', async () => {
    await publishApproval(ids['foundationTask'], ids['siteA'], ids['project']);
    await eventually(
      async () => (await api(`/tasks/${ids['foundationTask']}`, { token: adminToken })).body,
      (task) => task.status === 'COMPLETED',
    );
    const started = await api(`/tasks/${ids['erectTask']}`, {
      method: 'PATCH', token: adminToken, body: { status: 'ONGOING' },
    });
    expect(started.status).toBe(200);
  }, 60_000);

  it('makes the site milestone eligible once every requirement is approved', async () => {
    await publishApproval(ids['erectTask'], ids['siteA'], ids['project']);
    const rows = await eventually(
      async () => (await api(`/sites/${ids['siteA']}/milestones`, { token: adminToken })).body,
      (list) => list.some((row: any) => row.status === 'ELIGIBLE'),
    );
    ids['siteMilestone'] = rows.find((row: any) => row.status === 'ELIGIBLE').id;
  }, 60_000);

  it('records the declaration with an accountable actor', async () => {
    const declared = await api(`/site-milestones/${ids['siteMilestone']}/declare`, {
      method: 'POST', token: adminToken, body: { note: 'RFI accepted by client' },
    });
    expect(declared.status).toBe(201);
    expect(declared.body.status).toBe('ACHIEVED');
    expect(declared.body.declaredBy).toBe(ids['adminId']);
    expect(declared.body.achievedAt).not.toBeNull();
  });

  it('computes project progress from the site rows', async () => {
    const progress = await api(
      `/projects/${ids['project']}/milestones/${ids['milestone']}/progress`, { token: adminToken },
    );
    expect(progress.body).toMatchObject({ total: 2, achieved: 1 });
  });

  it('leaves the audit chain intact, carrying every step', async () => {
    const verify = await eventually(
      async () => (await api('/audit/verify', { token: adminToken })).body,
      (body) => body.intact === true,
    );
    expect(verify.intact).toBe(true);

    const ledger = await api('/audit/events?limit=200', { token: adminToken });
    const actions = new Set(ledger.body.items.map((e: any) => e.action));
    for (const action of ['project.created', 'site.created', 'task.generated', 'task.completed', 'milestone.achieved']) {
      expect(actions, action).toContain(action);
    }
  }, 60_000);
});

describe('an unscoped user sees nothing', () => {
  it('returns an empty list and refuses generation', async () => {
    // The seeded FIELD_ENGINEER holds task.view but no scope grant. Query-level
    // enforcement is the only thing standing between them and every project.
    const login = await api('/auth/login', { method: 'POST', body: { username: 'engineer', password: DEMO_PASSWORD } });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;

    expect((await api('/projects', { token })).body).toEqual([]);
    expect((await api(`/projects/${ids['project']}`, { token })).status).toBe(404);
    expect((await api(`/projects/${ids['project']}/milestones/${ids['milestone']}/generate`, {
      method: 'POST', token, body: {},
    })).status).toBe(403);
  }, 60_000);
});
```

`engineer` is already one of the four demo accounts the seed creates, and it is given
no scope grant — that absence is exactly what this test relies on. `admin` is the only
account Task 6 grants global scope to.

- [ ] **Step 2: Run against the stack**

```bash
docker compose -f docker/docker-compose.yml up -d --build
pnpm nx run e2e:test
```

Expected: PASS.

- [ ] **Step 3: Verify the definition of done**

Walk the checklist in the design spec §10 and tick each item against a command or a
test name. Anything that cannot be demonstrated is not done.

```bash
pnpm nx run-many -t lint typecheck test build
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml port gateway 3000
```

Expected: all targets pass; every service healthy; only the gateway maps a port.

- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "$(cat <<'EOF'
test(e2e): the project tracking critical path

Drives the gateway alone -- generate scope across sites, refuse a blocked
start, approve through the qc contract, watch the milestone become eligible,
declare achievement, and verify the audit chain is still intact.

Step 7 publishes qc.submission.approved straight to NATS, standing in for
sub-project 3's producer against the contract fixed in @ipms/events. That is
the payoff for declaring the contract before the producer existed: the
critical path is demonstrable end to end with qc still unwritten.

Closes with the negative case -- a FIELD_ENGINEER with no scope sees an empty
project list and is refused generation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Definition of done

- [ ] `pnpm nx run-many -t lint typecheck test build` passes for every project
- [ ] A user scoped to one project cannot list, read, or mutate another project's sites
- [ ] A resource outside scope returns `404`, not `403`
- [ ] Bulk generation run twice creates nothing the second time, including concurrently
- [ ] Adding a site and re-running generation gives that site exactly its missing tasks
- [ ] A blocked task refuses `NOT_STARTED → ONGOING` with `409` and names its prerequisites
- [ ] `qc.submission.approved` drives a task to `COMPLETED` and its milestone to `ELIGIBLE`
- [ ] Redelivering that event changes nothing and re-emits nothing
- [ ] A PM declares achievement; a non-eligible milestone refuses declaration
- [ ] Project milestone progress is computed, with no stored percentage anywhere
- [ ] An emptied projection denies every non-global user, then rebuilds on restart
- [ ] Duplicate scope grants are rejected at every level, and the three levels coexist
- [ ] A `SUPER_ADMIN` holding a global grant sees every project; revoking it takes effect
- [ ] Every mutation appears in the audit ledger and the chain verifies
- [ ] The access simulator's verdict matches real enforcement, with its check chain
- [ ] `qc` is unreachable through the gateway until sub-project 3
- [ ] No secret appears in any committed file
