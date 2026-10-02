# Notification Service — In-App QC Notifications — Design

**Date:** 2026-10-02
**Status:** Approved in brainstorming, awaiting spec review
**Builds on:** `2026-09-20-pending-services-scaffold-design.md` (notification scaffold, §6.2 deferral),
`2026-09-15-ipms-microservices-architecture-design.md` (§7.4, event table)

## 1. Goal

Turn the notification scaffold into a working in-app notification service for QC events:

- when an engineer submits a work order for review, every user who may review it is notified;
- when a reviewer approves or rejects a submission, the engineer who submitted it is notified
  (with the rejection comment);
- users read, count and mark their own notifications through the API, and the web bell shows
  real data instead of the hardcoded list.

**In scope:** `notification` consumers and API, a narrow IAM lookup endpoint, additive `qc`
event payload fields, the web `NotificationCenter`.

**Out of scope:** FCM push, email, `DevicePushToken` endpoints (transport stays deferred per
scaffold §6.2), websockets/SSE, per-user preferences, `project.*` and `media.*` events,
the mobile app.

## 2. Decisions

| # | Decision | Reason |
|---|---|---|
| 1 | In-app channel only, QC events only | Smallest slice that gives the bell real data; transport is meaningless without a trigger and is added later per the scaffold |
| 2 | `Reviewed` → the submitter; `Submitted` → reviewers resolved from IAM at consume time | `qc` has the submitter but no reviewer list. Resolving reviewers inside `qc`'s submit transaction would add a cross-service call there |
| 3 | Reviewer lookup reuses `@ipms/authz` `check()` inside IAM | "Who may review" cannot drift from what the review endpoint enforces; role→permission grants live only in IAM's database |
| 4 | Idempotency by unique `(recipientId, eventId)` | JetStream redelivers and fan-out writes one row per recipient |
| 5 | Polling, not push-to-browser | No realtime transport exists; polling is enough for a bell |
| 6 | Service credential for the IAM lookup: shared secret header (§5.3) | A consumer has no user token, and the repo's other internal calls forward one — see §5.3 |

## 3. Event payload changes (`libs/events/src/payloads/qc.ts`)

Additive; existing consumers are unaffected.

- `QcSubmissionSubmitted` gains `workOrderId`, `workOrderTitle`, `siteId`, `siteCode`.
- `QcSubmissionReviewed` gains `submittedBy`, `workOrderId`, `workOrderTitle`, `siteId`, `siteCode`.

The title and site code let a reviewer tell notifications apart. Events published before
this change lack the fields; the consumer logs and acknowledges them rather than retrying
(§4.2).

`qc` fills these from the submission it already loaded in `submission.service.ts` (submit,
~line 185; review, ~line 230). No new queries.

`taskId` and `workOrderId` refer to the same work order in qc today; `workOrderId` is added so
consumers do not need to know that.

## 4. Notification service

### 4.1 Data model (one migration)

`Notification` gains:

- `eventId String? @db.Uuid` — the envelope's `eventId`. Nullable: seeded rows
  (`docker/seed-notification.sql`) have none, and Postgres treats NULLs as distinct in a
  unique index;
- `workOrderId String? @db.Uuid`;
- `@@unique([recipientId, eventId])`.

Writes use `createMany({ skipDuplicates: true })`, so redelivery and a retried partial fan-out
are harmless. The existing `(recipientId, isRead, createdAt)` index is unchanged and serves
every list query.

`type` values: `QC_SUBMISSION_SUBMITTED`, `QC_SUBMISSION_APPROVED`, `QC_SUBMISSION_REJECTED`.
`actionUrl` is `/quality/work-orders/<workOrderId>`. `DevicePushToken` is untouched.

Existing rows: seeded development rows keep a NULL `eventId` and are unaffected by the unique key.

### 4.2 Consumers

Two durables, one per subject (a JetStream durable carries a single `filter_subject`; see the
comment on `STREAMS.IAM`):

| Subject | Durable | Recipients |
|---|---|---|
| `qc.submission.submitted` | `notification-submission-submitted` | reviewers from IAM, minus `submittedBy` |
| `qc.submission.reviewed` | `notification-submission-reviewed` | `submittedBy` |

`STREAMS.QC.durableConsumers` in `libs/events/src/subjects.ts` lists both. The unused
`qc-scope-cache` placeholder on `STREAMS.IAM` is removed (nothing creates it).

Dedupe uses the shared `DedupeStore`; the unique key in §4.1 is the durable guarantee, the
store only avoids needless work.

Content:

- Submitted: title "Submission awaiting review", body names the work order and attempt.
- Approved: title "Submission approved".
- Rejected: title "Rework required", body is the review `comment` (or a fixed line when null).

Failure behaviour:

- IAM unreachable, non-2xx or timeout → the handler throws; `DurableConsumer` redelivers up to
  `MAX_DELIVERIES` (5), then terminates to the DLQ. No notification is silently dropped.
- IAM returns an empty reviewer list → log a warning and ack (a project with no reviewers is
  not a delivery error).
- Payload without the enrichment fields (an event published before this change) → log a
  warning and acknowledge; retrying cannot supply them.

### 4.3 API

Gateway prefix `/api/v1/notifications` already routes to this service and is authenticated.
Controller paths are `notifications/...` under the `api/v1` global prefix.

| Method | Path | Behaviour |
|---|---|---|
| GET | `/notifications` | Caller's notifications, newest first. Query: `limit` (default 20, max 50), `cursor`, `unreadOnly` |
| GET | `/notifications/unread-count` | `{ count }` |
| POST | `/notifications/:id/read` | Marks one read. 404 if it is not the caller's |
| POST | `/notifications/read-all` | Marks all of the caller's unread read; returns `{ updated }` |

Every query filters by `recipientId = JWT subject`, so one user can never read or alter another
user's notification. There are no new permission codes: any authenticated user may use these
routes for their own data. Routes carry no `@RequirePermission`; this resolves the deferred
`notification.*` item in `libs/authz/src/permissions.ts:85` for this slice, and the code comment
there is updated to say so. The controller must make the "authenticated, own data only" choice
explicit (a decorator or comment), not leave it as an accident of a missing annotation.

The cursor is `(createdAt, id)` encoded opaquely. Response shape lives in `libs/contracts`.

## 5. IAM lookup

### 5.1 Endpoint

`POST /internal/authz/holders` (under the `api/v1` prefix; the gateway refuses `/internal/`).

Request `{ permission: string, projectId: string }`; response `{ userIds: string[] }`.

### 5.2 Behaviour

Loads active users with their roles, scopes and overrides through the same
`toAuthzUser` / `toScope` / `toOverrides` path `EffectiveService` uses, and runs `check()` with
`resource = { projectId }`. Included: users with the permission and reach (global scope, or the
project in their project scope, or a site scope inside it as `check()` decides). Excluded:
deactivated users, inactive roles, expired role assignments, denied overrides. IAM does not
reimplement permission logic.

Cost: one query loading active users with relations. Acceptable at this scale; revisit if the
active user count grows into the thousands (note in the code, not built now).

### 5.3 Service authentication (decision to confirm)

Every existing internal call forwards the end user's bearer token. An event consumer has no
such token, so this endpoint cannot be user-authenticated.

Decision: a shared secret. `notification` sends `X-Internal-Key: $INTERNAL_SERVICE_KEY`;
IAM compares in constant time and returns 401 otherwise. The key is a new env var in
`docker/env/*.env` and `.env.example`, required in `NODE_ENV=production` (IAM fails at
bootstrap if unset there). The endpoint is not decorated with `@RequirePermission`; it is
guarded by this key alone and must be excluded from `JwtUserGuard`.

Alternatives considered: minting a service JWT from the shared `JWT_SECRET` (broader blast
radius — it would be accepted by every guard); network-only trust (no defence if the gateway
rule regresses). The shared key is the smallest mechanism that fails closed.

## 6. Web

`apps/web/app/components/notification-center.tsx`:

- remove `INITIAL_NOTIFICATIONS`;
- poll `GET /notifications/unread-count` every 30 s while the tab is visible; fetch the list
  when the panel opens;
- mark-read and read-all are optimistic and roll back on error;
- the category filter maps from `type` (`QC_*` → `qc`);
- relative time is computed from `createdAt`; `href` from `actionUrl`;
- loading, empty and error states are shown (the panel must not render blank on failure).

## 7. Testing

- **notification consumers (unit):** fake IAM client. Cases: fan-out count; submitter excluded
  from reviewers; redelivery creates no duplicates; IAM failure throws; empty reviewers acks;
  rejected body carries the comment.
- **notification API:** recipient isolation (user B cannot read or mark user A's notification,
  gets 404); pagination across a cursor; unread-count after mark-read and read-all.
- **IAM `holders`:** global user included; project-scoped user included only for their
  project; deactivated user, expired role and denied override excluded; wrong or missing key
  → 401.
- **qc:** the new payload fields are present on both events (extend the existing submission
  service specs).
- **web:** component spec with a mocked fetch for load, empty, error and optimistic rollback.
- **e2e (`e2e/`):** submit → reviewer receives a notification → reject → engineer receives
  one with the comment.

## 8. Risks

- Reviewer list is computed at consume time, not publish time: a user who gains the permission
  between submit and consume is notified. Acceptable.
- A shared key is one more secret to rotate. Rotation is a coordinated deploy of IAM and
  notification; documented in `docker/env/README.md`.
- `Notification` rows grow without bound. Retention is out of scope; a follow-up should add
  expiry of read notifications.
