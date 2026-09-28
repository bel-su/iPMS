# iPMS — Media Core Design

**Status:** Draft — awaiting review
**Date:** 2026-09-28
**Parent specs:** `2026-09-15-ipms-microservices-architecture-design.md` §5, §7.4, §8;
`2026-09-20-pending-services-scaffold-design.md` §6.1, §6.3

---

## 1. Context

`apps/media` exists as a scaffold: health, metrics, a `MediaObject` table with no rows,
an unused outbox table, and no storage client (scaffold spec §6.1 deferred it to "the
first presigned-upload endpoint" — this spec). The gateway already routes
`/api/v1/media/*` and refuses `/api/v1/media/internal/*`.

Meanwhile `qc` accepts `photoMediaIds` on a submission and stores them in `ItemPhoto`
without checking that they refer to anything. The Flutter app captures watermarked
photos and keeps them only on the phone.

Media is stored in **Cloudflare R2**, on a **new Cloudflare account** dedicated to iPMS
(not the account currently used for other work).

### 1.1 The whole media programme

All media — QC evidence photos and videos, a general site gallery, and checklist
documents — lives in R2. That is too large for one spec, so it is split:

| # | Sub-project | Delivers |
|---|---|---|
| **1** | **Media core (this spec)** | R2 wiring, the resumable upload protocol, server verification, signed viewing, scope authorization, the `attach` contract for `qc` |
| 2 | QC evidence integration | `minVideos`/`maxVideos` on checklist items; `qc` calls `attach` at submit; server-side draft submissions (device switching); reviewer views real media |
| 3 | Mobile capture and upload | On-device compression, offline upload queue, "Upload now", end-of-day reminder, draft sync, watermark verification |
| 4 | Site gallery and template documents | Gallery upload/browse (mobile), document upload (web) attached to template versions, document download on the phone |
| 5 | Photo package and purge | Background zip export with readable names; project media purge |

Order: 1, then 2 and 3 together (QC evidence end to end), then 4 and 5. Decisions below
that belong to later sub-projects are recorded in §10 so this spec's data model and key
layout provably accommodate them.

### 1.2 Scope of this spec

**In:** storage configuration and readiness; MinIO for local and CI; the `MediaObject`
reshape; the upload, status, parts, complete, discard, view-URL and list endpoints for
the `EVIDENCE` category; the verification worker; the internal `attach` endpoint; the
cancelled-task cleanup job; audit entries; metrics; tests.

**Out:** everything in sub-projects 2–5. `GALLERY` and `TEMPLATE_DOCUMENT` exist as
enum values and key prefixes only; their endpoints and permissions arrive in
sub-project 4.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| M1 | Keys use IDs, never codes: `projects/{projectId}/sites/{siteId}/…` | `siteCode` is editable; R2 has no rename. Readable names are applied at download and export time |
| M2 | Uploads go **directly from device to R2** via presigned URLs | Bytes never cross the single VPS; R2 egress is free, so re-reading for verification costs nothing |
| M3 | Videos over 10 MB upload as **multipart, 5 MiB parts** | A dropped connection resumes from the last completed part, across app restarts. 5 MiB is R2's minimum part size |
| M4 | **The phone assigns the media ID (UUIDv7) and SHA-256 at capture** | Every retry is the same object; offline capture needs no server round trip; the hash proves the file never changed after capture |
| M5 | **Compression happens on the device**, before hashing; the server never re-encodes | Saves field mobile data; the stored bytes are exactly the bytes the engineer submitted |
| M6 | Limits: photo 5 MB, video 100 MB, document 20 MB | Agreed with the product owner |
| M7 | Photos: 2560 px long edge, JPEG q80, stepping down by 5 to a floor of 70 to fit 5 MB. No per-item "high detail" mode | ≈4.9 MP keeps serial labels legible when in focus; focus, not resolution, is the real risk |
| M8 | Upload is **decoupled from submission** | Multi-day tasks; evidence can leave the phone the day it is taken |
| M9 | **"Check first, then upload only what is missing"** via a batch status call | No duplicate uploads; reviewers never see retries |
| M10 | Private buckets, **no custom domain**, `r2.dev` disabled | Presigned URLs only work on the S3 endpoint; nothing is publicly reachable |
| M11 | Upload URLs valid **1 hour**; view URLs valid **5 minutes** | An upload URL only has to outlast one ≤5 MB transfer on a very weak link; expired URLs are simply re-requested |
| M12 | Anyone in scope for a site sees all of that site's media | Handover and rework need to see a colleague's evidence |
| M13 | Verification is a Postgres-backed job queue inside `media` | No new infrastructure on a single VPS |
| M14 | Thumbnails for photos made on the server (`sharp`); video poster frames made on the phone | Avoids installing ffmpeg on the VPS |
| M15 | No `media.*` NATS events in this spec | `qc` gets its answer synchronously from `attach`; nothing would consume them. They land with the first consumer (notifications), per scaffold spec §6.3 |
| M16 | No new permission codes; reuse `qc_evidence.upload` | Permission catalog rule: a code arrives only with the endpoint that uses it |
| M17 | Local development and CI use **MinIO**, never R2 | No developer or test needs Cloudflare credentials; switching is configuration only |

---

## 3. Infrastructure

### 3.1 Cloudflare (new account)

| Item | Setting |
|---|---|
| Buckets | `ipms-media-staging`, `ipms-media-prod` (created), location hint APAC |
| Public access | `r2.dev` subdomain **disabled**; **no custom domain** |
| API tokens | One **Account API token** per bucket: *Object Read & Write*, *Apply to specific buckets only* → that bucket, TTL forever, **no client IP filtering** (presigned URLs are signed with this token and phones upload from arbitrary IPs) |
| Lifecycle | *Abort incomplete multipart uploads after 7 days* (usually present by default). **No object-expiry rules** — deletion is always the application's decision |
| CORS | Deferred until web domains exist (see §9). Mobile uploads do not need CORS |

### 3.2 Configuration

```
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   # http://minio:9000 locally
S3_REGION=auto
S3_BUCKET=ipms-media-prod
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_FORCE_PATH_STYLE=false                                   # true for MinIO
NATS_URL=nats://nats:4222                                   # audit entries (§6.4)
PROJECT_SERVICE_URL=http://project:3004
QC_SERVICE_URL=http://qc:3005
```

`docker/env/media.env` is committed to git, so it carries **only the local MinIO
values**. Real R2 credentials live in `docker/env/media.secrets.env`, which is
gitignored and loaded by Compose as an optional second `env_file`. It exists only on
the servers.

Media reads configuration at bootstrap and **fails to start** if any `S3_*` value is
missing.

### 3.3 Compose

- Add a `minio` service (plus a one-shot `minio-init` that creates the `ipms-media-local`
  bucket) for local and CI.
- `media` gains `depends_on` NATS and MinIO, and the optional secrets `env_file`.

### 3.4 Readiness

`registerReadinessCheck('storage', …)` issues `HeadBucket` beside the existing Postgres
check. A `media` that cannot reach its bucket reports not-ready and refuses presign
requests with 503 instead of handing out URLs it cannot honour.

---

## 4. Data model

### 4.1 Bucket keys

```
projects/{projectId}/sites/{siteId}/evidence/{mediaId}.{jpg|mp4}
projects/{projectId}/sites/{siteId}/evidence/{mediaId}.thumb.webp    (server, photos)
projects/{projectId}/sites/{siteId}/evidence/{mediaId}.poster.jpg    (phone, videos)
projects/{projectId}/sites/{siteId}/gallery/…                        (sub-project 4)
templates/{templateId}/versions/{versionId}/documents/{mediaId}.{ext} (sub-project 4)
```

Keys are built **only by the server** from validated IDs. A client never supplies a
key or a path fragment.

### 4.2 `MediaObject`

The scaffold table holds no rows, so it is reshaped in a single migration.

| Group | Fields |
|---|---|
| Identity | `id` UUID (client-supplied UUIDv7 for mobile, server-generated otherwise) |
| What | `kind` PHOTO · VIDEO · DOCUMENT; `category` EVIDENCE · GALLERY · TEMPLATE_DOCUMENT; `contentType`; `sizeBytes`; `originalFilename?` |
| Ownership | `projectId?`, `siteId?`, `taskId?`, `workOrderId?`, `checklistItemId?`, `templateId?`, `templateVersionId?` — plain UUIDs, no foreign keys (architecture §8) |
| Storage | `storageKey` unique; `thumbnailKey?`; `multipartUploadId?` (set only while a multipart upload is open) |
| Integrity | `contentHash` (SHA-256 hex, from the phone); `hashVerified` |
| Capture | `capturedAt`, `latitude`, `longitude`, `distanceFromSiteM?`, `deviceId`, `uploadedBy`, `receivedAt` |
| Lifecycle | `status`; `rejectReason?`; `verifyAttempts`; `nextAttemptAt?`; `attachedToSubmissionId?`; `attachedAt?`; `discardedAt?`; `purgeScheduledAt?`; `purgedAt?` |
| Deferred | `watermarkVerified` — stays `false`; set by sub-project 3 |

Indexes: `contentHash`; `(status, nextAttemptAt)` for the worker; `(taskId)`;
`(uploadedBy, status)` for the pending cap; `(projectId)` for purge.

### 4.3 Status lifecycle

```
PENDING ──complete──▶ VERIFYING ──ok──▶ READY ──attach──▶ ATTACHED
   │                      └──fail──▶ REJECTED
any status before ATTACHED ──discard (uploader)──▶ DISCARDED
any status before ATTACHED, task/work order cancelled ≥ 30 days ──▶ DISCARDED
ATTACHED ──project purge (sub-project 5)──▶ PURGE_SCHEDULED ──30 days──▶ PURGED
```

- `DISCARDED` and `PURGED` rows are **kept** as tombstones; only the R2 objects go.
- `ATTACHED` media is never removed by any automatic process. Only the admin purge in
  sub-project 5 removes it.
- READY-but-unattached media on an **open** task or work order is kept indefinitely.

### 4.4 Limits

| Kind | Content types | Max |
|---|---|---|
| PHOTO | `image/jpeg` | 5 MB |
| VIDEO | `video/mp4` (H.264 / HEVC) | 100 MB |
| DOCUMENT (sub-project 4) | PDF, DOCX, XLSX, DWG, DXF, PNG, JPEG | 20 MB |

The phone converts HEIC to JPEG before hashing; the server accepts JPEG only.

---

## 5. API

All paths are under `/api/v1`. Public endpoints require `qc_evidence.upload` and scope
over the target site (evaluated through `project`'s `/internal/scope`, the pattern `qc`
already uses).

### 5.1 Public

| # | Method & path | Behaviour |
|---|---|---|
| 1 | `POST /media/uploads/status` `{ids: uuid[≤200]}` | Per ID: `UNKNOWN`, `PENDING` (+ `completedParts` for multipart, from R2 `ListParts`), `VERIFYING`, `READY`, `ATTACHED`, `REJECTED` (+ `reason`), `DISCARDED`. Only IDs the caller uploaded, or can see by scope, are reported; others are `UNKNOWN` |
| 2 | `POST /media/uploads` | Registers a file: `id, category, projectId, siteId, taskId, workOrderId?, checklistItemId, kind, contentType, sizeBytes, contentHash, capturedAt, latitude, longitude, deviceId`. Validates scope, limits, and that the site belongs to the project and the task to the site. Returns `{status, upload}` where `upload` is `{mode: "single", url, headers, expiresAt}` or `{mode: "multipart", uploadId, partSize, parts: [{partNumber, url}], expiresAt}`, plus `posterUpload` for videos. **Idempotent:** same `id` + same `contentHash` returns current state and fresh URLs (none if already past `PENDING`); same `id` + different hash → 409 |
| 3 | `POST /media/uploads/:id/parts` `{partNumbers}` | Fresh presigned URLs for the given parts. `PENDING` multipart only |
| 4 | `POST /media/uploads/:id/complete` `{parts?: [{partNumber, etag}]}` | Single: confirms the object exists. Multipart: `CompleteMultipartUpload`. Moves to `VERIFYING` and enqueues. Idempotent |
| 5 | `DELETE /media/:id` | Discard a retake. Uploader only; any status except `ATTACHED`, `PURGE_SCHEDULED`, `PURGED`. Deletes R2 objects (aborting any open multipart upload), sets `DISCARDED`. Idempotent |
| 6 | `GET /media/:id/url?variant=original\|thumbnail\|poster` | 5-minute presigned GET with `Content-Disposition` giving a readable filename, e.g. `KOS121_4.2_antenna-azimuth_01.jpg`. Scope re-checked every call |
| 7 | `GET /media?taskId=…` | A task's non-discarded evidence with metadata and thumbnail URLs, for device switching and review |

Presigned single PUTs are signed over `Content-Length`, `Content-Type` and
`x-amz-checksum-sha256`, so R2 itself refuses bytes that differ from the registration.
Presigned URLs are reusable until they expire; reuse can only rewrite the same object
with the same bytes.

### 5.2 Internal

| # | Method & path | Behaviour |
|---|---|---|
| 8 | `POST /media/internal/attach` `{submissionId, siteId, mediaIds}` | Called by `qc` at submit (wired in sub-project 2). All must be `READY` (or already `ATTACHED` to this same submission) and on `siteId`; otherwise 409 listing the offending IDs and nothing changes. Marks them `ATTACHED` in one transaction and returns `{id, contentHash, capturedAt, latitude, longitude, distanceFromSiteM, kind}` for each |

The gateway already refuses `/api/v1/media/internal/*`.

### 5.3 Errors

| Code | When | Client behaviour |
|---|---|---|
| 400 | Malformed body | Bug; do not retry |
| 403 | Missing permission or site outside scope | Keep the local file; tell the user |
| 409 | Same ID with different hash; attach conflict | Do not retry; flag for support |
| 413 | Over the size limit | Show reason |
| 422 | Site not in project, task not on site | Do not retry |
| 429 | Caller already has 500 `PENDING` objects | Back off |
| 503 | Storage or database unavailable | Retry with backoff (normal offline path) |

---

## 6. Processing

### 6.1 Verification worker

Polls `status = VERIFYING AND nextAttemptAt <= now()` with `FOR UPDATE SKIP LOCKED`,
a small fixed concurrency (default 2). Per object:

1. Stream `GetObject` through SHA-256 and a byte counter. Hash ≠ `contentHash` →
   `REJECTED: HASH_MISMATCH`.
2. Actual size over the kind's limit → `SIZE_EXCEEDED`. Magic bytes not matching
   `contentType` → `TYPE_MISMATCH`.
3. PHOTO: `sharp` (with `limitInputPixels`) produces a 400 px WebP thumbnail.
   VIDEO: `HeadObject` on the poster key; absent → `POSTER_MISSING`.
4. `distanceFromSiteM` from the site's coordinates (`project`
   `/internal/sites/:id/geofence`).
5. `READY`, `hashVerified = true`.

A transient failure (R2, network, `project` unavailable) increments `verifyAttempts`
and sets `nextAttemptAt` with exponential backoff. After 5 attempts the object stays
`VERIFYING` with an error logged and a metric raised for an operator; it is never
silently dropped.

### 6.2 Cancelled-task cleanup

Daily job. For evidence in any status before `ATTACHED` (`PENDING`, `VERIFYING`,
`READY`, `REJECTED`) whose `receivedAt` is older than 30 days, ask `project` (tasks) and `qc` (work orders) for
status. If cancelled for ≥ 30 days: delete R2 objects (aborting any open multipart upload), set `DISCARDED`. Open tasks and
work orders are skipped regardless of age.

### 6.3 Abandoned `PENDING`

`PENDING` rows are **not** expired by time — an engineer may be offline for days. The
R2 lifecycle rule removes incomplete multipart parts after 7 days; the phone
re-registers and resumes (endpoint 2 returns a new multipart upload if the old one is
gone). `PENDING` rows are cleaned by §6.2's rule once their task is cancelled.

### 6.4 Audit

Discard, rejection and (later) purge are recorded in the audit ledger through the
outbox and `audit.event.recorded`, as every other service does. This is why `media`
gains `NATS_URL`. Successful uploads are not audited individually; the submission that
attaches them is.

### 6.5 Metrics

`media_uploads_registered_total{kind}`, `media_uploads_completed_total{kind}`,
`media_verify_duration_seconds`, `media_rejected_total{reason}`,
`media_verify_queue_depth`, `media_capture_to_receipt_seconds`.

---

## 7. Security

- R2 credentials exist only inside `media`. Clients receive presigned URLs only.
- Keys are server-built; clients cannot target another project's prefix.
- Upload URLs are bound to exact size, type and SHA-256.
- Scope is re-evaluated on every view URL; revoked access lapses within 5 minutes.
- Presigned URLs are redacted from logs (they are bearer credentials while valid).
- Per-user cap of 500 `PENDING` objects; `sharp` input-pixel limit guards against
  decompression bombs.

---

## 8. Testing

- **Unit:** key builder; status transition table; limit and content-type rules;
  registration idempotency (same hash / different hash); readable filename builder.
- **Integration (MinIO via Compose):** single photo register → PUT → complete →
  `READY` with thumbnail; video multipart with an interrupted upload resumed from
  `status` → `READY`; tampered bytes → `HASH_MISMATCH`; batch status for mixed states;
  discard deletes objects; `attach` success, idempotent repeat, and conflict; readiness
  fails when MinIO is stopped.
- **`app.module.spec.ts`:** every new endpoint is guarded (scaffold decision S6).
- **e2e:** one upload → verify → view-URL run through the gateway, deleting its own
  objects and rows afterwards.
- No automated test uses R2.

---

## 9. Deployment checklist

1. Create the two R2 API tokens as in §3.1; store key ID, secret and endpoint in the
   password manager.
2. On each server, create `docker/env/media.secrets.env` with that environment's
   `S3_*` values.
3. Confirm the multipart-abort lifecycle rule on both buckets.
4. **When web domains exist:** add a CORS policy per bucket allowing `GET`, `PUT`,
   `HEAD` from that environment's web origin only, headers `content-type` and
   `x-amz-checksum-sha256`, exposing `ETag`.
5. Manual smoke test against `ipms-media-staging`: register, upload, verify, view.

---

## 10. Decisions recorded for later sub-projects

- **Mobile (3):** captured files live in app-private storage with a local queue;
  background upload via WorkManager / BGTaskScheduler; photos before videos, oldest
  first; backoff 30 s → 30 min, reset on connectivity; optional "videos on Wi-Fi
  only"; "Upload now" button; local end-of-day reminder (default 18:00) only when
  something is pending; "safe to switch devices" indicator; unsubmitted files are never
  deleted locally; local copies deleted 30 days after the submission is confirmed;
  video re-encoded to 720p H.264 ≈2.5 Mbps; tap-to-focus on capture.
- **QC (2):** `minVideos`/`maxVideos` beside the photo counts (default 0); submissions
  sync as server-side `DRAFT` for device switching; the submission is sent only after
  all its media are `READY`; a work order keeps the template version it was raised
  with until completed.
- **Gallery and documents (4):** documents uploaded from the web only, attached to a
  **template version** and copied forward by "new version"; an engineer can download a
  document if a work order on one of their in-scope sites uses that template; new
  permission codes arrive with those endpoints.
- **Package and purge (5):** purge requires a completed photo-package download, is
  gated by an admin-only `media.purge` permission with typed confirmation, enters a
  30-day grace period (`PURGE_SCHEDULED`, reversible), then deletes the
  `projects/{projectId}/` prefix and keeps tombstone rows. Template documents are
  never purged with a project.
- **Separate `qc` item:** "Duplicate as new template" for creating a different
  checklist from an existing one; versioning stays.
