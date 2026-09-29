# QC Evidence Integration — Design (media sub-project 2)

**Date:** 2026-09-29
**Status:** Approved in brainstorming, awaiting spec review
**Builds on:** `2026-09-28-media-core-design.md` (media core, sub-project 1)

## 1. Goal

Make a QC submission carry real, verified evidence and let reviewers see it:

- a submission is accepted only if every referenced file exists in media, is
  verified, belongs to the work order, and the per-item photo **and video**
  counts are right;
- checklist items gain video counts;
- an engineer's in-progress checklist is kept on the server as a draft so they
  can switch devices, with an explicit handover between devices;
- a rework attempt can reuse the previous attempt's files;
- the web work-order page shows each item's photos and videos.

**In scope:** `qc` and `media` backend changes, the web reviewer view.
**Out of scope:** mobile app changes (sub-project 3), site gallery and
documents (4), photo package and purge (5), side-by-side attempt comparison.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Scope is backend + web reviewer view | Smallest piece that gives an end-to-end usable flow |
| D2 | A file attached to an earlier attempt of the **same work order** can be attached again to a later attempt. Files never move between work orders | Rework usually changes a few items; retaking every photo is slow and doubles storage |
| D3 | One device holds a draft at a time; another device must explicitly **take over**, after which the old device's saves are refused | Nothing is silently overwritten; matches the phone's "safe to switch devices" indicator |
| D4 | Drafts live in their own `WorkOrderDraft` table, not as a `DRAFT` submission | `Submission` requires attempt number, integrity hash, idempotency key; drafts would have to be excluded from every attempt/pending query |
| D5 | QC learns each file's kind from media, never from the client | Counts are checked against the truth |
| D6 | Counts are validated **before** attach, via a read-only media check | A submission that fails validation never locks files in as evidence |

## 3. Data changes

### 3.1 `qc`

- **`ChecklistItem`**: add `minVideos Int @default(0)` and `maxVideos Int @default(0)`,
  range 0–5, `maxVideos >= minVideos` (same rule and message style as photos).
  - `libs/contracts` template item schema gains both fields, defaulting to 0.
  - Excel template: two new columns, `Min Videos` and `Max Videos`, after
    `Max Photos`. Optional on import (missing column or blank cell = 0), so
    existing workbooks still import. The sample workbook and export include them.
  - Template documents and the web checklist outline show video counts.
- **`ItemPhoto` → `ItemMedia`** (table `item_media`): add `kind VarChar(10)`
  (`PHOTO` | `VIDEO`). The migration renames the table and backfills `kind =
  'PHOTO'`. `sequence` keeps the order of files within an item (photos and
  videos share one sequence).
- **`WorkOrderDraft`** (table `work_order_draft`):

  | Column | Type | Notes |
  |---|---|---|
  | `workOrderId` | uuid, PK, FK → work_order (cascade) | One draft per work order |
  | `holderId` | uuid | The assignee who owns it |
  | `deviceId` | varchar(255) | Device currently holding it |
  | `deviceLabel` | varchar(100) | Shown to the other device, e.g. "Pixel 7" |
  | `version` | int | Bumped on every save and takeover |
  | `responses` | jsonb | Draft answers, ≤ 256 KB serialised |
  | `updatedAt` | timestamptz | |

- **`WorkOrderEvent.kind`** gains `STARTED`.

### 3.2 Contracts

- `ItemResponseInputSchema`: `mediaIds: uuid[]` (max 25) replaces
  `photoMediaIds`. For one release `photoMediaIds` is still accepted and read as
  `mediaIds` (if both are sent, `mediaIds` wins) so the current mobile build keeps
  working.
- Draft schemas: `DraftResponsesSchema` is the item-response shape with every
  field optional except `itemId`, and no required-item or count checks.
  `SaveDraftSchema = {deviceId, deviceLabel, baseVersion, responses}`,
  `TakeoverDraftSchema = {deviceId, deviceLabel}`.
- Media: `MediaCheckRequestSchema = {workOrderId, siteId, mediaIds}` and
  `MediaCheckResult = {id, kind | null, usable, reason?}[]` with `reason` in
  `UPLOADING | VERIFYING | REJECTED | NOT_FOUND | WRONG_WORK_ORDER`.
- Submission read model: each item response lists `media: {id, kind, sequence}[]`.

## 4. Media changes

### 4.1 Reuse within a work order (D2)

The attach usability rule becomes: the file is `EVIDENCE`, its `siteId` and
`workOrderId` match the request, and its status is `READY` **or** `ATTACHED`
(to any submission of that work order — guaranteed by the `workOrderId` match).

- `READY` files move to `ATTACHED` with `attachedToSubmissionId` = this
  submission. Already-`ATTACHED` files are left unchanged: that column keeps the
  attempt where the file **first** became evidence. QC's `ItemMedia` rows are the
  per-attempt record.
- Locking (`FOR UPDATE ORDER BY id`), deduplication and the update-count guard
  stay as they are; the count guard compares against the number of `READY` rows.

### 4.2 Read-only check

`POST /media/internal/check`, body `MediaCheckRequestSchema`, permission
`qc_submission.submit`, behind the gateway's existing `/media/internal/` block.
Applies the §4.1 rule without locking or writing, and returns per requested id:

| File state | `usable` | `reason` |
|---|---|---|
| READY, or ATTACHED to this work order | true | — |
| PENDING | false | `UPLOADING` |
| VERIFYING | false | `VERIFYING` |
| REJECTED | false | `REJECTED` |
| Missing, DISCARDED, PURGE_*, not EVIDENCE | false | `NOT_FOUND` |
| Different work order or site | false | `WRONG_WORK_ORDER` |

`kind` is returned whenever the row exists and belongs to this work order.

## 5. Submitting (`POST /qc/submissions`)

Idempotency by `idempotencyKey` is unchanged (a repeat returns the original
submission before any of the steps below). Then:

1. **QC-local checks**, as today: work order exists, is assigned to the caller,
   not cancelled, project/site match, template version accepted, no pending or
   approved submission, required items present exactly once, N/A allowed.
   **New:** if a draft exists and is held by a different `deviceId` than the
   request's, refuse with 409 `DRAFT_HELD_ELSEWHERE`.
2. **Check** — call `POST /media/internal/check` with every distinct id across
   all items, forwarding the caller's token. Any unusable file → **409
   `MEDIA_NOT_READY`** with `files: [{id, reason}]`.
3. **Counts** — per item, count photos and videos using the kinds from step 2;
   outside `[minPhotos, maxPhotos]` or `[minVideos, maxVideos]` → **400** naming
   the item number and which count. The same file id twice in one item, or in two
   items, → 400.
4. **Attach** — call `POST /media/internal/attach` with a freshly generated
   submission id. A 409 here (file changed since step 2) is returned to the client
   as 409 `MEDIA_NOT_READY` after re-running the check to get reasons.
5. **One QC transaction**: create the submission (with the step-4 id),
   `ItemResponse` and `ItemMedia` rows (with kinds), the outbox event, the work
   order's move to `REVIEWING`, the audit record, the timeline entry, and delete
   the draft.

The integrity hash now covers `mediaIds` with kinds.

**Failure between steps 4 and 5** (crash, unique-constraint race): the files are
`ATTACHED` to a submission id that was never written. A retry generates a new
id and passes attach because of §4.1. The dangling `attachedToSubmissionId` is
cosmetic and documented.

**Media unreachable** at step 2 or 4 → 503; the phone keeps the submission
queued and retries with backoff. `photoMediaIds` from old clients flows through
the same steps.

## 6. Drafts

All draft endpoints require `qc_submission.update`, the caller must be the work
order's assignee, and the work order must be `NOT_STARTED`, `ONGOING` or
`RECTIFYING` (otherwise 409 `WORK_ORDER_CLOSED`).

- **`GET /qc/work-orders/:id/draft`** → `{version, deviceId, deviceLabel,
  updatedAt, responses}`.
  - No draft and status `RECTIFYING` → an **unsaved** draft (`version: 0`,
    `deviceId: null`) pre-filled from the latest submission: its answers and the
    same `mediaIds` per item. This is how rework reuse (D2) reaches the phone.
  - No draft otherwise → 404.
- **`PUT /qc/work-orders/:id/draft`** body `SaveDraftSchema`:
  - no draft yet: `baseVersion` must be 0; creates it held by this device.
  - held by another device → 409 `DRAFT_HELD_ELSEWHERE` with
    `{deviceLabel, updatedAt}`.
  - `baseVersion` ≠ current `version` → 409 `DRAFT_STALE` with the current version.
  - otherwise saves and returns the new `version`.
  - responses over 256 KB → 413.
  - the first save while the work order is `NOT_STARTED` moves it to
    **`ONGOING`** in the same transaction, with audit and a `STARTED` timeline
    entry.
- **`POST /qc/work-orders/:id/draft/takeover`** body `TakeoverDraftSchema`: sets
  the holder device, bumps `version`, returns the draft. If there is no draft,
  404.
- Saves are serialised with `SELECT … FOR UPDATE` on the draft row (or an
  insert that conflicts on the primary key for the first save).
- A draft is **deleted** on submit (§5 step 5), reassignment and cancellation,
  each in the transaction that makes that change. Files referenced by a deleted
  draft stay with the work order; cancellation cleanup (media core A3) handles
  them.
- Drafts do not validate that referenced files exist; that happens at submit.

## 7. Web reviewer view

On `quality/work-orders/[id]`, both the filled checklist and the review console
show each item's files under its answer, in `sequence` order:

- photos as thumbnails; videos as their poster with a play icon;
- under each: capture time and distance from site ("12 m from site", or "No
  location");
- on attempt 2 and later, files not present in the previous attempt get a
  **New** badge.

Clicking opens a viewer: full-size photo with zoom, or the browser's video player;
arrows move through the item's files; **Download** fetches the original with its
readable file name.

Data: the submission from `GET /qc/submissions/:id` (media ids and kinds per
item), and the files from media's `GET /media?workOrderId=` (thumbnail links,
capture time, distance). The original is requested (`GET /media/:id/url`) only
when the viewer opens it. When a link fails because it expired (5 minutes), the
page fetches a fresh one and retries once; a file that still cannot load shows a
placeholder, not a broken image.

**Scope fix:** `GET /qc/submissions/:id` currently checks only
`qc_submission.view`. It gains the same site-scope check as the work-order
endpoints (out of scope → 404).

## 8. Errors

| Situation | Response |
|---|---|
| File uploading or being checked | 409 `MEDIA_NOT_READY`, reasons `UPLOADING` / `VERIFYING` |
| File rejected, missing, or from another work order | 409 `MEDIA_NOT_READY`, reasons `REJECTED` / `NOT_FOUND` / `WRONG_WORK_ORDER` |
| Wrong photo or video count, or duplicated file | 400 with item number |
| Draft held by another device | 409 `DRAFT_HELD_ELSEWHERE` with device label and last save |
| Draft saved from an old copy | 409 `DRAFT_STALE` |
| Draft on a closed work order | 409 `WORK_ORDER_CLOSED` |
| Draft too large | 413 |
| Media or storage down | 503 |
| Same submission twice | The original result |

Every 409 body carries a machine-readable `code`.

## 9. Testing

- **QC unit:** counts with kinds from media (video in a photo-only item, too many
  videos, duplicates); no attach call when counts fail; attach 409 mapped with
  reasons; draft deleted on submit; submit refused when the draft is held
  elsewhere; every draft rule (create, hold, takeover, stale, closed, size,
  rework pre-fill, deletion on reassign/cancel); `NOT_STARTED → ONGOING` on first
  save; scope on `GET /qc/submissions/:id`; `photoMediaIds` compatibility;
  Excel import with and without video columns.
- **Media unit/integration:** reuse within a work order allowed, across work
  orders refused; `attachedToSubmissionId` keeps the first attempt; every check
  reason.
- **Integration (Testcontainers):** two concurrent submits of one work order;
  failure after attach then retry succeeds.
- **Web (Vitest):** media rows, New badge, expired-link refresh, placeholder.
- **E2E through the gateway:** upload a real JPEG and a small MP4 with poster;
  save a draft; take it over from a second device id; submit; reviewer rejects;
  rework draft is pre-filled; replace one photo; submit; approve; both attempts
  list the right files and kinds.

## 10. Rollout

1. Migrations: video counts, `WorkOrderDraft`, `ItemPhoto` → `ItemMedia` with
   `PHOTO` backfill, `STARTED` event kind.
2. Media: check endpoint and relaxed reuse rule.
3. QC: new submit flow and drafts (still accepting `photoMediaIds`).
4. Web reviewer view.

## 11. Amendments to the media core spec

- **§10 QC (2):** drafts are a separate `WorkOrderDraft` table, not a `DRAFT`
  submission (D4).
- **§5.2 / A11 attach:** a file `ATTACHED` to another submission of the same work
  order is usable (D2); `attachedToSubmissionId` records the first attempt.
