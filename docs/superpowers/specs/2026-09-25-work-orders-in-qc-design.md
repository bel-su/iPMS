# iPMS — Work Orders in QC

**Date:** 2026-09-25
**Supersedes:** the ownership parts of `2026-09-24-work-order-management-design.md` (W1, W2, W6, status sync)

## 1. Why

`project` owns projects and their sites. Work orders are QC checklists assigned to sites. Keeping them as `project` tasks meant:

- status had to travel from qc to project over NATS, on two durables that could deliver out of order;
- qc had to call project to authorize every checklist and submission.

Everything a work order is about already lived in qc (the template, the submissions, the reviews) except the work order itself.

## 2. Ownership

| Service | Owns |
|---|---|
| `project` | Projects, sites, regions, task types, milestones, planned tasks, the replicated scope projection |
| `qc` | Checklist templates, **work orders** and their timeline, submissions, reviews |

## 3. Data

`qc.work_order` holds one checklist assigned to one site. It keeps `projectId` and `siteId`, which scope filters on the same way project's own rows do. It also copies the project's code and name and the site's code, name, city and area at the moment it is raised. The queue can then list, search and group rows without a call per row. A later site rename does not change existing work orders.

`qc.work_order_event` is the timeline. It is written in the same transaction as the change it records.

Submissions keep their `taskId` column, which now holds the work order id. Ids were kept across the move.

## 4. How qc and project talk

Every call forwards the caller's own bearer token, so project answers with the caller's permissions and scope. The gateway refuses every `/internal/` path.

| Call | Used for | Failure |
|---|---|---|
| `GET project /internal/scope` | Every work order read: the caller's replicated scope | 503. There is no safe list without it |
| `POST project /internal/projects/:id/site-refs` | Create: which requested sites the caller can see, plus their names | 503 / 404 |
| `GET project /projects/:id/assignable` | Create and reassign: the assignee must reach every site | 503 |
| `GET qc /internal/work-orders/usage` | Project and site delete: refused while work orders remain | Delete refused (503) |
| `GET project /internal/sites/:id/geofence` | Submission geofence (unchanged) | Recorded as `UNVERIFIED` |

Status no longer crosses services. A submission moves its work order to `REVIEWING`, and a review moves it to `COMPLETED` or `RECTIFYING`. Each happens in the same transaction. `qc.submission.*` events are still published, and nothing consumes them yet.

## 5. API

The gateway routes `/api/v1/work-orders` to qc.

- `GET /work-orders`: the queue, with status counts
- `GET /work-orders/by-project/:projectId`: every work order of a project in brief, for its dashboard
- `GET /work-orders/:id`: detail with timeline
- `POST /work-orders`: `{ projectId, workOrderType, templateId, siteIds, assigneeId, plannedCompletionAt, note? }`
- `PATCH /work-orders/:id` and `POST /work-orders/:id/cancel`: unchanged

`GET /api/v1/projects/:id/assignable` replaces `/projects/:id/work-orders/assignable`. The project dashboard endpoint no longer returns review and rework counts; the web reads them from the work order counts.

## 6. Migration

1. `qc-migrate` creates the tables. It then runs `prisma/import-project-work-orders.ts`, which copies project's work orders and timelines with their ids. The import is idempotent and fails loudly.
2. `project-migrate` depends on `qc-migrate` in Compose. It deletes the work order rows and drops the work order columns and `work_order_event`. If you run the migrations by hand, run the import first.

## 7. Web

The Quality & EHS sidebar group contains two pages:

- **Checklist library** (`/quality/templates`): templates you author and publish.
- **Work orders** (`/quality/work-orders`): checklists assigned to sites.

`/quality` opens on work orders. Old `/work-orders` links redirect with their filters. The project overview combines its planned tasks with qc's work orders for that project.

## 8. Known gaps

- The copied site and project names are not refreshed when project renames them. A `project.site.updated` event consumed by qc would close this.
- Scope is fetched from project on each work order read. Replicating it into qc, as project does from iam, would remove that call.
