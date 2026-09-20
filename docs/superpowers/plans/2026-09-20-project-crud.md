# Project CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every project entity — projects, sites, task types, milestones and tasks — creatable, browsable, editable and deletable from the browser.

**Architecture:** The `project` service gains the update, delete and task-listing endpoints it lacks, each guarded so a destructive call cannot silently destroy work. The gateway allowlists three new prefixes. The Next.js app gains `/projects` routes that call the existing `app/lib/project-api.ts` client through Server Actions, so the access token stays in an http-only cookie and forms work without client JavaScript.

**Tech Stack:** TypeScript 5.9 (ESM, `NodeNext`), NestJS 12, Fastify, Prisma ORM 7, PostgreSQL 17, Next.js 16 (App Router, React 19.2), Vitest 4, pnpm 10, Nx 23.

**Spec:** `docs/superpowers/specs/2026-09-20-project-crud-design.md`

## Global Constraints

- Every import of a local `.ts` file uses an explicit `.js` extension (`NodeNext` resolution). Specs import `./project.service.js`, not `./project.service`.
- `zod` is pinned at `4.6.5` everywhere it is declared.
- The `project` service imports its Prisma client from `@prisma-clients/project`, never from `@prisma/client` — see the `output` line in `apps/project/prisma/schema.prisma`.
- Nest exceptions are the only way a service reports a refusal. `NotFoundException` → 404, `ConflictException` → 409, `BadRequestException` → 400. The filter added in Task 1 turns them into the platform envelope.
- Permission strings must already exist in `libs/authz/src/permissions.ts`. A `@RequirePermission` naming a code that is not in the catalogue is unreachable, not permissive.
- The web app never reads a cookie outside `app/lib/`. Pages and actions call `authFetch` wrappers only.
- Existing code style in `apps/project` is deliberately dense (one-line methods). Match the file you are editing rather than reformatting it.
- Commit after every task. Do not batch.

---

## File Structure

**Created:**
- `libs/observability/src/exception.filter.ts` — the platform error envelope filter, moved here from the gateway so every service can register it
- `libs/observability/src/exception.filter.spec.ts` — moved with it
- `apps/project/vitest.config.ts` — the service has no test setup at all today
- `apps/project/src/project/project.service.spec.ts` — service behaviour against a stubbed Prisma client
- `apps/project/src/project/project.controller.spec.ts` — routing, parsing and permission metadata
- `apps/web/app/projects/form-state.ts` — `ApiResult` → form state, shared by every action
- `apps/web/app/projects/actions.ts` — one Server Action per mutation
- `apps/web/app/projects/page.tsx` — the list
- `apps/web/app/projects/new/page.tsx` — the create form
- `apps/web/app/projects/[id]/page.tsx` — the detail page
- `apps/web/app/projects/[id]/edit/page.tsx` — project edit, archive, delete
- `apps/web/app/projects/forms.tsx` — the client components that render form state
- `apps/web/app/projects/actions.spec.ts` — error-state mapping

**Modified:**
- `libs/observability/package.json`, `libs/observability/src/index.ts` — the filter's new home
- `apps/gateway/src/main.ts`, `apps/gateway/package.json` — import the filter from the library
- `apps/gateway/src/proxy/routes.ts` + `routes.spec.ts` — three new prefixes
- `libs/authz/src/permissions.ts` — `project.delete`
- `apps/iam/prisma/seed.ts` — grant it
- `libs/contracts/src/project/project.ts` — the four update schemas
- `apps/project/src/project/project.service.ts` — list, update and delete methods
- `apps/project/src/project/project.controller.ts` — their routes
- `apps/project/package.json` — vitest config discovery
- `apps/web/app/lib/project-api.ts` + `project-api.spec.ts` — the new calls
- `apps/web/app/styles.css` — form, table and dialog styles
- `apps/web/app/page.tsx` — point "View projects" at `/projects`

**Deleted:**
- `apps/gateway/src/errors/exception.filter.ts` and its spec (moved to the library)

---

## Task map

| Task | Deliverable | Depends on |
|---|---|---|
| 1 | The error envelope in the `project` service | — |
| 2 | `project.delete` in the catalogue and the seed | — |
| 3 | Update schemas in `@ipms/contracts` | — |
| 4 | `project` test harness and `GET /projects/:id/tasks` | — |
| 5 | Update endpoints for site, task type, milestone, task | 3, 4 |
| 6 | Archive, and the four guarded deletes | 1, 2, 4 |
| 7 | Gateway prefixes for sites, task-types, milestones | 5, 6 |
| 8 | Web client functions for everything above | 5, 6, 7 |
| 9 | Form, table and dialog styles | — |
| 10 | `/projects` list and `/projects/new` | 8, 9 |
| 11 | `/projects/[id]` detail with inline sub-resource CRUD | 10 |
| 12 | `/projects/[id]/edit` with archive and guarded delete | 11 |

---

## Task 1: The error envelope in the `project` service

Today only the gateway registers `GlobalExceptionFilter`. The `project` service returns Nest's default `{statusCode, message, error}` shape, which `describeFailure` in `apps/web/app/lib/api-client.ts:59` does not recognise — so every refusal reaches the user as the generic "The iPMS API returned an unexpected error." A guarded delete that cannot say *why* it was refused is not worth building, so this comes first.

The filter moves into `@ipms/observability`, which both services already depend on.

**Files:**
- Create: `libs/observability/src/exception.filter.ts`
- Create: `libs/observability/src/exception.filter.spec.ts` (moved from the gateway)
- Modify: `libs/observability/package.json`, `libs/observability/src/index.ts`
- Modify: `apps/gateway/src/main.ts:81`, `apps/project/src/main.ts`
- Delete: `apps/gateway/src/errors/exception.filter.ts`, `apps/gateway/src/errors/exception.filter.spec.ts`

**Interfaces:**
- Produces: `GlobalExceptionFilter` exported from `@ipms/observability`, constructor `(service?: string)` defaulting to `'app'`, used by every later task's error assertions.

- [ ] **Step 1: Move the filter and its spec**

```bash
cd /Volumes/kedar/webprojects/iPMS
git mv apps/gateway/src/errors/exception.filter.ts libs/observability/src/exception.filter.ts
git mv apps/gateway/src/errors/exception.filter.spec.ts libs/observability/src/exception.filter.spec.ts
```

- [ ] **Step 2: Make the logger name a constructor argument**

The moved file hardcodes `createLogger('gateway')` at module scope. Replace the logger line and the class declaration in `libs/observability/src/exception.filter.ts`:

```ts
import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';
import { buildError, uuidv7, type ErrorCode } from '@ipms/contracts';
import { createLogger, getCorrelationId } from './logger.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/**
 * Turns anything thrown into the platform's error envelope.
 *
 * It lives here rather than in one service because the envelope is what the
 * web client parses: a service without it reports every refusal as an
 * unexplained failure, whatever the exception said.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly log;

  constructor(service = 'app') {
    this.log = createLogger(service);
  }
```

The `catch` body is unchanged except that `log.error(...)` becomes `this.log.error(...)`.

Fix the correlation import too — `getCorrelationId` comes from `./correlation.js`, so the import line is:

```ts
import { createLogger } from './logger.js';
import { getCorrelationId } from './correlation.js';
```

- [ ] **Step 3: Declare the new dependencies**

`libs/observability/package.json` — add to `dependencies`, keeping the existing entries:

```json
    "@ipms/contracts": "workspace:*",
    "zod": "4.6.5"
```

- [ ] **Step 4: Export it**

Append to `libs/observability/src/index.ts`:

```ts
export { GlobalExceptionFilter } from './exception.filter.js';
```

- [ ] **Step 5: Fix the moved spec's import**

In `libs/observability/src/exception.filter.spec.ts` the import already reads `./exception.filter.js` and needs no change. Confirm the file compiles in its new home by running it.

Run: `cd libs/observability && npx vitest run src/exception.filter.spec.ts`
Expected: PASS, all existing cases green.

- [ ] **Step 6: Point the gateway at the library**

In `apps/gateway/src/main.ts`, delete the line `import { GlobalExceptionFilter } from './errors/exception.filter.js';` and add `GlobalExceptionFilter` to the existing `@ipms/observability` import. Then change line 81:

```ts
  app.useGlobalFilters(new GlobalExceptionFilter('gateway'));
```

Remove `zod` from `apps/gateway/package.json` only if nothing else in the gateway imports it:

Run: `cd /Volumes/kedar/webprojects/iPMS && grep -rn "from 'zod'" apps/gateway/src`
If that prints nothing, drop the `zod` dependency; otherwise leave it.

- [ ] **Step 7: Register it in the project service**

`apps/project/src/main.ts` — add `GlobalExceptionFilter` to the `@ipms/observability` import, and register it immediately before `app.enableShutdownHooks()`:

```ts
app.useGlobalFilters(new GlobalExceptionFilter('project'));
```

- [ ] **Step 8: Verify the workspace still builds**

Run: `cd /Volumes/kedar/webprojects/iPMS && pnpm install && npx nx run-many -t typecheck --projects=gateway,project,@ipms/observability`
Expected: no errors. If `@ipms/observability` cannot resolve `@ipms/contracts`, re-run `pnpm install` — the workspace link is new.

- [ ] **Step 9: Commit**

```bash
git add libs/observability apps/gateway apps/project/src/main.ts
git commit -m "refactor(observability): share the error envelope filter across services

The project service returned Nest's default error shape, which the web
client does not recognise, so every refusal reached the user as an
unexplained failure. The filter now lives beside the logger it uses and
both services register it."
```

---

## Task 2: `project.delete` in the catalogue and the seed

**Files:**
- Modify: `libs/authz/src/permissions.ts:39`
- Modify: `apps/iam/prisma/seed.ts:20`

**Interfaces:**
- Produces: the permission code `project.delete`, required by Task 6's `@RequirePermission('project.delete')`.

- [ ] **Step 1: Write the failing test**

Append to `libs/authz/src/permissions.spec.ts` (create the file if it does not exist, with the imports shown):

```ts
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, expandDependencies } from './index.js';

describe('project.delete', () => {
  it('is in the catalogue', () => {
    expect(PERMISSIONS.map((p) => p.code)).toContain('project.delete');
  });

  it('depends on archive, so no role can hard-delete without the reversible power', () => {
    expect(expandDependencies(['project.delete']).sort())
      .toEqual(['project.archive', 'project.delete', 'project.update', 'project.view']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd libs/authz && npx vitest run src/permissions.spec.ts`
Expected: FAIL — `expected [ … ] to contain 'project.delete'`.

- [ ] **Step 3: Add the permission**

In `libs/authz/src/permissions.ts`, directly after the `project.archive` line:

```ts
  def('project', 'delete', 'Permanently delete a project', ['project.view', 'project.archive']),
```

- [ ] **Step 4: Run it again**

Run: `cd libs/authz && npx vitest run src/permissions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Grant it to SUPER_ADMIN only**

`SUPER_ADMIN` already holds `ALL`, so it picks the new code up automatically. `PROJECT_MANAGER` must gain `project.archive` — it currently has neither — so that archiving works for the role that runs projects, while hard deletion stays with `SUPER_ADMIN`. In `apps/iam/prisma/seed.ts`, change the `PROJECT_MANAGER` project line to:

```ts
      'project.view', 'project.create', 'project.update', 'project.archive',
```

- [ ] **Step 6: Verify the seed still closes over its dependencies**

Run: `cd apps/iam && npx vitest run prisma`
Expected: PASS. (`seed.integration.spec.ts` needs Docker; if it is skipped for lack of a daemon, that is the existing behaviour and not a regression — note it and continue.)

- [ ] **Step 7: Commit**

```bash
git add libs/authz apps/iam/prisma/seed.ts
git commit -m "feat(authz): add project.delete, and let project managers archive

Hard deletion is a separate power from archiving and depends on it, so a
role cannot be given the irreversible action without the reversible one."
```

---

## Task 3: Update schemas in `@ipms/contracts`

**Files:**
- Modify: `libs/contracts/src/project/project.ts`
- Modify: `libs/contracts/src/project/project.spec.ts` (create if absent)

**Interfaces:**
- Produces: `UpdateSiteSchema`/`UpdateSiteDto`, `UpdateTaskTypeSchema`/`UpdateTaskTypeDto`, `UpdateMilestoneSchema`/`UpdateMilestoneDto`, `UpdateTaskSchema`/`UpdateTaskDto`, `ListTasksQuerySchema`/`ListTasksQueryDto`. Tasks 4–6 parse with these; Task 8 imports the DTO types.

- [ ] **Step 1: Write the failing test**

Create or append to `libs/contracts/src/project/project.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ListTasksQuerySchema,
  UpdateMilestoneSchema,
  UpdateSiteSchema,
  UpdateTaskSchema,
  UpdateTaskTypeSchema,
} from './project.js';

describe('UpdateSiteSchema', () => {
  it('accepts a single field', () => {
    expect(UpdateSiteSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('accepts a status, which create cannot set', () => {
    expect(UpdateSiteSchema.parse({ status: 'IN_DELIVERY' }).status).toBe('IN_DELIVERY');
  });

  it('refuses an unknown status', () => {
    expect(() => UpdateSiteSchema.parse({ status: 'MAYBE' })).toThrow();
  });

  it('refuses a site code that create would also refuse', () => {
    expect(() => UpdateSiteSchema.parse({ siteCode: 'lower case' })).toThrow();
  });
});

describe('UpdateTaskTypeSchema', () => {
  it('accepts isActive, which is how a task type is retired', () => {
    expect(UpdateTaskTypeSchema.parse({ isActive: false }).isActive).toBe(false);
  });
});

describe('UpdateMilestoneSchema', () => {
  it('treats taskTypeIds as a wholesale replacement, absent when not given', () => {
    expect(UpdateMilestoneSchema.parse({ name: 'Handover' }).taskTypeIds).toBeUndefined();
    expect(UpdateMilestoneSchema.parse({ taskTypeIds: [] }).taskTypeIds).toEqual([]);
  });
});

describe('UpdateTaskSchema', () => {
  it('accepts a status', () => {
    expect(UpdateTaskSchema.parse({ status: 'ONGOING' }).status).toBe('ONGOING');
  });

  it('accepts a null assignee, which is how a task is unassigned', () => {
    expect(UpdateTaskSchema.parse({ assigneeId: null }).assigneeId).toBeNull();
  });
});

describe('ListTasksQuerySchema', () => {
  it('defaults to no filter', () => {
    expect(ListTasksQuerySchema.parse({})).toEqual({});
  });

  it('refuses a siteId that is not a uuid', () => {
    expect(() => ListTasksQuerySchema.parse({ siteId: 'nope' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd libs/contracts && npx vitest run src/project/project.spec.ts`
Expected: FAIL — the schemas do not exist.

- [ ] **Step 3: Add the schemas**

Append to `libs/contracts/src/project/project.ts`:

```ts
/**
 * The update shapes.
 *
 * Each is its create schema made partial, so a validation rule is written
 * once and cannot drift between the two paths, plus the one field only an
 * update may set. `taskTypeIds` on a milestone update is a wholesale
 * replacement of the requirement set: absent leaves it alone, `[]` clears it.
 */
export const UpdateSiteSchema = CreateSiteSchema.partial().extend({ status: SiteStatusSchema.optional() });
export type UpdateSiteDto = z.infer<typeof UpdateSiteSchema>;

export const UpdateTaskTypeSchema = CreateTaskTypeSchema.partial().extend({ isActive: z.boolean().optional() });
export type UpdateTaskTypeDto = z.infer<typeof UpdateTaskTypeSchema>;

export const UpdateMilestoneSchema = CreateMilestoneSchema.partial().extend({ taskTypeIds: z.array(UuidSchema).optional() });
export type UpdateMilestoneDto = z.infer<typeof UpdateMilestoneSchema>;

/**
 * `assigneeId` is nullable rather than merely optional: absent means "leave
 * the assignee alone", and null means "unassign", and a form needs both.
 */
export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).max(250).optional(),
  status: TaskStatusSchema.optional(),
  assigneeId: UuidSchema.nullable().optional(),
  plannedCompletionAt: z.coerce.date().nullable().optional(),
}).strip();
export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>;

export const ListTasksQuerySchema = z.object({
  siteId: UuidSchema.optional(),
  status: TaskStatusSchema.optional(),
}).strip();
export type ListTasksQueryDto = z.infer<typeof ListTasksQuerySchema>;
```

Note `CreateMilestoneSchema.partial()` makes `taskTypeIds` optional but keeps its `.default([])`, which would silently re-add an empty array; the explicit `.extend` above overrides it. That is why the extend is there and must not be removed as redundant.

- [ ] **Step 4: Run it again**

Run: `cd libs/contracts && npx vitest run src/project/project.spec.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Confirm the barrel exports them**

Run: `cd /Volumes/kedar/webprojects/iPMS && grep -n "project" libs/contracts/src/index.ts`
If the barrel re-exports `./project/project.js` with a wildcard, nothing to do. If it names each export, add the five new schema names and their DTO types.

- [ ] **Step 6: Commit**

```bash
git add libs/contracts
git commit -m "feat(contracts): add the project update shapes

Each update schema is its create schema made partial, so a validation rule
is written once, plus the one field only an update may set."
```

---

## Task 4: `project` test harness and `GET /projects/:id/tasks`

`apps/project` has no vitest config and no specs. This task adds both, and proves them on the one read that browse cannot do without: there is currently no route that lists tasks.

**Files:**
- Create: `apps/project/vitest.config.ts`
- Create: `apps/project/src/project/project.service.spec.ts`
- Modify: `apps/project/src/project/project.service.ts`, `apps/project/src/project/project.controller.ts`

**Interfaces:**
- Consumes: `ListTasksQuerySchema` from Task 3.
- Produces: `ProjectService.listTasks(projectId: string, query: ListTasksQueryDto)`; the `makePrisma()` stub pattern that Tasks 5 and 6 extend.

- [ ] **Step 1: Add the vitest config**

Create `apps/project/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
```

- [ ] **Step 2: Write the failing test**

Create `apps/project/src/project/project.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import { ProjectService } from './project.service.js';

const PROJECT = { id: 'p-1', code: 'ALPHA', name: 'Alpha' };

/**
 * A hand-written Prisma double.
 *
 * Only the calls the service actually makes are stubbed, so a method that
 * reaches for a table this fixture does not describe fails loudly rather than
 * quietly returning undefined.
 */
function makePrisma() {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue(PROJECT),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    site: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    taskType: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    milestone: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    milestoneRequirement: { deleteMany: vi.fn(), createMany: vi.fn() },
    task: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    region: { upsert: vi.fn() },
    $transaction: vi.fn(),
  };
}

type Prisma = ReturnType<typeof makePrisma>;

function service(prisma: Prisma): ProjectService {
  return new ProjectService(prisma as unknown as PrismaClient);
}

describe('listTasks', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('lists a project\'s tasks newest first', async () => {
    await service(prisma).listTasks('p-1', {});
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p-1' },
      orderBy: { id: 'desc' },
    });
  });

  it('narrows by site and status when asked', async () => {
    await service(prisma).listTasks('p-1', { siteId: 's-1', status: 'ONGOING' });
    expect(prisma.task.findMany.mock.calls[0]![0].where)
      .toEqual({ projectId: 'p-1', siteId: 's-1', status: 'ONGOING' });
  });

  it('refuses a project that does not exist', async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(service(prisma).listTasks('missing', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd apps/project && npx vitest run src/project/project.service.spec.ts`
Expected: FAIL — `service(prisma).listTasks is not a function`.

- [ ] **Step 4: Implement it**

Add to `apps/project/src/project/project.service.ts`, after `getProject`, matching the file's one-line style:

```ts
  /** Ordered by id, which is a uuidv7 and therefore time-ordered — Task has no createdAt column. */
  async listTasks(projectId: string, query: ListTasksQueryDto) { await this.requireProject(projectId); return this.prisma.task.findMany({ where: { projectId, ...(query.siteId ? { siteId: query.siteId } : {}), ...(query.status ? { status: query.status } : {}) }, orderBy: { id: 'desc' } }); }
```

Add `type ListTasksQueryDto` to the existing `@ipms/contracts` type import at the top of the file.

- [ ] **Step 5: Run it again**

Run: `cd apps/project && npx vitest run src/project/project.service.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Add the route**

In `apps/project/src/project/project.controller.ts`, after the `projects/:id` GET, and add `Query` to the `@nestjs/common` import and `ListTasksQuerySchema` to the contracts import:

```ts
  @Get('projects/:id/tasks') @RequirePermission('task.view') tasks(@Param('id') id:string,@Query() query:unknown){ return this.service.listTasks(UuidSchema.parse(id),ListTasksQuerySchema.parse(query)); }
```

- [ ] **Step 7: Typecheck**

Run: `cd apps/project && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/project
git commit -m "feat(project): list a project's tasks, and add a test harness

No route listed tasks at all, so a client could create one and never see
it again. The service had no test setup either; this adds the Prisma
double the update and delete work builds on."
```

---

## Task 5: Update endpoints for site, task type, milestone and task

**Files:**
- Modify: `apps/project/src/project/project.service.ts`, `apps/project/src/project/project.controller.ts`, `apps/project/src/project/project.service.spec.ts`

**Interfaces:**
- Consumes: the update schemas from Task 3; `makePrisma()` from Task 4.
- Produces: `updateSite(id, dto)`, `updateTaskType(id, dto)`, `updateMilestone(id, dto)`, `updateTask(id, dto)` on `ProjectService`; the routes `PATCH /sites/:id`, `PATCH /task-types/:id`, `PATCH /milestones/:id`, `PATCH /tasks/:id`.

Sub-resources are addressed by their own id, not nested under a project: the id is globally unique, and nesting would add a redundant ownership check to every call.

**Status is set, not transitioned.** A task's status changes here by assignment. The transition rules — which status may follow which, and what a QC submission does to them — are Task 11 of the tracking plan and must not be invented in this task.

- [ ] **Step 1: Write the failing tests**

Append to `apps/project/src/project/project.service.spec.ts`:

```ts
describe('updateSite', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue({ id: 's-1', projectId: 'p-1', siteCode: 'S-1' });
  });

  it('writes only the fields given', async () => {
    prisma.site.update.mockResolvedValue({ id: 's-1' });
    await service(prisma).updateSite('s-1', { name: 'Renamed' });
    expect(prisma.site.update).toHaveBeenCalledWith({ where: { id: 's-1' }, data: { name: 'Renamed' } });
  });

  it('upserts the region when one is named, and stores its id', async () => {
    prisma.region.upsert.mockResolvedValue({ id: 'r-9' });
    prisma.site.update.mockResolvedValue({ id: 's-1' });
    await service(prisma).updateSite('s-1', { regionName: 'North' });
    expect(prisma.region.upsert).toHaveBeenCalledWith({
      where: { projectId_name: { projectId: 'p-1', name: 'North' } },
      update: {}, create: { id: expect.any(String), projectId: 'p-1', name: 'North' },
    });
    expect(prisma.site.update.mock.calls[0]![0].data).toEqual({ regionId: 'r-9' });
  });

  it('refuses a site that does not exist', async () => {
    prisma.site.findUnique.mockResolvedValue(null);
    await expect(service(prisma).updateSite('missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('updateTask', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.task.findUnique.mockResolvedValue({ id: 't-1', projectId: 'p-1' });
    prisma.task.update.mockResolvedValue({ id: 't-1' });
  });

  it('unassigns when assigneeId is explicitly null', async () => {
    await service(prisma).updateTask('t-1', { assigneeId: null });
    expect(prisma.task.update.mock.calls[0]![0].data).toEqual({ assigneeId: null });
  });

  it('leaves the assignee alone when the field is absent', async () => {
    await service(prisma).updateTask('t-1', { title: 'Renamed' });
    expect(prisma.task.update.mock.calls[0]![0].data).toEqual({ title: 'Renamed' });
  });
});

describe('updateMilestone', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.milestone.findUnique.mockResolvedValue({ id: 'm-1', projectId: 'p-1' });
    prisma.milestone.update.mockResolvedValue({ id: 'm-1' });
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  });

  it('replaces the requirement set wholesale when taskTypeIds is given', async () => {
    prisma.taskType.count.mockResolvedValue(2);
    await service(prisma).updateMilestone('m-1', { taskTypeIds: ['tt-1', 'tt-2'] });
    expect(prisma.milestoneRequirement.deleteMany).toHaveBeenCalledWith({ where: { milestoneId: 'm-1' } });
    expect(prisma.milestoneRequirement.createMany).toHaveBeenCalledWith({
      data: [{ milestoneId: 'm-1', taskTypeId: 'tt-1' }, { milestoneId: 'm-1', taskTypeId: 'tt-2' }],
    });
  });

  it('leaves the requirement set alone when taskTypeIds is absent', async () => {
    await service(prisma).updateMilestone('m-1', { name: 'Handover' });
    expect(prisma.milestoneRequirement.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a task type from another project', async () => {
    prisma.taskType.count.mockResolvedValue(1);
    await expect(service(prisma).updateMilestone('m-1', { taskTypeIds: ['tt-1', 'other'] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
```

Add `BadRequestException` to the `@nestjs/common` import at the top of the spec.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd apps/project && npx vitest run src/project/project.service.spec.ts`
Expected: FAIL — `updateSite is not a function` and the rest.

- [ ] **Step 3: Implement the update methods**

Add to `apps/project/src/project/project.service.ts`:

```ts
  async updateSite(id:string,dto:UpdateSiteDto){ const site=await this.requireSite(id); let regionId:string|undefined; if(dto.regionName){ const region=await this.prisma.region.upsert({where:{projectId_name:{projectId:site.projectId,name:dto.regionName}},update:{},create:{id:uuidv7(),projectId:site.projectId,name:dto.regionName}}); regionId=region.id; } const data={...(dto.name===undefined?{}:{name:dto.name}),...(dto.siteCode===undefined?{}:{siteCode:dto.siteCode}),...(dto.latitude===undefined?{}:{latitude:dto.latitude}),...(dto.longitude===undefined?{}:{longitude:dto.longitude}),...(dto.geofenceRadiusM===undefined?{}:{geofenceRadiusM:dto.geofenceRadiusM}),...(dto.address===undefined?{}:{address:dto.address}),...(dto.city===undefined?{}:{city:dto.city}),...(dto.area===undefined?{}:{area:dto.area}),...(dto.scopeVariant===undefined?{}:{scopeVariant:dto.scopeVariant}),...(dto.status===undefined?{}:{status:dto.status}),...(regionId===undefined?{}:{regionId})}; try{ return await this.prisma.site.update({where:{id},data}); }catch{ throw new BadRequestException('Site code is already in use in this project'); } }
  async updateTaskType(id:string,dto:UpdateTaskTypeDto){ await this.requireTaskType(id); try{ return await this.prisma.taskType.update({where:{id},data:{...(dto.code===undefined?{}:{code:dto.code}),...(dto.name===undefined?{}:{name:dto.name}),...(dto.category===undefined?{}:{category:dto.category}),...(dto.templateId===undefined?{}:{templateId:dto.templateId}),...(dto.order===undefined?{}:{order:dto.order}),...(dto.isActive===undefined?{}:{isActive:dto.isActive})}}); }catch{ throw new BadRequestException('Task type code is already in use in this project'); } }
  async updateMilestone(id:string,dto:UpdateMilestoneDto){ const milestone=await this.requireMilestone(id); if(dto.taskTypeIds){ const found=dto.taskTypeIds.length?await this.prisma.taskType.count({where:{id:{in:dto.taskTypeIds},projectId:milestone.projectId}}):0; if(found!==dto.taskTypeIds.length) throw new BadRequestException('Every required task type must belong to this project'); } const data={...(dto.code===undefined?{}:{code:dto.code}),...(dto.name===undefined?{}:{name:dto.name}),...(dto.kind===undefined?{}:{kind:dto.kind}),...(dto.sequence===undefined?{}:{sequence:dto.sequence}),...(dto.targetDate===undefined?{}:{targetDate:dto.targetDate})}; return this.prisma.$transaction(async(tx)=>{ const saved=await tx.milestone.update({where:{id},data}); if(dto.taskTypeIds){ await tx.milestoneRequirement.deleteMany({where:{milestoneId:id}}); if(dto.taskTypeIds.length) await tx.milestoneRequirement.createMany({data:dto.taskTypeIds.map((taskTypeId)=>({milestoneId:id,taskTypeId}))}); } return saved; }); }
  /** Sets status; it does not police transitions — that is the tracking plan's Task 11. */
  async updateTask(id:string,dto:UpdateTaskDto){ await this.requireTask(id); return this.prisma.task.update({where:{id},data:{...(dto.title===undefined?{}:{title:dto.title}),...(dto.status===undefined?{}:{status:dto.status}),...(dto.assigneeId===undefined?{}:{assigneeId:dto.assigneeId}),...(dto.plannedCompletionAt===undefined?{}:{plannedCompletionAt:dto.plannedCompletionAt})}}); }
```

And the four existence helpers, beside `requireProject`:

```ts
  private async requireSite(id:string){ const site=await this.prisma.site.findUnique({where:{id}}); if(!site) throw new NotFoundException('Site not found'); return site; }
  private async requireTaskType(id:string){ const taskType=await this.prisma.taskType.findUnique({where:{id}}); if(!taskType) throw new NotFoundException('Task type not found'); return taskType; }
  private async requireMilestone(id:string){ const milestone=await this.prisma.milestone.findUnique({where:{id}}); if(!milestone) throw new NotFoundException('Milestone not found'); return milestone; }
  private async requireTask(id:string){ const task=await this.prisma.task.findUnique({where:{id}}); if(!task) throw new NotFoundException('Task not found'); return task; }
```

Add the four `Update*Dto` types to the contracts type import.

- [ ] **Step 4: Run the tests**

Run: `cd apps/project && npx vitest run src/project/project.service.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Add the routes**

In `apps/project/src/project/project.controller.ts`, and add the four update schemas to the contracts import:

```ts
  @Patch('sites/:id') @RequirePermission('site.update') updateSite(@Param('id') id:string,@Body() body:unknown){ return this.service.updateSite(UuidSchema.parse(id),UpdateSiteSchema.parse(body)); }
  @Patch('task-types/:id') @RequirePermission('task.update') updateTaskType(@Param('id') id:string,@Body() body:unknown){ return this.service.updateTaskType(UuidSchema.parse(id),UpdateTaskTypeSchema.parse(body)); }
  @Patch('milestones/:id') @RequirePermission('milestone.update') updateMilestone(@Param('id') id:string,@Body() body:unknown){ return this.service.updateMilestone(UuidSchema.parse(id),UpdateMilestoneSchema.parse(body)); }
  @Patch('tasks/:id') @RequirePermission('task.update') updateTask(@Param('id') id:string,@Body() body:unknown){ return this.service.updateTask(UuidSchema.parse(id),UpdateTaskSchema.parse(body)); }
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd apps/project && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add apps/project
git commit -m "feat(project): update sites, task types, milestones and tasks

Sub-resources are addressed by their own id rather than nested under a
project, because the id is unique and nesting would add a redundant
ownership check to every call. Setting a task's status here does not
police transitions; that is the tracking plan's Task 11."
```

---

## Task 6: Archive, and the four guarded deletes

**Files:**
- Modify: `apps/project/src/project/project.service.ts`, `apps/project/src/project/project.controller.ts`, `apps/project/src/project/project.service.spec.ts`
- Create: `apps/project/src/project/project.controller.spec.ts`

**Interfaces:**
- Consumes: `makePrisma()` from Task 4; `project.delete` from Task 2.
- Produces: `archiveProject(id)`, `deleteProject(id)`, `deleteSite(id)`, `deleteTaskType(id)`, `deleteMilestone(id)`, `deleteTask(id)`; routes `POST /projects/:id/archive`, `DELETE /projects/:id`, `DELETE /sites/:id`, `DELETE /task-types/:id`, `DELETE /milestones/:id`, `DELETE /tasks/:id`.

The guards are the point of this task. Each refusal is a `ConflictException` (409 `CONFLICT` through the filter from Task 1) carrying a message that says what to do instead.

- [ ] **Step 1: Write the failing tests**

Append to `apps/project/src/project/project.service.spec.ts`:

```ts
describe('archiveProject', () => {
  it('sets the status to CANCELLED without touching anything else', async () => {
    const prisma = makePrisma();
    prisma.project.update.mockResolvedValue({ id: 'p-1', status: 'CANCELLED' });
    await service(prisma).archiveProject('p-1');
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { status: 'CANCELLED' } });
  });
});

describe('deleteProject', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('deletes a project that has no tasks', async () => {
    prisma.task.count.mockResolvedValue(0);
    await service(prisma).deleteProject('p-1');
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
  });

  it('refuses while any task remains, because the cascade would take them all', async () => {
    prisma.task.count.mockResolvedValue(3);
    await expect(service(prisma).deleteProject('p-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('refuses a project that does not exist', async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(service(prisma).deleteProject('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('deleteSite', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue({ id: 's-1', projectId: 'p-1' });
  });

  it('refuses while a task references the site', async () => {
    prisma.task.count.mockResolvedValue(1);
    await expect(service(prisma).deleteSite('s-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a site with no tasks', async () => {
    prisma.task.count.mockResolvedValue(0);
    await service(prisma).deleteSite('s-1');
    expect(prisma.site.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
  });
});

describe('deleteTaskType', () => {
  it('refuses while a task uses it, rather than letting Prisma raise a restrict error', async () => {
    const prisma = makePrisma();
    prisma.taskType.findUnique.mockResolvedValue({ id: 'tt-1', projectId: 'p-1' });
    prisma.task.count.mockResolvedValue(2);
    await expect(service(prisma).deleteTaskType('tt-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.taskType.delete).not.toHaveBeenCalled();
  });
});

describe('deleteTask', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('refuses a task that carries QC evidence', async () => {
    prisma.task.findUnique.mockResolvedValue({ id: 't-1', currentSubmissionId: 'sub-1' });
    await expect(service(prisma).deleteTask('t-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a task with no submission', async () => {
    prisma.task.findUnique.mockResolvedValue({ id: 't-1', currentSubmissionId: null });
    await service(prisma).deleteTask('t-1');
    expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });
  });
});
```

Add `ConflictException` to the spec's `@nestjs/common` import.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd apps/project && npx vitest run src/project/project.service.spec.ts`
Expected: FAIL — `archiveProject is not a function` and the rest.

- [ ] **Step 3: Implement**

Add to `apps/project/src/project/project.service.ts`:

```ts
  async archiveProject(id:string){ await this.requireProject(id); return this.prisma.project.update({where:{id},data:{status:'CANCELLED'}}); }
  /** Refuses while tasks remain: the schema cascades Project to its sites, task types, milestones and tasks, so this would take the lot. */
  async deleteProject(id:string){ await this.requireProject(id); const tasks=await this.prisma.task.count({where:{projectId:id}}); if(tasks>0) throw new ConflictException(`This project still has ${tasks} task(s). Delete them, or archive the project instead.`); await this.prisma.project.delete({where:{id}}); }
  async deleteSite(id:string){ await this.requireSite(id); const tasks=await this.prisma.task.count({where:{siteId:id}}); if(tasks>0) throw new ConflictException(`This site still has ${tasks} task(s). Delete them first.`); await this.prisma.site.delete({where:{id}}); }
  /** Checked here rather than caught from Prisma's onDelete:Restrict, so the message can say which way out there is. */
  async deleteTaskType(id:string){ await this.requireTaskType(id); const tasks=await this.prisma.task.count({where:{taskTypeId:id}}); if(tasks>0) throw new ConflictException(`This task type is used by ${tasks} task(s). Deactivate it instead.`); await this.prisma.taskType.delete({where:{id}}); }
  async deleteMilestone(id:string){ await this.requireMilestone(id); await this.prisma.milestone.delete({where:{id}}); }
  async deleteTask(id:string){ const task=await this.requireTask(id); if(task.currentSubmissionId) throw new ConflictException('This task has a QC submission. Cancel the task instead of deleting it.'); await this.prisma.task.delete({where:{id}}); }
```

Add `ConflictException` to the service's `@nestjs/common` import.

- [ ] **Step 4: Run the tests**

Run: `cd apps/project && npx vitest run src/project/project.service.spec.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Write the failing controller test**

Create `apps/project/src/project/project.controller.spec.ts`:

```ts
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY, type PermissionMetadata } from '@ipms/authz';
import { ProjectController } from './project.controller.js';
import type { ProjectService } from './project.service.js';

function permissionOf(method: keyof ProjectController): string | undefined {
  const handler = ProjectController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined)?.permission;
}

describe('permissions on the destructive routes', () => {
  const EXPECTED: [keyof ProjectController, string][] = [
    ['archive', 'project.archive'],
    ['remove', 'project.delete'],
    ['removeSite', 'site.delete'],
    ['removeTaskType', 'task.update'],
    ['removeMilestone', 'milestone.update'],
    ['removeTask', 'task.delete'],
    ['tasks', 'task.view'],
  ];

  for (const [method, permission] of EXPECTED) {
    it(`${String(method)} requires ${permission}`, () => {
      expect(permissionOf(method)).toBe(permission);
    });
  }
});

describe('id parsing', () => {
  it('refuses an id that is not a uuid before the service is reached', async () => {
    const service = { deleteProject: vi.fn() };
    const controller = new ProjectController(service as unknown as ProjectService);
    expect(() => controller.remove('not-a-uuid')).toThrow();
    expect(service.deleteProject).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `cd apps/project && npx vitest run src/project/project.controller.spec.ts`
Expected: FAIL — the handlers do not exist yet.

- [ ] **Step 7: Add the routes**

In `apps/project/src/project/project.controller.ts`, adding `Delete` to the `@nestjs/common` import:

```ts
  @Post('projects/:id/archive') @RequirePermission('project.archive') archive(@Param('id') id:string){ return this.service.archiveProject(UuidSchema.parse(id)); }
  @Delete('projects/:id') @RequirePermission('project.delete') remove(@Param('id') id:string){ return this.service.deleteProject(UuidSchema.parse(id)); }
  @Delete('sites/:id') @RequirePermission('site.delete') removeSite(@Param('id') id:string){ return this.service.deleteSite(UuidSchema.parse(id)); }
  @Delete('task-types/:id') @RequirePermission('task.update') removeTaskType(@Param('id') id:string){ return this.service.deleteTaskType(UuidSchema.parse(id)); }
  @Delete('milestones/:id') @RequirePermission('milestone.update') removeMilestone(@Param('id') id:string){ return this.service.deleteMilestone(UuidSchema.parse(id)); }
  @Delete('tasks/:id') @RequirePermission('task.delete') removeTask(@Param('id') id:string){ return this.service.deleteTask(UuidSchema.parse(id)); }
```

- [ ] **Step 8: Run both specs**

Run: `cd apps/project && npx vitest run`
Expected: PASS, 28 tests across 2 files.

- [ ] **Step 9: Commit**

```bash
git add apps/project
git commit -m "feat(project): archive a project, and delete with guards

A project's Prisma cascade reaches its sites, task types, milestones and
tasks, so a hard delete is refused while any task remains and archiving is
the ordinary path. Sites and task types refuse for the same reason, and a
task carrying QC evidence refuses in favour of cancellation."
```

---

## Task 7: Gateway prefixes for sites, task-types and milestones

Without these three entries every route added in Tasks 5 and 6 for a sub-resource 404s at the edge, whatever the service serves.

**Files:**
- Modify: `apps/gateway/src/proxy/routes.ts:33`, `apps/gateway/src/proxy/routes.spec.ts`

**Interfaces:**
- Produces: `/api/v1/sites`, `/api/v1/task-types`, `/api/v1/milestones` resolving to the `project` upstream — the paths Task 8's client calls.

- [ ] **Step 1: Write the failing test**

In `apps/gateway/src/proxy/routes.spec.ts`, extend the existing project-prefix test's array to:

```ts
    for (const path of [
      '/api/v1/dashboard', '/api/v1/projects', '/api/v1/projects/x/sites', '/api/v1/projects/x/tasks',
      '/api/v1/tasks/x/assign', '/api/v1/sites/x', '/api/v1/task-types/x', '/api/v1/milestones/x',
    ]) {
```

And add, beside it:

```ts
  it('does not reach an internal path under a new prefix', () => {
    expect(resolveUpstream('/api/v1/sites/internal/secrets')).toBeUndefined();
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/gateway && npx vitest run src/proxy/routes.spec.ts`
Expected: FAIL — `expected undefined to be 'project'` for `/api/v1/sites/x`.

- [ ] **Step 3: Add the prefixes**

In `apps/gateway/src/proxy/routes.ts`, inside `ROUTES`, after the `/api/v1/projects` entry:

```ts
  { prefix: '/api/v1/sites', service: 'project', ...PROJECT },
  { prefix: '/api/v1/task-types', service: 'project', ...PROJECT },
  { prefix: '/api/v1/milestones', service: 'project', ...PROJECT },
```

Project-level milestones are `/api/v1/milestones`; the tracking plan reserves `/api/v1/site-milestones` for per-site milestone instances, which is a different entity. Do not merge the two.

- [ ] **Step 4: Run it again**

Run: `cd apps/gateway && npx vitest run src/proxy/routes.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gateway/src/proxy
git commit -m "feat(gateway): allowlist sites, task-types and milestones

Sub-resources are addressed by their own id, so they need their own
prefixes; without them every update and delete 404s at the edge."
```

---

## Task 8: Web client functions

**Files:**
- Modify: `apps/web/app/lib/project-api.ts`, `apps/web/app/lib/project-api.spec.ts`

**Interfaces:**
- Consumes: `authFetch`, `ApiResult` from `./api-client`; the update DTO types from Task 3.
- Produces: `listTasks`, `updateSite`, `updateTaskType`, `updateMilestone`, `updateTask`, `archiveProject`, `deleteProject`, `deleteSite`, `deleteTaskType`, `deleteMilestone`, `deleteTask` — the functions every page and action in Tasks 10–12 calls.

- [ ] **Step 1: Write the failing test**

In `apps/web/app/lib/project-api.spec.ts`, add these entries to the `CALLS` array:

```ts
  { name: 'listTasks', call: () => api.listTasks('p-1'), path: '/api/v1/projects/p-1/tasks' },
  {
    name: 'updateSite', call: () => api.updateSite('s-1', { name: 'Renamed' }),
    path: '/api/v1/sites/s-1', method: 'PATCH', json: { name: 'Renamed' },
  },
  {
    name: 'updateTaskType', call: () => api.updateTaskType('tt-1', { isActive: false }),
    path: '/api/v1/task-types/tt-1', method: 'PATCH', json: { isActive: false },
  },
  {
    name: 'updateMilestone', call: () => api.updateMilestone('m-1', { name: 'Handover' }),
    path: '/api/v1/milestones/m-1', method: 'PATCH', json: { name: 'Handover' },
  },
  {
    name: 'updateTask', call: () => api.updateTask('t-1', { status: 'ONGOING' }),
    path: '/api/v1/tasks/t-1', method: 'PATCH', json: { status: 'ONGOING' },
  },
  { name: 'archiveProject', call: () => api.archiveProject('p-1'), path: '/api/v1/projects/p-1/archive', method: 'POST' },
  { name: 'deleteProject', call: () => api.deleteProject('p-1'), path: '/api/v1/projects/p-1', method: 'DELETE' },
  { name: 'deleteSite', call: () => api.deleteSite('s-1'), path: '/api/v1/sites/s-1', method: 'DELETE' },
  { name: 'deleteTaskType', call: () => api.deleteTaskType('tt-1'), path: '/api/v1/task-types/tt-1', method: 'DELETE' },
  { name: 'deleteMilestone', call: () => api.deleteMilestone('m-1'), path: '/api/v1/milestones/m-1', method: 'DELETE' },
  { name: 'deleteTask', call: () => api.deleteTask('t-1'), path: '/api/v1/tasks/t-1', method: 'DELETE' },
```

And a test that the task filter reaches the query string, not the path:

```ts
describe('listTasks filtering', () => {
  it('passes the filter as a query, which the gateway forwards untouched', async () => {
    await api.listTasks('p-1', { status: 'ONGOING' });
    expect(authFetch).toHaveBeenCalledWith('/api/v1/projects/p-1/tasks', { query: { status: 'ONGOING' } });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/web && npx vitest run app/lib/project-api.spec.ts`
Expected: FAIL — `api.listTasks is not a function`.

- [ ] **Step 3: Implement**

Append to `apps/web/app/lib/project-api.ts`, adding the update DTO types to the existing type import:

```ts
export async function listTasks(projectId: string, filter: { siteId?: string; status?: TaskStatus } = {}): Promise<ApiResult<Task[]>> {
  return authFetch<Task[]>(`/api/v1/projects/${projectId}/tasks`, { query: filter });
}

export async function updateSite(id: string, changes: UpdateSiteDto): Promise<ApiResult<Site>> {
  return authFetch<Site>(`/api/v1/sites/${id}`, { method: 'PATCH', json: changes });
}

export async function updateTaskType(id: string, changes: UpdateTaskTypeDto): Promise<ApiResult<TaskType>> {
  return authFetch<TaskType>(`/api/v1/task-types/${id}`, { method: 'PATCH', json: changes });
}

export async function updateMilestone(id: string, changes: UpdateMilestoneDto): Promise<ApiResult<Milestone>> {
  return authFetch<Milestone>(`/api/v1/milestones/${id}`, { method: 'PATCH', json: changes });
}

export async function updateTask(id: string, changes: UpdateTaskDto): Promise<ApiResult<Task>> {
  return authFetch<Task>(`/api/v1/tasks/${id}`, { method: 'PATCH', json: changes });
}

/** Archiving is the ordinary end of a project's life; `deleteProject` is the irreversible one. */
export async function archiveProject(id: string): Promise<ApiResult<Project>> {
  return authFetch<Project>(`/api/v1/projects/${id}/archive`, { method: 'POST' });
}

export async function deleteProject(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/projects/${id}`, { method: 'DELETE' });
}

export async function deleteSite(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/sites/${id}`, { method: 'DELETE' });
}

export async function deleteTaskType(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/task-types/${id}`, { method: 'DELETE' });
}

export async function deleteMilestone(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/milestones/${id}`, { method: 'DELETE' });
}

export async function deleteTask(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/tasks/${id}`, { method: 'DELETE' });
}
```

The `query` object drops `undefined` values in `buildQuery` (`api-client.ts:42`), so an unfiltered `listTasks` sends no query string.

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && npx vitest run`
Expected: PASS — the existing 80 plus the new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib
git commit -m "feat(web): client calls for the project update and delete routes"
```

---

## Task 9: Form, table and dialog styles

`apps/web/app/styles.css` has `.panel`, `.badge`, `.primary-button`, `.form-error` and `.login-card`, but nothing for a data table, an inline form row, or a destructive action. Adding them here keeps Tasks 10–12 about behaviour.

**Files:**
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Produces: the class names `.data-table`, `.form-grid`, `.field`, `.inline-form`, `.danger-button`, `.ghost-button`, `.confirm-card`, `.toolbar`, `.tab-row`, `.form-note` used by Tasks 10–12.

- [ ] **Step 1: Add the styles**

Append to `apps/web/app/styles.css`, reusing the existing custom properties rather than introducing new colours:

```css
/* --- CRUD surfaces ------------------------------------------------------ */

.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }

.data-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.data-table th { text-align: left; font-weight: 600; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; opacity: .6; padding: 10px 12px; }
.data-table td { padding: 12px; border-top: 1px solid rgba(148, 163, 184, .18); vertical-align: middle; }
.data-table tr:hover td { background: rgba(148, 163, 184, .06); }
.data-table .row-actions { display: flex; gap: 8px; justify-content: flex-end; }

.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 500; }
.field input, .field select, .field textarea {
  padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, .35);
  background: transparent; color: inherit; font: inherit;
}
.field input:focus-visible, .field select:focus-visible, .field textarea:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }
.field .hint { font-weight: 400; opacity: .6; font-size: 12px; }

.inline-form { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; padding: 16px; border-top: 1px solid rgba(148, 163, 184, .18); }
.inline-form .field { flex: 1 1 180px; }

.ghost-button, .danger-button {
  padding: 8px 14px; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
  border: 1px solid rgba(148, 163, 184, .35); background: transparent; color: inherit;
}
.ghost-button:hover { background: rgba(148, 163, 184, .12); }
.danger-button { border-color: rgba(220, 38, 38, .45); color: #dc2626; }
.danger-button:hover { background: rgba(220, 38, 38, .1); }
.ghost-button:disabled, .danger-button:disabled, .primary-button:disabled { opacity: .5; cursor: not-allowed; }

.confirm-card { border: 1px solid rgba(220, 38, 38, .35); border-radius: 12px; padding: 20px; display: grid; gap: 12px; }
.confirm-card h2 { color: #dc2626; margin: 0; font-size: 16px; }

.form-note { font-size: 13px; opacity: .7; margin: 0; }
.tab-row { display: flex; gap: 4px; border-bottom: 1px solid rgba(148, 163, 184, .2); margin-bottom: 16px; }
.tab-row a { padding: 10px 14px; font-size: 14px; border-bottom: 2px solid transparent; }
.tab-row a[aria-current='true'] { border-bottom-color: #3b82f6; font-weight: 600; }
```

- [ ] **Step 2: Check it renders**

Run: `cd apps/web && npx next build`
Expected: build succeeds. (The CSS is not yet referenced; this step only proves it parses.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/styles.css
git commit -m "style(web): table, form and destructive-action styles"
```

---

## Task 10: `/projects` list and `/projects/new`

**Files:**
- Create: `apps/web/app/projects/form-state.ts`, `apps/web/app/projects/actions.ts`, `apps/web/app/projects/forms.tsx`, `apps/web/app/projects/page.tsx`, `apps/web/app/projects/new/page.tsx`, `apps/web/app/projects/actions.spec.ts`
- Modify: `apps/web/app/page.tsx:27`

**Interfaces:**
- Consumes: `listProjects`, `createProject` from `./lib/project-api`; `getCurrentUser`, `hasPermission` from `./lib/iam-api`.
- Produces: `FormState`, `settle()` from `form-state.ts`; `createProjectAction` from `actions.ts`; `<SubmitButton>`, `<FormError>` from `forms.tsx` — all used by Tasks 11 and 12.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/projects/actions.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const { settle } = await import('./form-state');

beforeEach(() => { revalidatePath.mockClear(); redirect.mockClear(); });

describe('settle', () => {
  it('revalidates and returns no error when the call succeeded', async () => {
    expect(await settle({ state: 'ready', data: {} }, '/projects')).toEqual({});
    expect(revalidatePath).toHaveBeenCalledWith('/projects');
  });

  it('returns the message when the user may not do this', async () => {
    const state = await settle({ state: 'forbidden', message: 'Not allowed' }, '/projects');
    expect(state.error).toBe('Not allowed');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('keeps the correlation id when the API is unavailable, so a refusal can be traced', async () => {
    const state = await settle(
      { state: 'unavailable', status: 409, message: 'Still has 3 tasks.', correlationId: 'corr-1' },
      '/projects',
    );
    expect(state).toEqual({ error: 'Still has 3 tasks.', correlationId: 'corr-1' });
  });

  it('sends an unauthenticated caller to sign in rather than showing an error', async () => {
    await expect(settle({ state: 'unauthenticated' }, '/projects')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/web && npx vitest run app/projects/actions.spec.ts`
Expected: FAIL — cannot resolve `./form-state`.

- [ ] **Step 3: Write the form-state helper**

Create `apps/web/app/projects/form-state.ts` (deliberately *not* a `'use server'` module — every export of one of those becomes a callable endpoint, and this is a helper):

```ts
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ApiResult } from '../lib/api-client';

export interface FormState {
  error?: string;
  correlationId?: string;
}

export const EMPTY: FormState = {};

/**
 * Turns an `ApiResult` into something a form can render.
 *
 * A 409 from a guarded delete arrives as `unavailable` with the service's own
 * message — "This project still has 3 task(s)…" — which is exactly what the
 * user needs to see, so it is shown rather than replaced with a generic
 * failure. An unauthenticated caller is redirected instead: no message on a
 * form can help them.
 */
export async function settle<T>(result: ApiResult<T>, revalidate: string): Promise<FormState> {
  if (result.state === 'unauthenticated') redirect('/login');
  if (result.state === 'forbidden') return { error: result.message };
  if (result.state === 'unavailable') {
    return { error: result.message, ...(result.correlationId === undefined ? {} : { correlationId: result.correlationId }) };
  }
  revalidatePath(revalidate);
  return EMPTY;
}

/** Reads a trimmed string field, or undefined when the input was left empty. */
export function optional(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
```

- [ ] **Step 4: Run the test**

Run: `cd apps/web && npx vitest run app/projects/actions.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the create action**

Create `apps/web/app/projects/actions.ts`:

```ts
'use server';
import { redirect } from 'next/navigation';
import { createProject } from '../lib/project-api';
import { optional, settle, type FormState } from './form-state';

export async function createProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const code = optional(form, 'code');
  const name = optional(form, 'name');
  if (!code || !name) return { error: 'A code and a name are required.' };

  const result = await createProject({
    code,
    name,
    ...(optional(form, 'clientName') === undefined ? {} : { clientName: optional(form, 'clientName')! }),
    ...(optional(form, 'phase') === undefined ? {} : { phase: optional(form, 'phase')! }),
    ...(optional(form, 'startDate') === undefined ? {} : { startDate: new Date(optional(form, 'startDate')!) }),
    ...(optional(form, 'targetDate') === undefined ? {} : { targetDate: new Date(optional(form, 'targetDate')!) }),
  });

  const state = await settle(result, '/projects');
  if (state.error) return state;
  if (result.state === 'ready') redirect(`/projects/${result.data.id}`);
  return state;
}
```

- [ ] **Step 6: Write the shared form components**

Create `apps/web/app/projects/forms.tsx`:

```tsx
'use client';
import { useFormStatus } from 'react-dom';
import type { FormState } from './form-state';

/** Disables itself while the action runs, so a slow API cannot be double-submitted. */
export function SubmitButton({ children, className = 'primary-button' }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending}>{pending ? 'Working…' : children}</button>;
}

export function FormError({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <p className="form-error" role="alert">
      {state.error}
      {state.correlationId ? <> <span className="subtle">({state.correlationId})</span></> : null}
    </p>
  );
}
```

- [ ] **Step 7: Write the list page**

Create `apps/web/app/projects/page.tsx`:

```tsx
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listProjects } from '../lib/project-api';

export default async function ProjectsPage() {
  const [projects, user] = await Promise.all([listProjects(), getCurrentUser()]);

  if (projects.state === 'unauthenticated') {
    return <main className="state-page"><section className="state-card"><h1>Sign in to see your projects</h1><a className="primary-button" href="/login">Sign in</a></section></main>;
  }
  if (projects.state === 'forbidden') {
    return <main className="state-page"><section className="state-card"><h1>Your account cannot view projects</h1><p>{projects.message}</p></section></main>;
  }
  if (projects.state === 'unavailable') {
    return <main className="state-page"><section className="state-card"><h1>Project API is not available</h1><p>{projects.message}</p></section></main>;
  }

  const mayCreate = user.state === 'ready' && hasPermission(user.data, 'project.create');

  return (
    <main className="app-shell">
      <section className="content">
        <header className="topbar"><div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Projects</strong></div></header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">ALL PROJECTS</p><h1>Projects</h1></div>
            {mayCreate ? <a className="primary-button" href="/projects/new">New project</a> : null}
          </div>
          <section className="panel">
            {projects.data.length === 0
              ? <div className="empty-list"><strong>No projects yet</strong><p>Create one to get started.</p></div>
              : <table className="data-table">
                  <thead><tr><th>Code</th><th>Name</th><th>Client</th><th>Status</th><th>Sites</th><th>Tasks</th><th></th></tr></thead>
                  <tbody>
                    {projects.data.map((project) => (
                      <tr key={project.id}>
                        <td><code>{project.code}</code></td>
                        <td><a href={`/projects/${project.id}`}>{project.name}</a></td>
                        <td>{project.clientName ?? '—'}</td>
                        <td><span className="badge green">{project.status}</span></td>
                        <td>{project._count.sites}</td>
                        <td>{project._count.tasks}</td>
                        <td className="row-actions"><a className="ghost-button" href={`/projects/${project.id}`}>Open</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>}
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 8: Write the create page**

Create `apps/web/app/projects/new/page.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { createProjectAction } from '../actions';
import { EMPTY } from '../form-state';
import { FormError, SubmitButton } from '../forms';

export default function NewProjectPage() {
  const [state, action] = useActionState(createProjectAction, EMPTY);

  return (
    <main className="app-shell">
      <section className="content">
        <header className="topbar"><div className="crumbs"><a href="/projects">Projects</a><b>/</b><strong>New</strong></div></header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header"><div><h2>New project</h2><p>A code cannot be changed after creation.</p></div></div>
            <form action={action} className="inline-form" style={{ display: 'block', padding: 20 }}>
              <div className="form-grid">
                <label className="field">Code<input name="code" required pattern="[A-Z0-9_\-]+" maxLength={50} /><span className="hint">Upper case, digits, dash or underscore.</span></label>
                <label className="field">Name<input name="name" required maxLength={200} /></label>
                <label className="field">Client<input name="clientName" maxLength={200} /></label>
                <label className="field">Phase<input name="phase" maxLength={100} /></label>
                <label className="field">Start date<input name="startDate" type="date" /></label>
                <label className="field">Target date<input name="targetDate" type="date" /></label>
              </div>
              <FormError state={state} />
              <p className="form-note">New projects start as <code>DRAFT</code>.</p>
              <SubmitButton>Create project</SubmitButton>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 9: Point the dashboard at the real page**

In `apps/web/app/page.tsx:27`, change `href="#projects"` on the welcome section's `primary-button` to `href="/projects"`. Leave the sidebar's `#projects` anchor alone, or change it to `/projects` as well — both are correct; be consistent.

- [ ] **Step 10: Verify**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit && npx next build`
Expected: tests pass, no type errors, build succeeds.

- [ ] **Step 11: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): browse and create projects

The API client has had these calls since the session work landed with no
caller; this is the first page to use them. Actions settle an ApiResult
into form state so a guarded refusal shows the service's own message."
```

---

## Task 11: `/projects/[id]` detail with inline sub-resource CRUD

Sites, task types, milestones and tasks are created, edited and deleted here rather than in route trees of their own: each is only ever read in the context of one project.

**Files:**
- Create: `apps/web/app/projects/[id]/page.tsx`
- Modify: `apps/web/app/projects/actions.ts`, `apps/web/app/projects/forms.tsx`

**Interfaces:**
- Consumes: `getProject`, `listTasks`, `createSite`, `updateSite`, `deleteSite`, `createTaskType`, `updateTaskType`, `deleteTaskType`, `createMilestone`, `updateMilestone`, `deleteMilestone`, `createTask`, `updateTask`, `deleteTask`, `assignTask`.
- Produces: the actions listed in Step 1, reused by no later task.

- [ ] **Step 1: Add the sub-resource actions**

Append to `apps/web/app/projects/actions.ts`:

```ts
import {
  createMilestone, createSite, createTask, createTaskType,
  deleteMilestone, deleteSite, deleteTask, deleteTaskType,
  updateMilestone, updateSite, updateTask, updateTaskType,
} from '../lib/project-api';

/** Every sub-resource action revalidates its project's page, which is the only page that renders it. */
const page = (projectId: string) => `/projects/${projectId}`;

export async function createSiteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const siteCode = optional(form, 'siteCode');
  const name = optional(form, 'name');
  if (!siteCode || !name) return { error: 'A site code and a name are required.' };
  return settle(await createSite(projectId, {
    siteCode, name,
    ...(optional(form, 'regionName') === undefined ? {} : { regionName: optional(form, 'regionName')! }),
    ...(optional(form, 'city') === undefined ? {} : { city: optional(form, 'city')! }),
  }), page(projectId));
}

export async function updateSiteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await updateSite(String(form.get('siteId')), {
    ...(optional(form, 'name') === undefined ? {} : { name: optional(form, 'name')! }),
    ...(optional(form, 'status') === undefined ? {} : { status: optional(form, 'status') as 'PLANNED' }),
  }), page(projectId));
}

export async function deleteSiteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteSite(String(form.get('siteId'))), page(projectId));
}

export async function createTaskTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const code = optional(form, 'code');
  const name = optional(form, 'name');
  const category = optional(form, 'category');
  if (!code || !name || !category) return { error: 'A code, a name and a category are required.' };
  return settle(await createTaskType(projectId, { code, name, category }), page(projectId));
}

export async function updateTaskTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await updateTaskType(String(form.get('taskTypeId')), {
    ...(optional(form, 'name') === undefined ? {} : { name: optional(form, 'name')! }),
    isActive: form.get('isActive') === 'on',
  }), page(projectId));
}

export async function deleteTaskTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteTaskType(String(form.get('taskTypeId'))), page(projectId));
}

export async function createMilestoneAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const code = optional(form, 'code');
  const name = optional(form, 'name');
  if (!code || !name) return { error: 'A code and a name are required.' };
  return settle(await createMilestone(projectId, {
    code, name,
    kind: (optional(form, 'kind') ?? 'PROJECT') as 'PROJECT' | 'CONTRACT',
    sequence: Number(optional(form, 'sequence') ?? 0),
    taskTypeIds: form.getAll('taskTypeIds').map(String),
  }), page(projectId));
}

export async function updateMilestoneAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await updateMilestone(String(form.get('milestoneId')), {
    ...(optional(form, 'name') === undefined ? {} : { name: optional(form, 'name')! }),
    taskTypeIds: form.getAll('taskTypeIds').map(String),
  }), page(projectId));
}

export async function deleteMilestoneAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteMilestone(String(form.get('milestoneId'))), page(projectId));
}

export async function createTaskAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const siteId = optional(form, 'siteId');
  const taskTypeId = optional(form, 'taskTypeId');
  const title = optional(form, 'title');
  if (!siteId || !taskTypeId || !title) return { error: 'A site, a task type and a title are required.' };
  return settle(await createTask(projectId, { siteId, taskTypeId, title, origin: 'AD_HOC' }), page(projectId));
}

export async function updateTaskAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const assignee = optional(form, 'assigneeId');
  return settle(await updateTask(String(form.get('taskId')), {
    ...(optional(form, 'title') === undefined ? {} : { title: optional(form, 'title')! }),
    ...(optional(form, 'status') === undefined ? {} : { status: optional(form, 'status') as 'ONGOING' }),
    // An empty assignee field means "unassign", which is null rather than absent.
    ...(form.has('assigneeId') ? { assigneeId: assignee ?? null } : {}),
  }), page(projectId));
}

export async function deleteTaskAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteTask(String(form.get('taskId'))), page(projectId));
}
```

- [ ] **Step 2: Add the row-action component**

Append to `apps/web/app/projects/forms.tsx`. The file already imports `FormState`; extend its existing import lines rather than adding duplicates, so the head of the file reads:

```tsx
'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  createMilestoneAction, createSiteAction, createTaskAction, createTaskTypeAction,
} from './actions';
import { EMPTY, type FormState } from './form-state';
```

Then append:

```tsx
/**
 * A one-button form for a destructive row action.
 *
 * A form rather than a link because a GET must not delete anything, and a
 * `confirm` because the row gives no other chance to stop.
 */
export function RowAction({
  action, hidden, fields, label, confirm, className = 'danger-button',
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  fields?: React.ReactNode;
  label: string;
  confirm?: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY);
  return (
    <form action={formAction} onSubmit={(event) => { if (confirm && !window.confirm(confirm)) event.preventDefault(); }}>
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {fields}
      <SubmitButton className={className}>{label}</SubmitButton>
      <FormError state={state} />
    </form>
  );
}
```

- [ ] **Step 3: Write the detail page**

Create `apps/web/app/projects/[id]/page.tsx`. It is a Server Component that fetches, and delegates each interactive block to the client components above:

```tsx
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { getProject, listTasks } from '../../lib/project-api';
import {
  createMilestoneAction, createSiteAction, createTaskAction, createTaskTypeAction,
  deleteMilestoneAction, deleteSiteAction, deleteTaskAction, deleteTaskTypeAction,
} from '../actions';
import { RowAction } from '../forms';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, tasks, user] = await Promise.all([getProject(id), listTasks(id), getCurrentUser()]);

  if (project.state === 'unauthenticated') {
    return <main className="state-page"><section className="state-card"><h1>Sign in</h1><a className="primary-button" href="/login">Sign in</a></section></main>;
  }
  if (project.state !== 'ready') {
    return <main className="state-page"><section className="state-card"><h1>Cannot show this project</h1><p>{project.message}</p></section></main>;
  }

  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  const data = project.data;
  const taskList = tasks.state === 'ready' ? tasks.data : [];

  return (
    <main className="app-shell">
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/projects">Projects</a><b>/</b><strong>{data.code}</strong></div>
          {may('project.update') ? <a className="ghost-button" href={`/projects/${data.id}/edit`}>Edit project</a> : null}
        </header>

        <div className="dashboard">
          <section className="welcome">
            <div>
              <p className="eyebrow">{data.status}</p>
              <h1>{data.name}</h1>
              <p className="subtle">{data.clientName ?? 'No client'}{data.phase ? ` · ${data.phase}` : ''}</p>
            </div>
          </section>

          <section className="panel" id="sites">
            <div className="panel-header"><div><h2>Sites</h2><p>{data.sites.length} in this project</p></div></div>
            <table className="data-table">
              <thead><tr><th>Code</th><th>Name</th><th>Region</th><th>City</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {data.sites.map((site) => (
                  <tr key={site.id}>
                    <td><code>{site.siteCode}</code></td>
                    <td>{site.name}</td>
                    <td>{site.region?.name ?? '—'}</td>
                    <td>{site.city ?? '—'}</td>
                    <td><span className="badge">{site.status}</span></td>
                    <td className="row-actions">
                      {may('site.delete')
                        ? <RowAction
                            action={deleteSiteAction}
                            hidden={{ projectId: data.id, siteId: site.id }}
                            label="Delete"
                            confirm={`Delete site ${site.siteCode}? This cannot be undone.`}
                          />
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {may('site.create')
              ? <CreateSiteForm projectId={data.id} />
              : null}
          </section>

          <section className="panel" id="tasks">
            <div className="panel-header"><div><h2>Tasks</h2><p>{taskList.length} in this project</p></div></div>
            <table className="data-table">
              <thead><tr><th>Title</th><th>Site</th><th>Status</th><th>Assignee</th><th></th></tr></thead>
              <tbody>
                {taskList.map((task) => (
                  <tr key={task.id}>
                    <td>{task.title}</td>
                    <td>{data.sites.find((s) => s.id === task.siteId)?.siteCode ?? '—'}</td>
                    <td><span className="badge">{task.status}</span></td>
                    <td>{task.assigneeId ?? 'Unassigned'}</td>
                    <td className="row-actions">
                      {may('task.delete')
                        ? <RowAction
                            action={deleteTaskAction}
                            hidden={{ projectId: data.id, taskId: task.id }}
                            label="Delete"
                            confirm={`Delete task "${task.title}"?`}
                          />
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {may('task.create') ? <CreateTaskForm projectId={data.id} sites={data.sites} /> : null}
          </section>

          <section className="panel" id="milestones">
            <div className="panel-header"><div><h2>Milestones</h2><p>{data.milestones.length} declared</p></div></div>
            <table className="data-table">
              <thead><tr><th>#</th><th>Code</th><th>Name</th><th>Kind</th><th>Requires</th><th></th></tr></thead>
              <tbody>
                {data.milestones.map((milestone) => (
                  <tr key={milestone.id}>
                    <td>{milestone.sequence}</td>
                    <td><code>{milestone.code}</code></td>
                    <td>{milestone.name}</td>
                    <td>{milestone.kind}</td>
                    <td>{milestone.requirements.length} task type(s)</td>
                    <td className="row-actions">
                      {may('milestone.update')
                        ? <RowAction
                            action={deleteMilestoneAction}
                            hidden={{ projectId: data.id, milestoneId: milestone.id }}
                            label="Delete"
                            confirm={`Delete milestone ${milestone.code}?`}
                          />
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {may('milestone.create') ? <CreateMilestoneForm projectId={data.id} /> : null}
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Return task types from `getProject`**

The task and milestone forms both need the project's task types, and `getProject` does not return them. In `apps/project/src/project/project.service.ts:9`, add to the `include`:

```ts
taskTypes: { orderBy: { order: 'asc' } },
```

And widen the type in `apps/web/app/lib/project-api.ts:88`:

```ts
export type ProjectDetail = Project & {
  sites: (Site & { region: Region | null })[];
  taskTypes: TaskType[];
  milestones: (Milestone & { requirements: MilestoneRequirement[] })[];
  _count: { tasks: number };
};
```

- [ ] **Step 5: Add the task types panel to the detail page**

Task types are CRUD-able like everything else. Insert this section between the sites and tasks panels in `apps/web/app/projects/[id]/page.tsx`:

```tsx
          <section className="panel" id="task-types">
            <div className="panel-header"><div><h2>Task types</h2><p>{data.taskTypes.length} defined</p></div></div>
            <table className="data-table">
              <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Order</th><th>Active</th><th></th></tr></thead>
              <tbody>
                {data.taskTypes.map((taskType) => (
                  <tr key={taskType.id}>
                    <td><code>{taskType.code}</code></td>
                    <td>{taskType.name}</td>
                    <td>{taskType.category}</td>
                    <td>{taskType.order}</td>
                    <td>{taskType.isActive ? 'Yes' : 'No'}</td>
                    <td className="row-actions">
                      {may('task.update')
                        ? <RowAction
                            action={deleteTaskTypeAction}
                            hidden={{ projectId: data.id, taskTypeId: taskType.id }}
                            label="Delete"
                            confirm={`Delete task type ${taskType.code}?`}
                          />
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {may('task.create') ? <CreateTaskTypeForm projectId={data.id} /> : null}
          </section>
```

- [ ] **Step 6: Write the four create forms**

All four go in `apps/web/app/projects/forms.tsx`, each a `useActionState` over its action:

```tsx
export function CreateSiteForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(createSiteAction, EMPTY);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">Site code<input name="siteCode" required pattern="[A-Z0-9_\-]+" maxLength={50} /></label>
      <label className="field">Name<input name="name" required maxLength={200} /></label>
      <label className="field">Region<input name="regionName" maxLength={150} /></label>
      <label className="field">City<input name="city" maxLength={100} /></label>
      <SubmitButton>Add site</SubmitButton>
      <FormError state={state} />
    </form>
  );
}

export function CreateTaskTypeForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(createTaskTypeAction, EMPTY);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">Code<input name="code" required pattern="[A-Z0-9_\-]+" maxLength={50} /></label>
      <label className="field">Name<input name="name" required maxLength={200} /></label>
      <label className="field">Category<input name="category" required maxLength={100} /></label>
      <SubmitButton>Add task type</SubmitButton>
      <FormError state={state} />
    </form>
  );
}

export function CreateTaskForm({
  projectId, sites, taskTypes,
}: {
  projectId: string;
  sites: { id: string; siteCode: string; name: string }[];
  taskTypes: { id: string; code: string; name: string; isActive: boolean }[];
}) {
  const [state, action] = useActionState(createTaskAction, EMPTY);
  const active = taskTypes.filter((t) => t.isActive);
  if (sites.length === 0 || active.length === 0) {
    return <p className="form-note" style={{ padding: 16 }}>Add a site and an active task type before creating tasks.</p>;
  }
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">Site
        <select name="siteId" required defaultValue="">
          <option value="" disabled>Choose a site</option>
          {sites.map((site) => <option key={site.id} value={site.id}>{site.siteCode} — {site.name}</option>)}
        </select>
      </label>
      <label className="field">Task type
        <select name="taskTypeId" required defaultValue="">
          <option value="" disabled>Choose a task type</option>
          {active.map((type) => <option key={type.id} value={type.id}>{type.code} — {type.name}</option>)}
        </select>
      </label>
      <label className="field">Title<input name="title" required maxLength={250} /></label>
      <SubmitButton>Add task</SubmitButton>
      <FormError state={state} />
    </form>
  );
}

export function CreateMilestoneForm({
  projectId, taskTypes,
}: {
  projectId: string;
  taskTypes: { id: string; code: string; name: string }[];
}) {
  const [state, action] = useActionState(createMilestoneAction, EMPTY);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">Code<input name="code" required pattern="[A-Z0-9_\-]+" maxLength={50} /></label>
      <label className="field">Name<input name="name" required maxLength={200} /></label>
      <label className="field">Kind
        <select name="kind" defaultValue="PROJECT"><option value="PROJECT">Project</option><option value="CONTRACT">Contract</option></select>
      </label>
      <label className="field">Sequence<input name="sequence" type="number" min={0} defaultValue={0} required /></label>
      <label className="field">Requires
        <select name="taskTypeIds" multiple size={3}>
          {taskTypes.map((type) => <option key={type.id} value={type.id}>{type.code}</option>)}
        </select>
        <span className="hint">Leave empty for none.</span>
      </label>
      <SubmitButton>Add milestone</SubmitButton>
      <FormError state={state} />
    </form>
  );
}
```

The page passes `taskTypes={data.taskTypes}` to `CreateTaskForm` and `CreateMilestoneForm`, and `sites={data.sites}` to the former.

- [ ] **Step 7: Verify**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit && npx next build`
Expected: all green. A type error on `data.taskTypes` means Step 4's two changes were missed.

- [ ] **Step 8: Verify against the running stack**

Run: `cd /Volumes/kedar/webprojects/iPMS && docker compose -f docker/docker-compose.yml up -d`
Then, in another shell: `cd apps/web && npx next dev`

Sign in, open `/projects`, create a project, open it, add a site, add a task type, add a task, then try to delete the site. Expected: the delete is refused with "This site still has 1 task(s). Delete them first." — the message from `deleteSite`, proving the envelope from Task 1 reaches the browser. Delete the task, then the site: both succeed.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app apps/project/src/project/project.service.ts apps/web/app/lib/project-api.ts
git commit -m "feat(web): project detail with inline site, task type, task and milestone CRUD

Sub-resources are edited where they are read rather than in route trees of
their own. getProject now includes task types, which the task form needs
to offer a choice."
```

---

## Task 12: `/projects/[id]/edit` with archive and guarded delete

**Files:**
- Create: `apps/web/app/projects/[id]/edit/page.tsx`
- Modify: `apps/web/app/projects/actions.ts`

**Interfaces:**
- Consumes: `getProject`, `updateProject`, `archiveProject`, `deleteProject`; `settle`, `optional`.
- Produces: `updateProjectAction`, `archiveProjectAction`, `deleteProjectAction`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/app/projects/actions.spec.ts`:

```ts
const deleteProject = vi.fn();
vi.mock('../lib/project-api', () => ({
  deleteProject,
  createProject: vi.fn(), updateProject: vi.fn(), archiveProject: vi.fn(),
  createSite: vi.fn(), updateSite: vi.fn(), deleteSite: vi.fn(),
  createTaskType: vi.fn(), updateTaskType: vi.fn(), deleteTaskType: vi.fn(),
  createMilestone: vi.fn(), updateMilestone: vi.fn(), deleteMilestone: vi.fn(),
  createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(),
}));

const { deleteProjectAction } = await import('./actions');

describe('deleteProjectAction', () => {
  it('refuses before calling the API when the typed code does not match', async () => {
    const form = new FormData();
    form.set('projectId', 'p-1');
    form.set('code', 'ALPHA');
    form.set('confirmCode', 'ALPH');
    const state = await deleteProjectAction({}, form);
    expect(state.error).toMatch(/type the project code/i);
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('calls the API when the typed code matches', async () => {
    deleteProject.mockResolvedValue({ state: 'ready', data: undefined });
    const form = new FormData();
    form.set('projectId', 'p-1');
    form.set('code', 'ALPHA');
    form.set('confirmCode', 'ALPHA');
    await expect(deleteProjectAction({}, form)).rejects.toThrow('NEXT_REDIRECT');
    expect(deleteProject).toHaveBeenCalledWith('p-1');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/web && npx vitest run app/projects/actions.spec.ts`
Expected: FAIL — `deleteProjectAction is not exported`.

- [ ] **Step 3: Implement the three actions**

Append to `apps/web/app/projects/actions.ts`:

```ts
import { archiveProject, deleteProject, updateProject } from '../lib/project-api';

export async function updateProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await updateProject(projectId, {
    ...(optional(form, 'name') === undefined ? {} : { name: optional(form, 'name')! }),
    ...(optional(form, 'clientName') === undefined ? {} : { clientName: optional(form, 'clientName')! }),
    ...(optional(form, 'phase') === undefined ? {} : { phase: optional(form, 'phase')! }),
    ...(optional(form, 'status') === undefined ? {} : { status: optional(form, 'status') as 'ACTIVE' }),
  }), `/projects/${projectId}`);
}

export async function archiveProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await archiveProject(projectId), `/projects/${projectId}`);
}

/**
 * The irreversible one.
 *
 * The typed code is checked here as well as in the browser, because the
 * browser's check is a convenience and this one is the gate. The service
 * refuses anyway while tasks remain; this stops the wrong project going even
 * when it is empty.
 */
export async function deleteProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  if (optional(form, 'confirmCode') !== optional(form, 'code')) {
    return { error: 'To delete this project, type the project code exactly.' };
  }
  const state = await settle(await deleteProject(projectId), '/projects');
  if (state.error) return state;
  redirect('/projects');
}
```

- [ ] **Step 4: Run the test**

Run: `cd apps/web && npx vitest run app/projects/actions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the edit page**

Create `apps/web/app/projects/[id]/edit/page.tsx` — a Server Component that loads the project and permissions, and renders three client forms:

```tsx
import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { getProject } from '../../../lib/project-api';
import { ArchiveForm, DeleteProjectForm, EditProjectForm } from '../../forms';

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, user] = await Promise.all([getProject(id), getCurrentUser()]);

  if (project.state === 'unauthenticated') {
    return <main className="state-page"><section className="state-card"><h1>Sign in</h1><a className="primary-button" href="/login">Sign in</a></section></main>;
  }
  if (project.state !== 'ready') {
    return <main className="state-page"><section className="state-card"><h1>Cannot edit this project</h1><p>{project.message}</p></section></main>;
  }

  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  const data = project.data;

  return (
    <main className="app-shell">
      <section className="content">
        <header className="topbar"><div className="crumbs"><a href="/projects">Projects</a><b>/</b><a href={`/projects/${data.id}`}>{data.code}</a><b>/</b><strong>Edit</strong></div></header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header"><div><h2>Project details</h2><p>The code cannot be changed.</p></div></div>
            <EditProjectForm project={data} />
          </section>

          {may('project.archive')
            ? <section className="panel">
                <div className="panel-header"><div><h2>Archive</h2><p>Sets the status to CANCELLED. Nothing is destroyed, and it can be set back.</p></div></div>
                <ArchiveForm projectId={data.id} />
              </section>
            : null}

          {may('project.delete')
            ? <section className="panel confirm-card">
                <h2>Delete permanently</h2>
                <p className="form-note">
                  This destroys the project and its sites, task types and milestones. It is refused while
                  any task remains — delete those first, or archive instead.
                </p>
                <DeleteProjectForm projectId={data.id} code={data.code} />
              </section>
            : null}
        </div>
      </section>
    </main>
  );
}
```

Add the three client components to `apps/web/app/projects/forms.tsx`. `DeleteProjectForm` carries both the real code (hidden) and the typed one:

```tsx
export function DeleteProjectForm({ projectId, code }: { projectId: string; code: string }) {
  const [state, action] = useActionState(deleteProjectAction, EMPTY);
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="code" value={code} />
      <label className="field">
        Type <code>{code}</code> to confirm
        <input name="confirmCode" autoComplete="off" required />
      </label>
      <FormError state={state} />
      <SubmitButton className="danger-button">Delete this project</SubmitButton>
    </form>
  );
}
```

And the other two:

```tsx
const STATUSES = ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;

export function EditProjectForm({ project }: { project: ProjectDetail }) {
  const [state, action] = useActionState(updateProjectAction, EMPTY);
  return (
    <form action={action} style={{ padding: 20 }}>
      <input type="hidden" name="projectId" value={project.id} />
      <div className="form-grid">
        <label className="field">Code<input value={project.code} readOnly disabled /><span className="hint">Fixed at creation.</span></label>
        <label className="field">Name<input name="name" defaultValue={project.name} required maxLength={200} /></label>
        <label className="field">Client<input name="clientName" defaultValue={project.clientName ?? ''} maxLength={200} /></label>
        <label className="field">Phase<input name="phase" defaultValue={project.phase ?? ''} maxLength={100} /></label>
        <label className="field">Status
          <select name="status" defaultValue={project.status}>
            {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
      </div>
      <FormError state={state} />
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}

export function ArchiveForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(archiveProjectAction, EMPTY);
  return (
    <form action={action} style={{ padding: 20 }}>
      <input type="hidden" name="projectId" value={projectId} />
      <SubmitButton className="ghost-button">Archive this project</SubmitButton>
      <FormError state={state} />
    </form>
  );
}
```

`forms.tsx` now also imports `archiveProjectAction`, `deleteProjectAction` and `updateProjectAction` from `./actions`, and `type ProjectDetail` from `../lib/project-api` — add them to the import lines written in Task 11, Step 2.

Note that `ProjectDetail` is a type-only import from a `server-only` module. That is safe — types are erased — but the import must be written `import type { ProjectDetail } from '../lib/project-api';`, or the `'server-only'` marker at the top of that file will fail the client build.

- [ ] **Step 6: Verify**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit && npx next build`
Expected: all green.

- [ ] **Step 7: Verify the guard against the running stack**

With the stack up and a project that has at least one task, open `/projects/<id>/edit` as a `SUPER_ADMIN`, type the code, and submit.
Expected: the form shows "This project still has N task(s). Delete them, or archive the project instead." Delete the tasks and sites, then repeat.
Expected: the project is deleted and the browser lands on `/projects`.

As a `PROJECT_MANAGER`, the delete panel is absent and the archive panel is present.

- [ ] **Step 8: Run everything**

Run: `cd /Volumes/kedar/webprojects/iPMS && npx nx run-many -t test typecheck lint`
Expected: green across `@ipms/authz`, `@ipms/contracts`, `@ipms/observability`, `gateway`, `iam`, `project`, `web`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): edit, archive and delete a project

Deletion asks for the project's code to be typed, and the action checks it
server-side as well: the browser's check is a convenience, this one is the
gate."
```

---

## Definition of done

1. Projects, sites, task types, milestones and tasks can each be created, browsed, edited and deleted from the browser.
2. Every guard has a test that asserts the refusal, not only the success: project-with-tasks, site-with-tasks, task-type-in-use, task-with-submission, and the typed-code mismatch.
3. `project.delete` exists in the catalogue, depends on `project.archive`, and is held by `SUPER_ADMIN` only.
4. `/api/v1/sites`, `/api/v1/task-types` and `/api/v1/milestones` resolve to the `project` upstream, and no `/internal/` path resolves under them.
5. The `project` service registers `GlobalExceptionFilter`, so a 409 reaches the browser as a message the user can act on.
6. `npx nx run-many -t test typecheck lint` is green.
7. No page or action reads a cookie; every call goes through `authFetch`.
