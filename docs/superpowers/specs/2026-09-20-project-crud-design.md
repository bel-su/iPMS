# iPMS — Project CRUD Design

**Status:** Approved
**Date:** 2026-09-20
**Parent spec:** `2026-09-15-ipms-microservices-architecture-design.md` §7.1
**Related plan:** `2026-09-19-project-tracking.md` (Tasks 7–9 rework the same service methods)

---

## 1. Context

The web app can sign a user in and render one dashboard. Everything else the
Project service can do is unreachable from a browser.

The client layer is not the gap. `apps/web/app/lib/` already holds `api-client.ts`,
`project-api.ts`, `iam-api.ts`, `qc-api.ts` and `session.ts`, with 80 passing tests
and token renewal wired through `proxy.ts`. `listProjects`, `getProject`,
`createProject`, `createSite`, `createTaskType`, `createMilestone`, `createTask` and
`assignTask` are written, typed against `@ipms/contracts`, and have no caller outside
their own specs. The dashboard's "View projects" button is an `#projects` anchor.

The gap is in two places: **pages that call those functions**, and **endpoints that do
not exist yet**. `ProjectService` has create for every entity, update for projects
only, and no delete of anything.

### 1.1 Scope

**In:** browse, create, edit and delete for projects, sites, task types, milestones and
tasks — the endpoints each needs, the contracts schemas, the gateway allowlist entries,
and the web pages and Server Actions that drive them.

**Out:** the scope projection and query-level enforcement of Tasks 7–9 of the tracking
plan; per-site milestone instances (`SiteMilestone`); bulk task generation; anything
in `qc`. Real-Postgres integration tests stay in Task 8 where the plan already puts
them.

### 1.2 Known interaction with the tracking plan

Tasks 7–9 rewrite every `ProjectService` method to take an `AuthzScope` as its first
argument and to filter at query level. This design deliberately builds on the unscoped
service. The cost is a later mechanical edit to methods that by then exist and are
tested; the alternative was a large backend effort before any new screen appears. This
was decided explicitly, not by omission.

---

## 2. Decisions

**D1 — Projects are archived; hard deletion is guarded.** The permission catalogue in
`libs/authz/src/permissions.ts` offers `project.archive` and deliberately no
`project.delete`, while `schema.prisma` cascades Project → regions, sites, task types,
milestones and tasks. A hard delete therefore destroys the entire tree silently.
Archiving (status → `CANCELLED`) is the normal action; a real `DELETE` exists, requires
a newly added `project.delete` permission, and is refused while any task remains.

**D2 — Sub-resources are edited inline on the project detail page.** Sites, task types,
milestones and tasks are always read in the context of one project. Separate route
trees would mean four more layouts for forms of four fields each.

**D3 — Writes go through Server Actions.** The access token is in an http-only cookie
that only server code may read, so actions reuse `authFetch` unchanged and forms
submit without client JavaScript — the property sign-out already depends on. Route
handlers plus client `fetch` would duplicate every error mapping; a client-side store
would need a token in the browser, which the session design exists to prevent.

**D4 — New backend code is tested against a stubbed Prisma client.** `apps/project` has
no test setup at all today. Stubs cover the guard rules and permission decorators
immediately; standing up Testcontainers is a sub-project of its own and Task 8 already
owns it.

**D5 — Project-level milestones live at `/api/v1/milestones`.** The tracking plan
reserves `/api/v1/site-milestones` for per-site milestone *instances*, a different
entity. Keeping the two prefixes distinct avoids a collision when that lands.

---

## 3. Backend

### 3.1 Reads

`GET /projects/:id/tasks`, requiring `task.view`, filterable by `siteId` and `status`.
There is currently no way to list tasks by any route; browse is impossible without it.

Existing reads are unchanged: `GET /dashboard`, `GET /projects`, `GET /projects/:id`.

### 3.2 Update schemas

New in `libs/contracts/src/project/project.ts`, each a `.partial()` of its create
schema plus the field only an update can set:

| Schema | Adds |
|---|---|
| `UpdateSiteSchema` | `status: SiteStatusSchema` |
| `UpdateTaskTypeSchema` | `isActive: boolean` |
| `UpdateMilestoneSchema` | `taskTypeIds` replaces the requirement set wholesale |
| `UpdateTaskSchema` | `status: TaskStatusSchema`, nullable `assigneeId` |

`UpdateProjectSchema` already exists and is unchanged.

### 3.3 Deletes and their guards

| Target | Route | Permission | Refused when |
|---|---|---|---|
| Project | `POST /projects/:id/archive` | `project.archive` | never — the normal path |
| Project | `DELETE /projects/:id` | `project.delete` (new) | any task still exists |
| Site | `DELETE /sites/:id` | `site.delete` | any task references the site |
| Task type | `DELETE /task-types/:id` | `task.update` | tasks reference it — already enforced by `onDelete: Restrict` |
| Milestone | `DELETE /milestones/:id` | `milestone.update` | never; requirements cascade |
| Task | `DELETE /tasks/:id` | `task.delete` | it has a `currentSubmissionId` — QC evidence exists; the caller is told to cancel instead |

A refused delete answers `409` with the platform error envelope, so the UI can say why
rather than reporting a generic failure.

### 3.4 Update routes

`PATCH /sites/:id`, `PATCH /task-types/:id`, `PATCH /milestones/:id`, `PATCH /tasks/:id`.
Sub-resources are addressed by their own id rather than nested under a project, because
the id is unique and the nesting would add a redundant ownership check on every call.

### 3.5 Permission catalogue

`def('project', 'delete', 'Delete a project', ['project.view', 'project.archive'])` is
added to `permissions.ts`. The iam role seed must grant it, or no role can hold it and
the endpoint is permanently unreachable.

### 3.6 Gateway

`/api/v1/sites`, `/api/v1/task-types` and `/api/v1/milestones` are added to `ROUTES` in
`apps/gateway/src/proxy/routes.ts`, all pointing at `PROJECT`. Without them those paths
404 at the edge regardless of what the service serves.

---

## 4. Web

### 4.1 Routes

```
/projects              list with status filter, "New project"
/projects/new          create form
/projects/[id]         detail — header, sites, task types, milestones, tasks
/projects/[id]/edit    project fields, archive, delete
```

### 4.2 Actions

`app/projects/actions.ts` holds one Server Action per mutation. Each calls the matching
`project-api` function and then `revalidatePath`. `ApiResult` maps to form state:

- `unauthenticated` → redirect to `/login`
- `forbidden` → inline "your account cannot do this", with the message from the envelope
- `unavailable` → the message plus its correlation ID
- `ready` → revalidate and, for creates, redirect to the new record

### 4.3 Permission-gated controls

Destructive and mutating controls are hidden using `hasPermission` from `iam-api.ts`.
This is for clarity only — the gateway and the service guards are what enforce access,
and the UI never assumes its own check was sufficient.

Hard-deleting a project requires typing the project's code into a confirmation field.

---

## 5. Testing

| Layer | Approach |
|---|---|
| `apps/project` | New vitest setup; controller and service specs against a stubbed Prisma client, covering every guard in §3.3 and every permission decorator |
| `apps/gateway` | Extend `routes.spec.ts` for the three new prefixes, including that they are not reachable under `/internal/` |
| `apps/web` | Specs in the style of the existing 80: action error mapping, and that each `project-api` call targets the right path and method |

Real-Postgres integration coverage is out of scope here and remains Task 8's.

---

## 6. Definition of done

1. Every entity in §1.1 can be created, browsed, edited and deleted from the browser.
2. Every guard in §3.3 is covered by a test that asserts the refusal, not just the success.
3. `project.delete` exists in the catalogue and is held by at least one seeded role.
4. The three new gateway prefixes are reachable and `/internal/` remains unreachable.
5. `pnpm test` is green across `apps/project`, `apps/gateway` and `apps/web`.
6. No page reads a cookie directly; every call still goes through `authFetch`.
