# iPMS — Microservices Architecture Design

**Status:** Approved
**Date:** 2026-09-15
**Supersedes:** the modular-monolith architecture of `PMS` (Django/DRF + React/Vite)

---

## 1. Context

`PMS` is a Django modular monolith serving telecom and civil field operations:
project → site → task, dynamic QC checklists, camera-only geotagged photo evidence,
and a cryptographic audit ledger. `iPMS` rebuilds that capability as a microservices
platform on NestJS, Next.js, Flutter, and PostgreSQL.

This is a **greenfield rewrite**. `PMS` is a reference for domain rules only. No data
is migrated, no API compatibility is preserved, and the two systems never run
concurrently.

The domain was additionally validated against ZTE **IEPMS**, the incumbent system the
team uses for the Nepal Ncell Wireless Project. Structural learnings from that review
are recorded in §4 and drive several model decisions.

### 1.1 What the system is for

Track every milestone of a project to its target date, and deliver the project with
verified quality.

A project (e.g. *Ncell Phase 14*) contains many sites (KOS121, KOS232, …). Each site
carries quality checklists — the tasks. Field teams complete a checklist on site by
entering values and capturing photographic evidence. A Project Manager or QC Manager
verifies and approves the submission. A milestone (e.g. *CW RFI*) is achieved **for a
site** once all of its required tasks are approved; project-level milestone progress is
the proportion of sites that have achieved it.

### 1.2 Drivers

1. Independent team and deployment velocity.
2. Selective scale and isolation — the photo pipeline has a different load profile
   from CRUD.
3. Stack modernisation — Django → NestJS, React/Vite → Next.js.

### 1.3 Operating constraints

| Constraint | Value |
|---|---|
| Tenancy | Single organisation. No tenant dimension anywhere |
| Users | Company staff and its own field teams only. No subcontractor scoping |
| Scale | Hundreds of sites per project, tens of concurrent field users, 500–2 000 photos/day |
| Deployment | Docker Compose on a single VPS |
| Team | Not yet settled; design must not assume a large team |

---

## 2. Non-goals

These are deliberately excluded. Each was considered and rejected with reasoning.

- **Configurable DAG workflow engine.** The approval flow is fixed
  (submit → review → approve/reject-for-rework). PMS carried a full workflow service
  with versions, nodes, transitions and condition expressions; nothing in the domain
  justifies it. A fixed state machine inside `qc` replaces it, removing one service,
  one database, and the hardest dimension of the authorization model.
- **Subcontractor / responsible-company scoping.** IEPMS treats this as a first-class
  authorization dimension. iPMS is used by one company for its own staff, so scope
  remains global / project / site / assigned-resource.
- **Automated spot-check sampling.** IEPMS samples a percentage of self-checked work
  for independent audit, configured through a dedicated settings module. iPMS instead
  makes **task creation generic**: a Project Manager or QC Manager creates any task at
  any time. A spot check is an ad-hoc task using a spot-check template — one mechanism
  covers both planned scope and ad-hoc inspection.
- **Multi-tenancy.** No `organization_id`, no tenant filter. Introducing it later is a
  schema migration, accepted knowingly.
- **Kubernetes, service mesh, distributed tracing infrastructure.** Compose on a VPS.
  Services stay k8s-ready (§10.3) without paying for k8s now.
- **Project technical document management** (drawings, BOQ, as-builts). The `docs`
  service covers platform documentation only.
- **GraphQL.** REST + JSON, consistent with the contract-first approach in §5.2.
- **Data migration from PMS.** Greenfield.

---

## 3. Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | 8 services, domain-aligned | Every boundary is a bounded context, not a size target |
| D2 | Approvals merged into `qc` | An approval is a review decision on a submission; separating them puts a network hop on every authority check |
| D3 | `Task` lives in `project`, not `qc` | The sites × milestones dashboard is the primary read of the system; it must resolve in local SQL |
| D4 | `media` is its own service | CPU-bound, bursty thumbnail/hash work with a load profile unlike CRUD |
| D5 | `audit` is its own service with a single writer | A SHA-256 hash chain requires strictly serialized appends and genuine immutability |
| D6 | Database-per-service, one Postgres instance | Logical isolation enforced by grants; splitting instances later is a connection-string change |
| D7 | NATS JetStream | ~15 MB footprint, first-class NestJS transport, persistent streams with replay |
| D8 | Hybrid authorization (§6) | Avoids both fat-JWT bloat and a central PDP on the hot path |
| D9 | Nx monorepo | Shared contracts, affected-only builds, atomic cross-service changes |
| D10 | Milestone achieved per site; project progress is a query | Nothing stored, nothing to drift |
| D11 | Task-type-level dependencies | "Foundation before erection" is a rule about work, not about KOS121 |
| D12 | IEPMS status vocabulary | Users already think in these words |

---

## 4. Domain findings from IEPMS

Recorded because several materially changed the model.

| Finding | Consequence |
|---|---|
| Checklists are a **sectioned hierarchy** (`1. EHS On Site` → `1.1 …`) | `ChecklistItem` needs a parent `ChecklistSection`; a flat item list is insufficient |
| **Per-item dual verdict** — field sets *Self-check Result*, reviewer sets *Review Result*, each with a description | Review moves to item level with a submission-level rollup |
| Items carry a **`(Critical)`** classification | `severity: NORMAL \| CRITICAL` on the item definition |
| Items can be marked **N/A** (2nd/3rd sector absent at a site) | Third response state beyond pass/fail |
| Each photo item has a **Sample Picture** | `sample_photo_media_id` on the item — field guidance |
| Every photo displays **distance from site** ("5.54 meters away from the site") | Server computes photo-GPS → site-GPS distance and stores it |
| Watermark carries employee ID, site code, site name, lat/long, timestamp | Confirms the watermark specification |
| Template lifecycle tabs: **Enabled / Draft Box / Disabled**, version in name | `status: DRAFT → ENABLED → DISABLED`, versioned |
| **Excel download/export** on template management | Checklists are authored in Excel, not a web form |
| Template Type: **Quality** vs **EHS** | Parallel checklist families; `category` on the template |
| Status set includes **Rectifying** | Confirms the rework branch |
| Three templates for one project scope (*Antenna + RRU* / *RRU Only* / *Board + Jumper*) | Sites differ in scope; checklist assignment is scope-driven, not blanket |
| **Download Photo Package** bulk action | Evidence export is a real deliverable |
| **Contract Milestone** and **Project Milestone** are separate | `Milestone.kind` distinguishes commercial from execution |

---

## 5. Service topology

| Service | Owns | Database |
|---|---|---|
| `gateway` | Edge routing, JWT verification, rate limiting, correlation IDs, CORS | none |
| `iam` | User, Role, Permission, RolePermission, UserRole, project/site scope, permission overrides, access simulator | `ipms_iam` |
| `project` | Project, Region, Site, TaskType, TaskTypeDependency, Milestone, MilestoneRequirement, Task, SiteMilestone | `ipms_project` |
| `qc` | ChecklistTemplate, ChecklistSection, ChecklistItem, Submission, ItemResponse, ItemPhoto, ReviewDecision | `ipms_qc` |
| `media` | Presigned uploads, SHA-256 hashing, watermark verification, geofence distance, thumbnails | `ipms_media` |
| `audit` | Append-only SHA-256 hash chain, integrity verification | `ipms_audit` |
| `notification` | In-app notification, FCM push, email, device tokens | `ipms_notification` |
| `docs` | Platform documentation content, versions, search index | `ipms_docs` |

**Clients:** `web` (Next.js — PM/admin console, field read-only view), `docs-web`
(Next.js — documentation site), `mobile` (Flutter — field capture).

### 5.1 Repository layout

```
ipms/
├── apps/
│   ├── gateway/  iam/  project/  qc/  media/  audit/  notification/  docs/
│   ├── web/                    Next.js — PM & admin console
│   ├── docs-web/               Next.js — documentation site
│   └── mobile/                 Flutter — field capture
├── libs/
│   ├── contracts/              HTTP DTOs, enums, zod schemas, OpenAPI emit
│   ├── events/                 NATS subjects, payload types, publisher/consumer
│   ├── authz/                  the authorization decision function
│   ├── persistence/            Prisma base, migration conventions, tx helpers
│   └── observability/          logging, correlation IDs, metrics, health probes
├── docker/                     Dockerfiles, compose stacks
└── docs/superpowers/           specs and plans
```

### 5.2 Shared libraries

**`@ipms/contracts`** — the synchronous API surface. Zod schemas and inferred types
for every request and response. The implementing service validates with the schema;
callers and the Next.js app import the types. Emits an OpenAPI document, which
generates the Dart client for Flutter.

**`@ipms/events`** — the asynchronous surface. Every NATS subject, its versioned
payload type, typed publish/subscribe helpers, JetStream stream and consumer
configuration, retry and dead-letter policy, `eventId` deduplication, and
correlation-ID propagation.

Kept separate from `contracts` because the consumers differ: the web app needs
contracts and must never pull in NATS client types; `audit` consumes nearly every
event and almost no HTTP contracts.

**`@ipms/authz`** — the authorization decision function (§6), in exactly one place.

**`@ipms/persistence`** — Prisma client base, migration conventions, transaction and
outbox helpers. **`@ipms/observability`** — structured logging, correlation-ID
propagation, metrics, and health-probe wiring. Both are infrastructure plumbing rather
than domain surface, and are shared to keep eight services behaving identically.

**Accepted tradeoff:** shared libraries are a coupling point — a `contracts` change can
break eight services at once. Nx's affected graph makes that visible and rebuilds only
what a change touches, which is preferable to discovering the mismatch at runtime.
A future polyrepo split turns these into versioned npm packages.

---

## 6. Authorization

PMS resolved authorization in one query:
`permission + project scope + site scope + assignment + resource state`.
Split across services, that decomposes into three parts in three places. The model
splits the problem **by volatility**.

| Part | Where it lives | How it travels |
|---|---|---|
| Identity, roles, permission codes | `iam` | Signed JWT claims — small and stable |
| Project / site scope | `iam` (authoritative) | Replicated to each service over NATS, cached in Redis |
| Assignment and resource state | The service owning the resource | Answered locally |

**JWT claims:** `sub`, `roles`, `permissions` (codes), `tokenVersion`, `exp` (15 min).
Access tokens are short-lived with refresh; scope lists are never embedded — a PM with
400 sites would produce a multi-kilobyte token on every request.

**Revocation** is immediate via a `tokenVersion` stamp in Redis, checked at the
gateway. Bumping a user's version invalidates every outstanding token.

**Scope replication:** `iam` emits `iam.scope.granted` / `iam.scope.revoked` /
`iam.role.assigned` / `iam.role.removed`. `project` and `qc` maintain a local
projection and a Redis cache. Propagation is seconds; the accepted staleness window is
bounded by NATS delivery, not by token expiry.

**The decision function:**

```ts
const decision = await authz.check({
  user: ctx.user,                            // JWT claims
  permission: 'qc.submission.approve',
  resource: submission,                      // owned locally
  scope: await scopeCache.for(ctx.user),     // NATS-replicated
});
```

**Query-level enforcement is mandatory.** Services filter at the query level —
never fetch-all-then-filter. This is what prevents ID enumeration and accidental
exposure.

**Access Simulator:** `iam` orchestrates calls to each service's
`POST /internal/authz/explain`, which runs the *same* `authz.check` and returns the
reasoning chain. The simulator cannot drift from real enforcement because it is not a
separate implementation.

**Response discipline:** `401` unauthenticated, `403` authenticated but not
authorized, `404` when object-level authorization fails on a resource whose existence
should not be disclosed.

**Roles:** `SUPER_ADMIN`, `PROJECT_MANAGER`, `QC_MANAGER`, `FIELD_ENGINEER`, `VIEWER`
as system roles, plus the full custom-role machinery from PMS — role cloning,
permission dependencies, scoped assignment with validity windows, and time-bounded
`ALLOW`/`DENY` user overrides with a mandatory reason. Every role, permission, scope,
and override change is audited.

**Frontend permission checks are UX only and are never a security boundary.**

---

## 7. Domain models

### 7.1 `project`

```
Project           id · code · name · client_name · phase · status
                  start_date · target_date

Region            id · project_id · name                      (Area / City grouping)

Site              id · project_id · region_id · site_code · name
                  latitude · longitude · geofence_radius_m
                  address · city · area · scope_variant · status
                  UNIQUE(project_id, site_code)

TaskType          id · project_id · code · name · category
                  template_id → qc · order · is_active
                  UNIQUE(project_id, code)

TaskTypeDependency        task_type_id · prerequisite_task_type_id

Milestone         id · project_id · code · name
                  kind: PROJECT | CONTRACT · sequence · target_date

MilestoneRequirement      milestone_id · task_type_id
                  UNIQUE(milestone_id, task_type_id)

Task              id · project_id · site_id · task_type_id · template_id
                  title · status · assignee_id
                  planned_completion_at · actual_completion_at
                  current_submission_id · origin: PLANNED | AD_HOC
                  created_by
                  UNIQUE(site_id, task_type_id) WHERE origin = 'PLANNED'

SiteMilestone     id · site_id · milestone_id · status
                  target_date · eligible_at · achieved_at · declared_by
                  UNIQUE(site_id, milestone_id)
```

**Task status:** `NOT_STARTED → ONGOING → REVIEWING → COMPLETED`, with `RECTIFYING`
as the rework branch and `CANCELLED` as a terminal state. IEPMS vocabulary,
deliberately.

**`origin`** distinguishes planned scope from ad-hoc work. The unique constraint
applies only to `PLANNED` tasks, so a site can carry any number of ad-hoc spot checks
without colliding with its planned checklist.

**`scope_variant`** on `Site` drives which template a site receives during bulk
generation — the *Antenna + RRU* / *RRU Only* / *Board + Jumper* distinction.

**SiteMilestone lifecycle:**

```
NOT_STARTED → IN_PROGRESS → ELIGIBLE → ACHIEVED
                                ▲           ▲
              all required tasks COMPLETED  PM declares
              (computed)                    (actor + timestamp → audit)
```

`ELIGIBLE` is computed; `ACHIEVED` is declared. Achievement is a formal act with an
accountable actor, which is how RFI milestones work in practice.

**Project-level milestone progress is a query, never a stored column:**

```sql
SELECT COUNT(*) FILTER (WHERE status = 'ACHIEVED')::float / COUNT(*)
FROM site_milestone WHERE milestone_id = $1;
```

**Bulk generation.** "Generate CW RFI scope for all sites" iterates the milestone's
required task types, resolves each site's `scope_variant` to a template, and creates
the missing tasks. It is idempotent — re-running creates nothing that already exists.
Adding a site later and re-running gives that site its required tasks.

### 7.2 `qc`

```
ChecklistTemplate  id · project_id · code · name
                   category: QUALITY | EHS | OTHER
                   version · status: DRAFT | ENABLED | DISABLED
                   published_at · created_by · source: WEB | EXCEL_IMPORT
                   UNIQUE(project_id, code, version)

ChecklistSection   id · template_id · number · title · order

ChecklistItem      id · section_id · number · requirement_text
                   severity: NORMAL | CRITICAL
                   response_type: RESULT_ONLY | TEXT | NUMBER | BOOLEAN | SELECT
                   requires_photo · min_photos · max_photos
                   allows_na · is_required
                   sample_photo_media_id · guidance_text · order · config JSONB

Submission         id · task_id · site_id · project_id
                   template_id · template_version · attempt_no
                   status: DRAFT | SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED_REWORK
                   overall_verdict: PASS | FAIL
                   submitted_by · submitted_at
                   reviewed_by · reviewed_at · review_comment
                   integrity_hash · idempotency_key · device_id
                   UNIQUE(task_id, attempt_no)
                   UNIQUE(idempotency_key)

ItemResponse       id · submission_id · item_id
                   self_check_result: PASS | FAIL | NA
                   self_check_description
                   text_value · number_value · boolean_value · select_value
                   review_result: PENDING | APPROVED | REJECTED | NA
                   review_description · reviewed_by · reviewed_at

ItemPhoto          id · item_response_id · media_id · content_hash · sequence
                   latitude · longitude · captured_at
                   distance_from_site_m · watermark_verified
                   file_size_bytes · thumbnail_url

ReviewDecision     id · submission_id · reviewer_id
                   decision: APPROVE | REJECT_REWORK · comment · decided_at
```

**Review is per item with a submission rollup.** A reviewer sets `review_result` on
each item, then issues one `ReviewDecision` for the submission. Rejection requires a
comment. A `CRITICAL` item with `review_result = REJECTED` forces
`overall_verdict = FAIL` and blocks approval.

**Templates are immutable once `ENABLED`.** Edits create a new version. Submissions
record `template_version`, so historical evidence always renders against the checklist
that was actually in force.

**Excel round-trip.** Export produces a workbook of sections and items; import parses
it into a `DRAFT` template. Import is validated and reports errors per row without
partial application. The web editor refines drafts. Both paths converge on the same
model; `source` records which was used.

**Submission integrity hash** is computed over the ordered item responses and the set
of photo content hashes, binding evidence to verdict.

**Rectification.** A rejected submission moves the task to `RECTIFYING`. The engineer's
next submission is a new attempt (`attempt_no + 1`) against the same task. Attempts
are immutable and retained in full — the review console shows attempt history.

### 7.3 `audit`

```
AuditEvent   id · sequence (monotonic) · actor_id · action
             object_type · object_id
             previous_state JSONB · new_state JSONB
             request_id · correlation_id
             previous_hash · chain_hash · details JSONB · timestamp
```

`chain_hash = SHA256(previous_hash ‖ canonical_json(event_body))`.

**Single writer.** Every service publishes to one JetStream subject with exactly one
durable consumer in `audit`. No service writes to the ledger directly. This is the
only arrangement under which the chain stays verifiable. There are no update or delete
permissions on audit records — `audit.view` and `audit.verify` only.

### 7.4 `media`, `notification`, `docs`

```
MediaObject   id · storage_key · content_type · size_bytes
              content_hash · thumbnail_key · status
              uploaded_by · captured_at · latitude · longitude
              watermark_verified · created_at

Notification  id · recipient_id · type · title · body · action_url
              is_read · read_at · created_at
DevicePushToken  id · user_id · token · platform · is_active

Document      id · slug · title · category · summary · body_md
              version · is_published · updated_by · updated_at
DocumentVersion  id · document_id · version · body_md · created_at
```

---

## 8. Events

Subjects are `<service>.<entity>.<action>`. Every payload carries `eventId`,
`occurredAt`, `version`, and `correlationId`. Every consumer is idempotent on
`eventId`.

| Subject | Consumers | Effect |
|---|---|---|
| `qc.submission.submitted` | `project`, `notification` | Task → `REVIEWING`; alert reviewer |
| `qc.submission.approved` | `project`, `notification` | Task → `COMPLETED`; recompute `SiteMilestone`; alert engineer |
| `qc.submission.rejected` | `project`, `notification` | Task → `RECTIFYING`; alert engineer with reason |
| `project.task.created` | `notification` | Alert assignee |
| `project.task.assigned` | `notification` | Alert new assignee |
| `project.milestone.eligible` | `notification` | PM may declare achievement |
| `project.milestone.achieved` | `notification` | Broadcast |
| `media.photo.processed` | `qc` | Attach hash, thumbnail, geofence distance |
| `media.photo.rejected` | `qc`, `notification` | Validation failed; flag the response |
| `iam.scope.granted` / `.revoked` | `project`, `qc` | Refresh local scope projection |
| `iam.role.assigned` / `.removed` | `project`, `qc` | Refresh local scope projection |
| `audit.event` | `audit` | Append to hash chain (single durable consumer) |

**Cross-service references** (`Task.template_id`, `ItemPhoto.media_id`) are plain UUIDs
with no foreign key. They are validated synchronously at write time and never joined
on afterwards.

**Delivery semantics:** at-least-once with consumer-side deduplication. Failed
consumption retries with exponential backoff and lands in a dead-letter stream after
exhaustion, with an operator alert.

---

## 9. Field evidence pipeline

### 9.1 Capture (Flutter)

1. **Live camera only.** Gallery selection is not offered. Non-negotiable — it is the
   basis of non-repudiation.
2. On shutter: capture GPS, UTC timestamp, site code, site name, and employee ID.
3. Composite a visible watermark carrying those five values.
4. Downscale and compress to a **300–600 KB** target payload.
5. Queue locally in SQLite with the submission draft.

### 9.2 Sync and validation

```
Flutter ──presign──► media ──► returns PUT URL
Flutter ──PUT─────► R2 / S3                       (service is not in the byte path)
Flutter ──confirm─► media
                    ├─ validate image integrity
                    ├─ compute SHA-256 content hash
                    ├─ compute distance from site coordinates
                    ├─ verify watermark presence
                    └─ generate 320 px thumbnail
                          └── emits media.photo.processed
                                    └──► qc binds hash into submission.integrity_hash
```

`distance_from_site_m` is computed server-side from the photo's GPS against the site's
coordinates and stored on `ItemPhoto`. Photos beyond the site's `geofence_radius_m` are
flagged for reviewer attention — flagged, not rejected, because GPS in dense urban and
hilly terrain is imperfect and the reviewer is the right judge.

**Photo package export** produces a zip of a site's or task's evidence with a manifest
of hashes, timestamps, coordinates, and distances.

### 9.3 Offline conflict resolution

**Server wins, engineer notified.** Server state is authoritative. A conflicting local
edit is rejected, the queued submission is preserved on device, and the engineer is
shown why. Every sync request carries an **idempotency key**, so retries over a flaky
connection never duplicate a submission. Submission attempts are append-only, so a
rejected sync is never silent data loss.

---

## 10. Cross-cutting

### 10.1 Observability

Structured JSON logs with a `correlationId` generated at the gateway and propagated
through every HTTP call and event payload, so one field submission is traceable across
`qc` → `media` → `project` → `notification` → `audit`. Each service exposes
`/health/live`, `/health/ready`, and Prometheus metrics. Logs aggregate to a single
Loki instance in the Compose stack.

### 10.2 Testing

- **Unit** — domain logic, especially `@ipms/authz` and milestone recomputation.
- **Integration** — each service against a real Postgres and NATS via Testcontainers.
- **Contract** — every `@ipms/contracts` schema is exercised by both provider and
  consumer; consumer-driven contract tests catch breaking changes in CI.
- **Security** — IDOR attempts, project/site ID manipulation, scope escalation,
  expired override, denied override, and frontend-bypass attempts. Ported from the PMS
  security suite, which is the most valuable artefact the old system leaves behind.
- **Audit** — chain remains verifiable after every mutating operation.
- **E2E** — Playwright against the Compose stack for the critical path: bulk generate →
  assign → field submit → review → approve → milestone eligible → declare.

### 10.3 Deployment

One Compose stack: 8 services, Postgres, NATS JetStream, Redis, Loki, and a reverse
proxy terminating TLS.

**The rule that keeps k8s reachable:** no Compose-specific coupling. No shared volumes
between services, no `localhost` assumptions, no cross-service database access, all
configuration through environment variables. Each service is a distinct image with its
own health probes and graceful shutdown. Moving to Kubernetes is then writing
manifests, not redrawing seams.

One Postgres instance with a database per service and a **separate role per service
that can only see its own database**. Cross-service joins are prevented by the grant,
not by discipline. Splitting to separate instances later is a dump, restore, and
connection-string change.

### 10.4 Security

TLS everywhere. Argon2id password hashing. Short-lived access tokens with refresh
rotation. Rate limiting at the gateway. Input validation via `@ipms/contracts` schemas
at every boundary. Secrets from environment, never committed. Presigned URLs scoped to
a single object with a short expiry. Security headers and strict CORS at the gateway.

---

## 11. Delivery decomposition

Too large for a single implementation plan. Five sub-projects, each with its own
spec → plan → implementation cycle.

| # | Sub-project | Contents | Depends on |
|---|---|---|---|
| 1 | **Platform foundation** | Nx monorepo, `@ipms/contracts`, `@ipms/events`, `@ipms/authz`, `@ipms/persistence`, `@ipms/observability`, `gateway`, `iam`, `audit`, Compose stack, CI | — |
| 2 | **Project & tracking** | `project` — regions, sites, task types, dependencies, milestones, requirements, tasks, bulk generation, milestone recomputation and declaration | 1 |
| 3 | **QC core** | `qc` — templates with Excel round-trip, sections, items, submissions, per-item review, rectification, plus `media` | 1, 2 |
| 4 | **Clients** | Next.js console, Flutter field app, `notification` | 1, 2, 3 |
| 5 | **Docs service** | `docs` + `docs-web` | 1 |

Foundation first because authorization and the audit ledger underpin everything.
`docs` is independent and can move earlier if a home for architecture documentation is
wanted during the build.

**Definition of done for the platform** — the critical path works end to end: bulk
generate a milestone's scope across sites → assign → field engineer captures a
checklist offline with camera-only geotagged photos → syncs → PM reviews per item →
approves → task completes → site milestone becomes eligible → PM declares achievement
→ every step is in a verifiable audit chain.

---

## 12. Assumptions

Stated explicitly; each is a reasonable default that can be revisited.

1. **Email delivery** uses a transactional provider (SMTP-compatible). Push uses FCM
   for Android; iOS via FCM's APNs bridge.
2. **Object storage** is Cloudflare R2, S3-compatible. Local filesystem in development.
3. **Language** is English throughout. No i18n framework in phase 1.
4. **Reporting** is served from `project` with indexed queries. A dedicated read model
   is a known future extraction point if dashboard latency degrades, not phase-1 work.
5. **Template Excel format** is defined by iPMS and shipped as a downloadable
   blank template — not a reverse-engineered IEPMS format.
6. **Session model** — one JWT format for both clients, verified identically at the
   gateway, but carried differently: the web app receives it in an `HttpOnly`,
   `Secure`, `SameSite=Strict` cookie, and Flutter sends it in an `Authorization`
   header. This keeps PMS's XSS protection for the browser (a token in `localStorage`
   would be a security regression) without PMS's two separate auth mechanisms. CSRF is
   handled by `SameSite=Strict` plus a double-submit token on mutating requests.
7. **Photos beyond the geofence** are flagged for reviewer attention, not rejected.
