# iPMS Sub-project 2 — Project & Tracking Design

**Status:** Approved
**Date:** 2026-09-19
**Parent spec:** `2026-09-15-ipms-microservices-architecture-design.md` §7.1, §8, §11
**Depends on:** Sub-project 1 (platform foundation), complete

---

## 1. Context

Sub-project 1 delivered the platform foundation: the five shared libraries, `gateway`,
`iam`, `audit`, the Compose stack, and CI. Authorization and the audit ledger work.

This sub-project delivers `project` — the service that answers the question the
platform exists to answer: *is every site on track for its milestones, and can we
prove the work was done?*

### 1.1 The starting position

`apps/project`, `apps/qc` and `apps/web` already contain code, landed in a single
commit (`033af6c`) under the message *"build: generate Next.js build artifacts and
standalone output"*. That code has no spec, no plan, and no tests. It is treated here
as a **throwaway spike**: its Prisma schema is largely faithful to §7.1 and is reused
where correct, and everything else is rebuilt test-first.

Three properties of the spike drove that decision.

**It has no scope enforcement.** `check()` in `@ipms/authz` returns `allowed: true` as
soon as the permission is held when no `resource` is passed, and `AuthzGuard` never
passes one. That is deliberate — §6 places the real boundary at query level. But
neither `project` nor `qc` applies `scopeWhere` to any query, so today any user holding
`project.view` lists every project and every site in the system regardless of their
assigned scope. This is a live authorization defect, not an unfinished stub.

**It is missing the core model.** There is no `SiteMilestone`, so milestone eligibility
and achievement — the primary read of the system per D10 — cannot be expressed at all.
There is no `TaskTypeDependency` either.

**It has no asynchronous surface.** Neither service depends on `@ipms/events`. Nothing
consumes `iam.scope.*` despite the `project-scope-cache` durable consumer already being
declared in `STREAMS.IAM`, and nothing reacts to a QC submission, so a task can never
leave `NOT_STARTED` by any means other than a direct write.

### 1.2 Scope

**In:** the `project` service, complete — regions, sites, task types with dependencies
and variant-resolved templates, milestones and requirements, tasks, bulk generation,
the `SiteMilestone` lifecycle, the replicated scope projection, the QC submission
consumer, audit emission, and `/internal/authz/explain`.

**Out:** `qc`, `media`, `notification`, `docs`, `docs-web`, `mobile`, and the web
console. The QC *event contract* is declared here (§5.2) because `project` consumes it;
the QC *service* is sub-project 3.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| P1 | Rebuild the spike test-first, reusing its schema where faithful to §7.1 | The missing `SiteMilestone` and the absent scope filtering are not increments on the existing code; they change its shape |
| P2 | An empty scope projection denies, and is rebuilt by explicit replay | Fail-closed is the only safe reading of "no scope"; §6 forbids putting `iam` on the hot path |
| P3 | `TaskTypeTemplate(task_type_id, scope_variant, template_id)` resolves the checklist | §4's *Antenna + RRU / RRU Only / Board + Jumper* finding does not fit a single `TaskType.template_id` |
| P4 | Dependency blocking is computed, and refuses the `NOT_STARTED → ONGOING` transition | Consistent with D10 — nothing stored, nothing to drift — while still letting a PM pre-assign blocked work |
| P5 | Declare `qc.submission.*` now and build the consumer now | The producer in sub-project 3 then meets a contract its consumer has already proven, exactly as the foundation pre-declared `project-scope-cache` |
| P6 | `qc` is quarantined from the gateway and Compose until sub-project 3 | It exposes unfiltered queries; leaving it routed ships a known authorization hole |
| P7 | The partial unique constraint on planned tasks lives in the database | The spike enforces it with a read-then-write in application code, which two concurrent bulk generations race through |

---

## 3. Domain model

Reused from the spike, unchanged in shape: `Project`, `Region`, `Site`, `TaskType`,
`Milestone`, `MilestoneRequirement`, `Task`. The additions and corrections follow.

### 3.1 New models

```
TaskTypeDependency    task_type_id · prerequisite_task_type_id
                      PRIMARY KEY (task_type_id, prerequisite_task_type_id)
                      CHECK (task_type_id <> prerequisite_task_type_id)

TaskTypeTemplate      task_type_id · scope_variant · template_id
                      UNIQUE (task_type_id, scope_variant)

SiteMilestone         id · site_id · milestone_id · status
                      target_date · eligible_at · achieved_at · declared_by
                      UNIQUE (site_id, milestone_id)

UserScope             user_id · level · project_id · site_id
                      three partial unique indexes — see below
```

`UserScope` uniqueness follows the convention `iam` established for `UserRole` in
commit `f9da4c5`. A single `UNIQUE (user_id, level, project_id, site_id)` does not
work: Postgres treats `NULL` as never equal to `NULL` in a unique index, so only the
fully site-scoped shape would ever be protected and duplicate global grants would
insert freely. Three partial unique indexes are added as raw SQL instead, and no
`@@unique` is declared in `schema.prisma`, so a future `prisma migrate dev` does not
try to "correct" them away:

```sql
CREATE UNIQUE INDEX user_scope_global_uniq ON user_scope (user_id)
  WHERE level = 'GLOBAL';
CREATE UNIQUE INDEX user_scope_project_uniq ON user_scope (user_id, project_id)
  WHERE level = 'PROJECT';
CREATE UNIQUE INDEX user_scope_site_uniq ON user_scope (user_id, site_id)
  WHERE level = 'SITE';
```

`TaskTypeTemplate` is a lookup, not a replacement: `TaskType.template_id` remains the
fallback used when a site has no `scope_variant`, or when no row matches the one it
has. A task type whose checklist does not vary by variant needs no rows at all.

`UserScope` is the local projection of `iam`'s authoritative scope grants. It is
written only by the event consumer (§5.1) and never by a request handler.

### 3.2 Corrections to the spike's schema

**The planned-task uniqueness constraint moves into the database.** §7.1 specifies
`UNIQUE(site_id, task_type_id) WHERE origin = 'PLANNED'`. The spike checks for an
existing row and then inserts, which two concurrent bulk generations interleave
through, producing duplicate planned tasks. Prisma cannot express a partial unique
index, so it is added as raw SQL in the migration:

```sql
CREATE UNIQUE INDEX task_planned_site_type_uniq
  ON task (site_id, task_type_id)
  WHERE origin = 'PLANNED';
```

**Task status becomes a constrained vocabulary.** `NOT_STARTED`, `ONGOING`,
`REVIEWING`, `COMPLETED`, `RECTIFYING`, `CANCELLED` — a database `CHECK`, so an event
handler cannot write a status the domain does not have.

**`Task.createdBy` and the milestone columns gain indexes** matching the queries in §6.

### 3.3 SiteMilestone lifecycle

```
NOT_STARTED → IN_PROGRESS → ELIGIBLE → ACHIEVED
                                ▲           ▲
              all required tasks COMPLETED  PM declares
              (computed)                    (actor + timestamp → audit)
```

`ELIGIBLE` is computed and written by recomputation (§6.2). `ACHIEVED` is a
declaration: it requires `milestone.declare`, records `declared_by` and `achieved_at`,
and is refused unless the row is currently `ELIGIBLE`. Regression is permitted — if a
completed task is reopened, an `ELIGIBLE` row falls back to `IN_PROGRESS`; an
`ACHIEVED` row does not, because a declaration is a formal act that is withdrawn
explicitly, not implicitly.

Project-level progress is never stored. It is the query in §7.1:

```sql
SELECT COUNT(*) FILTER (WHERE status = 'ACHIEVED')::float / NULLIF(COUNT(*), 0)
FROM site_milestone WHERE milestone_id = $1;
```

---

## 4. Authorization

### 4.1 Query-level enforcement

Every list and every read spreads `scopeWhere(scope)` into its Prisma `where`. This is
mandatory and is the defect the spike embodies. A read of a single resource by id that
falls outside scope returns `404`, not `403`, per §6's response discipline — the
existence of a site the caller cannot see is not disclosed.

`AuthzGuard` remains a permission-only gate. It is not weakened, but it is not
sufficient either, and the tests in §8 assert the query-level boundary directly rather
than trusting the guard.

### 4.2 A latent defect in `scopeWhere`

`scopeWhere` currently ANDs its two clauses:

```ts
const where: ScopeWhere = { projectId: { in: scope.projectIds } };
if (scope.siteIds.length > 0) where.siteId = { in: scope.siteIds };
```

A user scoped to *project A* and additionally to *site B in project C* matches nothing:
the row for site B fails the `projectId` test, and every row in project A fails the
`siteId` test. Project-level and site-level grants are alternatives, not conjuncts.

This is corrected in `@ipms/authz` as part of this sub-project, to an OR of the two
grants, with a regression test. It is in scope because `project` is the first service
whose users hold both grant levels at once — `iam` and `audit` never exercised it.

### 4.3 The access simulator

`POST /internal/authz/explain` accepts a user id, a permission, and an optional
resource id. It loads the resource, loads the caller's projected scope, and calls the
same `check()` the guard calls, returning `AuthzDecision` with its `checks` chain. It
must not reimplement any rule. The route is unreachable through the gateway: §5's route
table refuses any path containing `/internal/`.

---

## 5. Events

### 5.1 Consumed

| Subject | Durable | Effect |
|---|---|---|
| `iam.scope.granted` | `project-scope-cache` | Upsert a `UserScope` row |
| `iam.scope.revoked` | `project-scope-cache` | Delete the matching `UserScope` row |
| `iam.role.assigned` | `project-scope-cache` | Upsert the scope implied by a scoped role assignment |
| `iam.role.removed` | `project-scope-cache` | Delete the rows the assignment implied |
| `iam.user.deactivated` | `project-scope-cache` | Delete every `UserScope` row for that user |
| `qc.submission.submitted` | `project-qc-tasks` | Task → `REVIEWING`, record `current_submission_id` |
| `qc.submission.approved` | `project-qc-tasks` | Task → `COMPLETED`, set `actual_completion_at`, recompute the site's milestones |
| `qc.submission.rejected` | `project-qc-tasks` | Task → `RECTIFYING` |

Every handler is idempotent on `eventId` through the existing `RedisDedupeStore`, and
every handler is a no-op when the task it names is already in the target state — a
redelivery after `COMPLETED` must not re-run recomputation and re-emit
`project.milestone.eligible`.

**Cold start.** `DurableConsumer` creates its durable with `DeliverPolicy.All`, so a
*new* durable replays the stream from the beginning. An *existing* durable resumes from
its stored position, which is wrong when the projection database has been rebuilt
underneath it. `project` therefore records a `projection_watermark` row alongside
`UserScope`; on startup, if the projection is empty and the watermark is absent, it
deletes and recreates the `project-scope-cache` durable so the replay is genuine. The
7-day retention on `STREAMS.IAM` bounds what a replay can recover; beyond that, a
`iam`-side re-emit is the documented recovery, and an empty projection denies in the
meantime.

### 5.2 The QC contract, declared here

Added to `@ipms/events` as `payloads/qc.ts`, with a `QC` stream definition carrying the
`project-qc-tasks` durable:

```ts
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
  overallVerdict: 'PASS';
}

export interface QcSubmissionRejected {
  submissionId: string;
  taskId: string;
  siteId: string;
  projectId: string;
  attemptNo: number;
  reviewedBy: string;
  reason: string;
}
```

Sub-project 3 implements the producer against this contract.

### 5.3 Published

`project.task.created`, `project.task.assigned`, `project.milestone.eligible`,
`project.milestone.achieved` — all on a `PROJECT` stream, all with no consumer until
`notification` exists in sub-project 4. They are published now because the
recomputation that produces them is built now, and a stream with no consumer is
harmless while a retrofit is not.

Every mutating operation additionally publishes `audit.event.recorded` with the
existing `AuditEventPayload`, carrying `previousState` and `newState`. Publication is
part of the same transaction boundary as the write, through the outbox helper in
`@ipms/persistence`, so a crash between commit and publish cannot lose an audit record.

---

## 6. Behaviour

### 6.1 Bulk generation

`POST /projects/:id/milestones/:milestoneId/generate`, requiring `task.generate`.

For each site in the project that is within the caller's scope, for each task type
required by the milestone: resolve the template — `TaskTypeTemplate` by the site's
`scope_variant`, falling back to `TaskType.template_id` — and insert a `PLANNED` task
if one does not already exist for that `(site, task_type)`.

Idempotence comes from the partial unique index, not from a pre-read: the insert uses
`ON CONFLICT DO NOTHING`, so concurrent runs converge instead of racing. The response
reports created and skipped counts per site.

Adding a site later and re-running gives that site its tasks and changes nothing else.
A task type with no resolvable template is reported as skipped with a reason rather
than failing the whole run — partial scope is more useful than an aborted batch.

### 6.2 Milestone recomputation

Triggered when a task reaches or leaves `COMPLETED`. For the affected site, for each
milestone whose requirements include that task's type:

- no required task exists, or none is started → `NOT_STARTED`
- some progress, not all complete → `IN_PROGRESS`
- every required task type has a `COMPLETED` task → `ELIGIBLE`, stamp `eligible_at`,
  publish `project.milestone.eligible`
- already `ACHIEVED` → unchanged

Recomputation is a pure function of the site's tasks, so running it twice is
indistinguishable from running it once. That is what makes the at-least-once delivery
in §5.1 safe.

### 6.3 Dependency blocking

A task is blocked when any prerequisite of its task type has no `COMPLETED` task at the
same site. It is computed per read and returned as `blocked: boolean` with the list of
outstanding prerequisites. `PATCH /tasks/:id` refuses `NOT_STARTED → ONGOING` on a
blocked task with `409`. Assignment is never refused, so a PM can plan ahead.

---

## 7. HTTP surface

All under the gateway's existing `/api/v1/projects`, `/api/v1/tasks` and
`/api/v1/dashboard` prefixes. Permissions are the ones already in the catalog; none are
added.

| Method | Path | Permission |
|---|---|---|
| `GET` | `/dashboard` | `project.view` |
| `GET` `POST` | `/projects` | `project.view` · `project.create` |
| `GET` `PATCH` | `/projects/:id` | `project.view` · `project.update` |
| `GET` `POST` | `/projects/:id/sites` | `site.view` · `site.create` |
| `PATCH` `DELETE` | `/sites/:id` | `site.update` · `site.delete` |
| `GET` `POST` | `/projects/:id/task-types` | `project.view` · `task.create` |
| `POST` | `/task-types/:id/dependencies` | `task.update` |
| `POST` | `/task-types/:id/templates` | `task.update` |
| `GET` `POST` | `/projects/:id/milestones` | `milestone.view` · `milestone.create` |
| `POST` | `/projects/:id/milestones/:mid/generate` | `task.generate` |
| `GET` | `/projects/:id/milestones/:mid/progress` | `milestone.view` |
| `GET` | `/sites/:id/milestones` | `milestone.view` |
| `POST` | `/site-milestones/:id/declare` | `milestone.declare` |
| `GET` `POST` | `/projects/:id/tasks` | `task.view` · `task.create` |
| `GET` `PATCH` | `/tasks/:id` | `task.view` · `task.update` |
| `POST` | `/tasks/:id/assign` | `task.assign` |
| `POST` | `/tasks/:id/cancel` | `task.cancel` |
| `POST` | `/internal/authz/explain` | none — unreachable through the gateway |

Request and response shapes are Zod schemas in `@ipms/contracts`, extending the
`project/project.ts` module the spike started.

---

## 8. Testing

Per §10.2 of the parent spec.

**Unit.** Milestone recomputation across every transition including the `ACHIEVED`
no-op; dependency blocking with diamond and multi-level prerequisite graphs; template
resolution including both fallback paths; the corrected `scopeWhere` OR semantics.

**Integration,** against real Postgres and NATS via Testcontainers. The partial unique
index under two concurrent bulk generations of the same milestone. The scope projection
consumer, including a redelivered event and a `iam.user.deactivated` clearing every
row. Each of the three `UserScope` partial unique indexes rejects its own duplicate
shape while global, project-scoped and site-scoped grants for one user coexist —
the assertion `iam` needed and initially lacked. Cold start: wipe the projection, restart, assert the durable is recreated and the
projection rebuilds. The QC consumer driving a task to `COMPLETED` and the milestone to
`ELIGIBLE`, then redelivering the same event and asserting no second
`project.milestone.eligible`.

**Security,** the most valuable suite. For every list endpoint, a user scoped to
project A must not see project B's rows. For every read-by-id, a resource outside scope
returns `404` and not `403`. A `FIELD_ENGINEER` receives `403` on `task.generate`. A
site id from another project is refused on task creation. `/internal/authz/explain` is
unreachable through the gateway. These are the tests the spike would fail today.

**Audit.** After every mutating endpoint, the corresponding `audit.event.recorded` is
published, and `GET /audit/verify` still reports the chain intact.

---

## 9. Cleanup carried by this sub-project

Small, and all of it blocking a green build or closing a known hole.

1. `apps/gateway/src/proxy/routes.spec.ts:20` asserts `/api/v1/projects` resolves to no
   upstream, which stopped being true when the project route was added. The test is
   stale, not the code.
2. 233 Next.js build artifacts are committed under `apps/web/.next/`. They are removed
   from the index and `.next/` is added to `.gitignore`.
3. `project:test` and `qc:test` currently fail with *"No test files found"*.
   `project` gains real tests here. `qc` is quarantined (§P6): removed from the gateway
   route table and the Compose stack, its code left in the tree as reference for
   sub-project 3.
4. `apps/project` and `apps/qc` are missing `@ipms/events` as a dependency. `project`
   gains it.

---

## 10. Definition of done

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
- [ ] Every mutation appears in the audit ledger and the chain verifies
- [ ] The access simulator's verdict matches real enforcement, with its check chain
- [ ] `qc` is unreachable through the gateway until sub-project 3

---

## 11. Assumptions

1. `Task.template_id` and `TaskTypeTemplate.template_id` reference `qc` templates that
   do not exist yet. They are stored unvalidated in this sub-project; the synchronous
   write-time validation §8 of the parent spec requires is added in sub-project 3, when
   there is a `qc` to ask.
2. `iam` currently emits scope events but has no re-emit endpoint. The documented
   recovery beyond the 7-day stream retention is therefore manual until sub-project 3
   adds one; an empty projection denies safely in the meantime.
3. Region is created implicitly by name during site creation, as the spike does. No
   region management API is added — nothing in the domain asks for one yet.
4. The web console is not updated. Sub-project 2 is verified through its HTTP API and
   the E2E suite, not through a UI.
