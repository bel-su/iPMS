# Media Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `apps/media` scaffold into a working evidence-media service: resumable direct-to-R2 uploads from the mobile app, server-side verification, signed viewing, and the `attach` contract `qc` will call at submit.

**Architecture:** Phones register each file (their own UUIDv7 id + SHA-256), receive presigned URLs, PUT bytes straight to R2 (multipart for videos over 10 MiB), then call `complete`. A Postgres-leased worker inside `media` re-reads the object, verifies hash/size/type, makes thumbnails and marks it `READY`. Views are 5-minute presigned GETs, scope-checked through `project`. Cancelled work orders reach `media` as a `qc.work_order.cancelled` event; an hourly sweeper discards their unattached media 30 days later.

**Tech Stack:** NestJS 12 on Fastify, Prisma 7 (Postgres 17), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `sharp` 0.35.4, NATS JetStream via `@ipms/events`, `prom-client` 15.1.3, Vitest 4 with Testcontainers (Postgres, MinIO).

**Spec:** `docs/superpowers/specs/2026-09-28-media-core-design.md` (the "Amendments" section at its end lists where this plan departs from the original text and why).

## Global Constraints

- Limits: photo `image/jpeg` ≤ 5 MiB; video `video/mp4` ≤ 100 MiB; document ≤ 20 MiB (document endpoints are out of scope).
- Videos larger than 10 MiB upload as multipart in 5 MiB parts.
- Upload URLs expire after **3600 s**; view URLs after **300 s**.
- Max 500 `PENDING` objects per uploader; `POST /media/uploads/status` takes at most 200 ids.
- Photo thumbnail: 400 px WebP, `sharp` `limitInputPixels` 50 000 000. Video poster (phone-made JPEG) ≤ 1 MiB.
- Verification: at most 5 transient-failure attempts, backoff `30 s × 2^(attempt-1)` capped at 1 h; lease 5 min.
- Cancelled work order → unattached media discarded **30 days** after `cancelledAt`.
- Bucket keys are built only by the server: `projects/{projectId}/sites/{siteId}/evidence/{mediaId}.{jpg|mp4}`, thumbnail `…/{mediaId}.thumb.webp`, video poster `…/{mediaId}.poster.jpg`.
- Presigned URLs must never be logged; every response field that carries one is named `signedUrl`.
- No new permission codes. Upload endpoints: `qc_evidence.upload`. View endpoints: `qc_submission.view`. Internal attach: `qc_submission.submit`.
- No automated test may use Cloudflare R2. MinIO only.
- Repo conventions: ESM with `.js` import suffixes, exact dependency versions (`pnpm add -E`), `@ipms/*` libraries consumed as **built** packages (rebuild a lib after changing it), UUIDv7 ids everywhere, commit messages in Conventional Commits style ending with the `Co-Authored-By` trailer.

---

## File Structure

```
libs/contracts/src/media/media.ts            NEW  zod schemas, limits, response types
libs/contracts/src/media/media.spec.ts       NEW
libs/contracts/src/index.ts                  MOD  export media
libs/events/src/subjects.ts                  MOD  qc.work_order.cancelled + media durable
libs/events/src/payloads/qc.ts               MOD  QcWorkOrderCancelled
libs/observability/src/logger.ts             MOD  redact `signedUrl`
apps/qc/src/work-orders/work-order.service.ts MOD cancel() publishes the event
apps/qc/prisma/work-orders.integration.spec.ts MOD assert the event

apps/media/package.json                      MOD  deps
apps/media/vitest.config.ts                  MOD  Testcontainers setup file
apps/media/prisma/schema.prisma              MOD  MediaObject reshape
apps/media/prisma/migrations/20260928000100_media_core/migration.sql NEW
apps/media/prisma/test-db.ts                 NEW  Postgres Testcontainer helper
apps/media/src/config.ts (+ .spec)           NEW  env → MediaConfig
apps/media/src/storage/storage.client.ts     NEW  all S3/R2 calls
apps/media/src/storage/storage.integration.spec.ts NEW
apps/media/src/storage/keys.ts (+ .spec)     NEW  key builder
apps/media/src/testing/minio.ts              NEW  MinIO Testcontainer helper
apps/media/src/media/status.ts (+ .spec)     NEW  status groups
apps/media/src/media/filename.ts (+ .spec)   NEW  readable download names
apps/media/src/media/audit.ts                NEW  audit outbox rows
apps/media/src/media/discarder.ts            NEW  delete objects + tombstone
apps/media/src/metrics.ts                    NEW  prom-client metrics
apps/media/src/outbox/outbox.drainer.ts      NEW  (copy of qc's)
apps/media/src/directory/lookup.ts           NEW  Lookup<T> + required()
apps/media/src/directory/qc.client.ts (+ .spec)      NEW
apps/media/src/directory/project.client.ts (+ .spec) NEW
apps/media/src/uploads/upload.service.ts     NEW
apps/media/src/uploads/upload.integration.spec.ts NEW
apps/media/src/uploads/upload.controller.ts  NEW
apps/media/src/verify/sniff.ts (+ .spec)     NEW  magic bytes
apps/media/src/verify/verify.worker.ts       NEW
apps/media/src/verify/verify.integration.spec.ts NEW
apps/media/src/viewing/view.service.ts       NEW
apps/media/src/viewing/view.controller.ts    NEW
apps/media/src/attach/attach.service.ts      NEW
apps/media/src/attach/attach.controller.ts   NEW
apps/media/src/viewing/view-attach.integration.spec.ts NEW
apps/media/src/cleanup/work-order-cancelled.consumer.ts NEW
apps/media/src/cleanup/discard.sweeper.ts    NEW
apps/media/src/cleanup/cleanup.integration.spec.ts NEW
apps/media/src/controllers.spec.ts           NEW  permission metadata on every route
apps/media/src/app.module.ts                 MOD  wiring
apps/media/src/main.ts                       MOD  exception filter, bucket bootstrap
docker/docker-compose.yml                    MOD  minio, media deps, secrets env_file
docker/env/media.env                         MOD  local MinIO values
docker/env/README.md                         MOD  secrets file + deployment checklist
.gitignore                                   MOD  docker/env/*.secrets.env
e2e/media.e2e.spec.ts                        NEW
```

---

### Task 1: Media contracts

**Files:**
- Create: `libs/contracts/src/media/media.ts`
- Create: `libs/contracts/src/media/media.spec.ts`
- Modify: `libs/contracts/src/index.ts`

**Interfaces:**
- Produces (all exported from `@ipms/contracts`): `MEDIA_LIMITS`, `MIB`, `MULTIPART_THRESHOLD_BYTES`, `PART_SIZE_BYTES`, `partCountFor(sizeBytes: number): number`, `MediaKind`, `MediaStatus`, `RejectReason`, `RegisterUploadSchema`/`RegisterUploadDto`, `UploadStatusRequestSchema`, `PartsRequestSchema`, `CompleteUploadSchema`/`CompleteUploadDto`, `AttachRequestSchema`/`AttachRequestDto`, `ViewUrlQuerySchema`, `ListMediaQuerySchema`, types `SignedPut`, `UploadInstructions`, `RegisterUploadResponse`, `UploadStatusItem`, `PartUrls`, `MediaView`, `AttachedMedia`, `SignedGet`.

- [ ] **Step 1: Write the failing test**

`libs/contracts/src/media/media.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AttachRequestSchema, MEDIA_LIMITS, MIB, RegisterUploadSchema, UploadStatusRequestSchema, partCountFor,
} from './media.js';

const id = (n: number) => `0192f7a0-0000-7000-8000-${n.toString().padStart(12, '0')}`;
const valid = {
  id: id(1), category: 'EVIDENCE', workOrderId: id(2), checklistItemId: id(3), kind: 'PHOTO',
  contentType: 'image/jpeg', sizeBytes: 1_200_000, contentHash: 'a'.repeat(64),
  capturedAt: '2026-09-28T08:00:00Z', latitude: 26.45, longitude: 87.28, deviceId: 'RMX3630-7f2c',
};

describe('RegisterUploadSchema', () => {
  it('accepts a phone registration and coerces the capture time', () => {
    const parsed = RegisterUploadSchema.parse(valid);
    expect(parsed.capturedAt).toBeInstanceOf(Date);
  });

  it('accepts a registration without a GPS fix', () => {
    const { latitude: _lat, longitude: _lng, ...noFix } = valid;
    expect(RegisterUploadSchema.safeParse(noFix).success).toBe(true);
  });

  it.each([
    ['an upper-case hash', { contentHash: 'A'.repeat(64) }],
    ['a short hash', { contentHash: 'a'.repeat(63) }],
    ['a gallery upload (not in media core)', { category: 'GALLERY' }],
    ['a document kind', { kind: 'DOCUMENT' }],
    ['a latitude off the planet', { latitude: 91 }],
    ['a zero size', { sizeBytes: 0 }],
    ['a v4 id', { id: '3b241101-e2bb-4255-8caf-4136c566a962' }],
  ])('refuses %s', (_label, patch) => {
    expect(RegisterUploadSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('limits and parts', () => {
  it('matches the agreed limits', () => {
    expect(MEDIA_LIMITS.PHOTO.maxBytes).toBe(5 * MIB);
    expect(MEDIA_LIMITS.VIDEO.maxBytes).toBe(100 * MIB);
    expect(MEDIA_LIMITS.DOCUMENT.maxBytes).toBe(20 * MIB);
  });

  it('splits a 100 MiB video into 20 parts and rounds a remainder up', () => {
    expect(partCountFor(100 * MIB)).toBe(20);
    expect(partCountFor(10 * MIB + 1)).toBe(3);
  });
});

describe('batch sizes', () => {
  it('caps the status check at 200 ids', () => {
    expect(UploadStatusRequestSchema.safeParse({ ids: Array.from({ length: 200 }, (_, i) => id(i)) }).success).toBe(true);
    expect(UploadStatusRequestSchema.safeParse({ ids: Array.from({ length: 201 }, (_, i) => id(i)) }).success).toBe(false);
  });

  it('refuses an empty attach', () => {
    expect(AttachRequestSchema.safeParse({ submissionId: id(1), siteId: id(2), mediaIds: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ipms/contracts exec vitest run src/media/media.spec.ts`
Expected: FAIL — `Cannot find module './media.js'`.

- [ ] **Step 3: Write the implementation**

`libs/contracts/src/media/media.ts`:

```ts
import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

export const MIB = 1024 * 1024;

export type MediaKind = 'PHOTO' | 'VIDEO' | 'DOCUMENT';
export type MediaCategory = 'EVIDENCE' | 'GALLERY' | 'TEMPLATE_DOCUMENT';
export type MediaStatus =
  | 'PENDING' | 'VERIFYING' | 'READY' | 'ATTACHED' | 'REJECTED' | 'DISCARDED' | 'PURGE_SCHEDULED' | 'PURGED';
export type RejectReason = 'HASH_MISMATCH' | 'SIZE_EXCEEDED' | 'TYPE_MISMATCH' | 'POSTER_MISSING';

/**
 * What the server accepts. The phone compresses before hashing (photos to
 * 2560 px / q80, videos to 720p H.264), so these are ceilings, not targets.
 */
export const MEDIA_LIMITS: Record<MediaKind, { contentTypes: readonly string[]; maxBytes: number }> = {
  PHOTO: { contentTypes: ['image/jpeg'], maxBytes: 5 * MIB },
  VIDEO: { contentTypes: ['video/mp4'], maxBytes: 100 * MIB },
  DOCUMENT: {
    contentTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/vnd.dwg', 'image/vnd.dxf', 'image/png', 'image/jpeg',
    ],
    maxBytes: 20 * MIB,
  },
};

/** Videos above this go up in parts, so a dropped connection resumes instead of restarting. */
export const MULTIPART_THRESHOLD_BYTES = 10 * MIB;
/** R2's minimum part size (every part but the last). */
export const PART_SIZE_BYTES = 5 * MIB;

export function partCountFor(sizeBytes: number): number {
  return Math.ceil(sizeBytes / PART_SIZE_BYTES);
}

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a lower-case hex SHA-256');

/**
 * A phone announcing one captured file. The id and hash are fixed at capture,
 * so every retry describes the same object. Project and site are not sent:
 * the server reads them from the work order, so a client cannot misfile.
 */
export const RegisterUploadSchema = z.object({
  id: UuidSchema,
  category: z.literal('EVIDENCE'),
  workOrderId: UuidSchema,
  checklistItemId: UuidSchema,
  kind: z.enum(['PHOTO', 'VIDEO']),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  contentHash: Sha256HexSchema,
  capturedAt: z.coerce.date(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  deviceId: z.string().trim().min(1).max(255),
}).strip();
export type RegisterUploadDto = z.infer<typeof RegisterUploadSchema>;

export const UploadStatusRequestSchema = z.object({ ids: z.array(UuidSchema).min(1).max(200) }).strip();

export const PartsRequestSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
}).strip();

export const CompleteUploadSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) })).max(10_000).optional(),
}).strip();
export type CompleteUploadDto = z.infer<typeof CompleteUploadSchema>;

export const AttachRequestSchema = z.object({
  submissionId: UuidSchema,
  siteId: UuidSchema,
  mediaIds: z.array(UuidSchema).min(1).max(500),
}).strip();
export type AttachRequestDto = z.infer<typeof AttachRequestSchema>;

export const ViewUrlQuerySchema = z.object({ variant: z.enum(['original', 'thumbnail']).default('original') }).strip();
export const ListMediaQuerySchema = z.object({ workOrderId: UuidSchema }).strip();

export interface SignedPut { signedUrl: string; headers: Record<string, string>; expiresAt: string }
export interface SignedGet { signedUrl: string; expiresAt: string }

export type UploadInstructions =
  | ({ mode: 'single' } & SignedPut)
  | { mode: 'multipart'; uploadId: string; partSize: number; partCount: number; parts: { partNumber: number; signedUrl: string }[]; expiresAt: string };

export interface RegisterUploadResponse {
  id: string;
  status: MediaStatus;
  /** Null once the file is past PENDING: there is nothing left to send. */
  upload: UploadInstructions | null;
  /** Videos only: where the phone-made poster frame goes. */
  posterUpload: SignedPut | null;
}

export interface UploadStatusItem {
  id: string;
  status: MediaStatus | 'UNKNOWN';
  rejectReason?: RejectReason;
  /** PENDING multipart uploads only: parts R2 already holds. */
  completedParts?: number[];
}

export interface PartUrls { parts: { partNumber: number; signedUrl: string }[]; expiresAt: string }

export interface MediaView {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  workOrderId: string | null;
  checklistItemId: string | null;
  contentHash: string;
  sizeBytes: number;
  capturedAt: string | null;
  receivedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceFromSiteM: number | null;
  uploadedBy: string;
  thumbnailUrl: string | null;
}

export interface AttachedMedia {
  id: string;
  kind: MediaKind;
  contentHash: string;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceFromSiteM: number | null;
}
```

Append to `libs/contracts/src/index.ts`:

```ts
export * from './media/media.js';
```

- [ ] **Step 4: Run tests, then build the library**

Run: `pnpm --filter @ipms/contracts exec vitest run src/media/media.spec.ts && pnpm --filter @ipms/contracts build`
Expected: all tests PASS; build exits 0.

- [ ] **Step 5: Commit**

```bash
git add libs/contracts/src/media libs/contracts/src/index.ts
git commit -m "feat(contracts): media upload, status, attach and view contracts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `qc.work_order.cancelled` event and `signedUrl` log redaction

**Files:**
- Modify: `libs/events/src/subjects.ts`
- Modify: `libs/events/src/subjects.spec.ts`
- Modify: `libs/events/src/payloads/qc.ts`
- Modify: `libs/observability/src/logger.ts:4-16`
- Modify: `libs/observability/src/logger.spec.ts`
- Modify: `apps/qc/src/work-orders/work-order.service.ts:186-200`
- Modify: `apps/qc/prisma/work-orders.integration.spec.ts:124-131`

**Interfaces:**
- Produces: `SUBJECTS.QC_WORK_ORDER_CANCELLED = 'qc.work_order.cancelled'`; durable `'media-work-order-cancelled'` on the `QC` stream; `interface QcWorkOrderCancelled { workOrderId: string; projectId: string; siteId: string; cancelledAt: string }` (ISO time), all from `@ipms/events`. Logger redacts any key named `signedUrl`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('durable naming', …)` in `libs/events/src/subjects.spec.ts`:

```ts
  it('gives media its own durable for cancelled work orders', () => {
    expect(SUBJECTS.QC_WORK_ORDER_CANCELLED).toBe('qc.work_order.cancelled');
    expect(STREAMS.QC.durableConsumers).toEqual(['media-work-order-cancelled']);
  });
```

Append inside `describe('createLogger', …)` in `libs/observability/src/logger.spec.ts` (it uses the file's existing `capture()` helper):

```ts
  it('redacts presigned URLs, which are bearer credentials while valid', () => {
    const { sink, lines } = capture();
    createLogger('media', sink).info({ upload: { signedUrl: 'https://r2.example/obj?X-Amz-Signature=abc' } }, 'presigned');
    expect(lines[0]).not.toContain('X-Amz-Signature');
    expect(JSON.parse(lines[0]!).upload.signedUrl).toBe('[Redacted]');
  });
```

In `apps/qc/prisma/work-orders.integration.spec.ts`, extend the test `'never moves a cancelled work order, and cannot change a closed one'` right after the `service.cancel(...)` line:

```ts
    const published = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'qc.work_order.cancelled' } });
    expect(published.payload).toMatchObject({ workOrderId: order.id, projectId: ANTENNA, siteId: ANTENNA_SITE });
    expect(typeof (published.payload as { cancelledAt: unknown }).cancelledAt).toBe('string');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ipms/events exec vitest run src/subjects.spec.ts; pnpm --filter @ipms/observability exec vitest run src/logger.spec.ts`
Expected: the two new tests FAIL (`undefined` subject; signature present in output).

- [ ] **Step 3: Implement**

`libs/events/src/subjects.ts` — add to `SUBJECTS`:

```ts
  QC_WORK_ORDER_CANCELLED: 'qc.work_order.cancelled',
```

and replace the `QC` stream's comment and `durableConsumers`:

```ts
  QC: {
    name: 'QC',
    subjects: ['qc.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    // Submission facts have no consumer yet (notifications will). media hears of
    // cancelled work orders so it can release their unsubmitted evidence.
    durableConsumers: ['media-work-order-cancelled'],
  },
```

`libs/events/src/payloads/qc.ts` — append:

```ts
/** A work order left the open states without completing. `cancelledAt` is ISO-8601. */
export interface QcWorkOrderCancelled {
  workOrderId: string;
  projectId: string;
  siteId: string;
  cancelledAt: string;
}
```

`libs/observability/src/logger.ts` — add `'signedUrl'` to `SECRET_KEYS`:

```ts
  'cookie',
  // Presigned object-storage URLs grant access until they expire.
  'signedUrl',
];
```

`apps/qc/src/work-orders/work-order.service.ts` — add imports at the top:

```ts
import { SUBJECTS, type QcWorkOrderCancelled } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord } from '@ipms/persistence';
```

and inside `cancel()`'s transaction, after `await event(tx, id, 'CANCELLED', …)`:

```ts
      const cancelled: QcWorkOrderCancelled = {
        workOrderId: id, projectId: current.projectId, siteId: current.siteId, cancelledAt: now.toISOString(),
      };
      await tx.outboxEvent.create({
        data: buildOutboxRecord(SUBJECTS.QC_WORK_ORDER_CANCELLED, { ...cancelled }, getCorrelationId() ?? 'unknown', actorId),
      });
```

- [ ] **Step 4: Rebuild libraries and run all affected tests**

Run:
```bash
pnpm --filter @ipms/events build && pnpm --filter @ipms/observability build
pnpm --filter @ipms/events test && pnpm --filter @ipms/observability test
pnpm --filter qc exec vitest run prisma/work-orders.integration.spec.ts
```
Expected: all PASS (the qc run needs Docker for Testcontainers).

- [ ] **Step 5: Commit**

```bash
git add libs/events libs/observability/src apps/qc/src/work-orders/work-order.service.ts apps/qc/prisma/work-orders.integration.spec.ts
git commit -m "feat(qc): publish qc.work_order.cancelled; redact signed URLs in logs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Storage client, configuration and local MinIO

**Files:**
- Modify: `apps/media/package.json`, `apps/media/vitest.config.ts`
- Create: `apps/media/src/config.ts`, `apps/media/src/config.spec.ts`
- Create: `apps/media/src/storage/storage.client.ts`
- Create: `apps/media/src/testing/minio.ts`
- Create: `apps/media/src/storage/storage.integration.spec.ts`
- Modify: `docker/docker-compose.yml`, `docker/env/media.env`, `.gitignore`

**Interfaces:**
- Produces:
  - `interface StorageConfig { endpoint; publicEndpoint; region; bucket; accessKeyId; secretAccessKey; forcePathStyle: boolean; autoCreateBucket: boolean }`
  - `interface MediaConfig { storage: StorageConfig; natsUrl: string; qcUrl: string; projectUrl: string }`, `loadConfig(env?: NodeJS.ProcessEnv): MediaConfig`
  - `class StorageClient` with: `isHealthy(): Promise<boolean>`, `ensureBucket(): Promise<void>`, `presignPut(key, o: { contentType: string; sizeBytes?: number; sha256Hex?: string }, ttlSeconds): Promise<SignedPut>`, `createMultipart(key, contentType): Promise<string>`, `presignPart(key, uploadId, partNumber, ttlSeconds): Promise<string>`, `listParts(key, uploadId): Promise<{ partNumber: number; etag: string }[] | null>` (null = upload gone), `completeMultipart(key, uploadId, parts): Promise<void>`, `abortMultipart(key, uploadId): Promise<void>`, `head(key): Promise<{ sizeBytes: number } | null>`, `getStream(key): Promise<Readable>`, `put(key, body: Buffer, contentType): Promise<void>`, `delete(keys: string[]): Promise<void>`, `presignGet(key, ttlSeconds, downloadName): Promise<SignedGet>`
  - `startMinio(): Promise<{ storage: StorageConfig; client: StorageClient; stop(): Promise<void> }>` (tests only)

- [ ] **Step 1: Confirm the MinIO image and add dependencies**

MinIO stopped publishing new community images in late 2025; existing tags still pull. Run:

```bash
docker pull minio/minio:RELEASE.2025-04-22T22-12-26Z
```

Expected: pull succeeds. If it does not, open https://hub.docker.com/r/minio/minio/tags, pick the newest `RELEASE.*` tag that pulls, and use that exact tag everywhere this plan says `RELEASE.2025-04-22T22-12-26Z`.

```bash
pnpm --filter media add -E @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp@0.35.4 prom-client@15.1.3 @ipms/events@workspace:* @ipms/geo@workspace:*
pnpm --filter media add -DE testcontainers@12.1.0 @testcontainers/postgresql@12.1.0 reflect-metadata@0.2.2
```

Replace `apps/media/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    // Resolves DOCKER_HOST for Testcontainers on a fresh clone and in CI.
    setupFiles: ['../../tools/vitest-setup-containers.ts'],
    // Postgres and MinIO containers start per file.
    hookTimeout: 180_000,
  },
});
```

- [ ] **Step 2: Write the failing config test**

`apps/media/src/config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_BUCKET: 'ipms-media-prod',
  S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret', NATS_URL: 'nats://nats:4222',
};

describe('loadConfig', () => {
  it('defaults region, public endpoint, path style and service URLs', () => {
    const config = loadConfig(base);
    expect(config.storage).toMatchObject({
      region: 'auto', publicEndpoint: 'https://acc.r2.cloudflarestorage.com', forcePathStyle: false, autoCreateBucket: false,
    });
    expect(config.qcUrl).toBe('http://qc:3005');
    expect(config.projectUrl).toBe('http://project:3004');
  });

  it('reads the MinIO overrides', () => {
    const config = loadConfig({ ...base, S3_PUBLIC_ENDPOINT: 'http://localhost:9000', S3_FORCE_PATH_STYLE: 'true', S3_AUTO_CREATE_BUCKET: 'true' });
    expect(config.storage).toMatchObject({ publicEndpoint: 'http://localhost:9000', forcePathStyle: true, autoCreateBucket: true });
  });

  it.each(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'NATS_URL'])('refuses to start without %s', (name) => {
    expect(() => loadConfig({ ...base, [name]: '' })).toThrow(`${name} is not set`);
  });
});
```

Run: `pnpm --filter media exec vitest run src/config.spec.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement config**

`apps/media/src/config.ts`:

```ts
export interface StorageConfig {
  /** Where media itself talks to storage (inside Docker: http://minio:9000). */
  endpoint: string;
  /** The host baked into presigned URLs — what a phone can reach. Same as endpoint for R2. */
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Local MinIO only. R2 tokens cannot create buckets, and prod buckets are made by hand. */
  autoCreateBucket: boolean;
}

export interface MediaConfig {
  storage: StorageConfig;
  natsUrl: string;
  qcUrl: string;
  projectUrl: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Read once at bootstrap; a missing storage setting stops the service rather than failing on the first upload. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const endpoint = required(env, 'S3_ENDPOINT');
  return {
    storage: {
      endpoint,
      publicEndpoint: env['S3_PUBLIC_ENDPOINT']?.trim() || endpoint,
      region: env['S3_REGION']?.trim() || 'auto',
      bucket: required(env, 'S3_BUCKET'),
      accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
      forcePathStyle: env['S3_FORCE_PATH_STYLE'] === 'true',
      autoCreateBucket: env['S3_AUTO_CREATE_BUCKET'] === 'true',
    },
    natsUrl: required(env, 'NATS_URL'),
    qcUrl: env['QC_INTERNAL_URL']?.trim() || 'http://qc:3005',
    projectUrl: env['PROJECT_INTERNAL_URL']?.trim() || 'http://project:3004',
  };
}
```

Run: `pnpm --filter media exec vitest run src/config.spec.ts` — Expected: PASS.

- [ ] **Step 4: Write the failing storage integration test and MinIO helper**

`apps/media/src/testing/minio.ts`:

```ts
import { GenericContainer, Wait } from 'testcontainers';
import type { StorageConfig } from '../config.js';
import { StorageClient } from '../storage/storage.client.js';

export const MINIO_IMAGE = 'minio/minio:RELEASE.2025-04-22T22-12-26Z';

/** A throwaway S3-compatible store with an empty `ipms-media-test` bucket. */
export async function startMinio(): Promise<{ storage: StorageConfig; client: StorageClient; stop(): Promise<void> }> {
  const container = await new GenericContainer(MINIO_IMAGE)
    .withEnvironment({ MINIO_ROOT_USER: 'ipms_test', MINIO_ROOT_PASSWORD: 'ipms_test_secret' })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  const storage: StorageConfig = {
    endpoint, publicEndpoint: endpoint, region: 'us-east-1', bucket: 'ipms-media-test',
    accessKeyId: 'ipms_test', secretAccessKey: 'ipms_test_secret', forcePathStyle: true, autoCreateBucket: true,
  };
  const client = new StorageClient(storage);
  await client.ensureBucket();
  return { storage, client, async stop() { await container.stop(); } };
}
```

`apps/media/src/storage/storage.integration.spec.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PART_SIZE_BYTES } from '@ipms/contracts';
import { startMinio } from '../testing/minio.js';
import type { StorageClient } from './storage.client.js';

let minio: Awaited<ReturnType<typeof startMinio>>;
let storage: StorageClient;
beforeAll(async () => { minio = await startMinio(); storage = minio.client; });
afterAll(async () => { await minio?.stop(); });

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const put = (url: string, body: Buffer, headers: Record<string, string>) =>
  fetch(url, { method: 'PUT', body, headers });

describe('StorageClient against MinIO', () => {
  it('reports a reachable bucket as healthy', async () => {
    expect(await storage.isHealthy()).toBe(true);
  });

  it('accepts exactly the bytes a presigned PUT was signed for', async () => {
    const body = randomBytes(2048);
    const signed = await storage.presignPut('t/ok.jpg', { contentType: 'image/jpeg', sizeBytes: body.length, sha256Hex: sha(body) }, 3600);
    expect(signed.headers).toMatchObject({ 'content-type': 'image/jpeg' });
    expect((await put(signed.signedUrl, body, signed.headers)).status).toBe(200);
    expect(await storage.head('t/ok.jpg')).toEqual({ sizeBytes: 2048 });
  });

  it('refuses different bytes of the same length under the same signature', async () => {
    const body = randomBytes(2048);
    const signed = await storage.presignPut('t/tampered.jpg', { contentType: 'image/jpeg', sizeBytes: body.length, sha256Hex: sha(body) }, 3600);
    const response = await put(signed.signedUrl, randomBytes(2048), signed.headers);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.head('t/tampered.jpg')).toBeNull();
  });

  it('resumes a multipart upload from the parts already stored', async () => {
    const body = randomBytes(PART_SIZE_BYTES * 2 + 1234);
    const uploadId = await storage.createMultipart('t/video.mp4', 'video/mp4');
    const partOf = (n: number) => body.subarray((n - 1) * PART_SIZE_BYTES, n * PART_SIZE_BYTES);
    const first = await fetch(await storage.presignPart('t/video.mp4', uploadId, 1, 3600), { method: 'PUT', body: partOf(1) });
    expect(first.status).toBe(200);

    // The phone reconnects and asks what arrived.
    expect((await storage.listParts('t/video.mp4', uploadId))?.map((p) => p.partNumber)).toEqual([1]);
    for (const n of [2, 3]) {
      await fetch(await storage.presignPart('t/video.mp4', uploadId, n, 3600), { method: 'PUT', body: partOf(n) });
    }
    const parts = (await storage.listParts('t/video.mp4', uploadId))!;
    await storage.completeMultipart('t/video.mp4', uploadId, parts);

    const chunks: Buffer[] = [];
    for await (const chunk of await storage.getStream('t/video.mp4')) chunks.push(chunk as Buffer);
    expect(sha(Buffer.concat(chunks))).toBe(sha(body));
  });

  it('answers null for parts of an upload that no longer exists', async () => {
    const uploadId = await storage.createMultipart('t/gone.mp4', 'video/mp4');
    await storage.abortMultipart('t/gone.mp4', uploadId);
    expect(await storage.listParts('t/gone.mp4', uploadId)).toBeNull();
    await storage.abortMultipart('t/gone.mp4', uploadId); // idempotent
  });

  it('signs a short-lived download with a readable name, and deletes', async () => {
    await storage.put('t/dl.jpg', Buffer.from('jpeg'), 'image/jpeg');
    const signed = await storage.presignGet('t/dl.jpg', 300, 'KOS121_20260928-080000_abc123.jpg');
    const response = await fetch(signed.signedUrl);
    expect(response.headers.get('content-disposition')).toContain('KOS121_20260928-080000_abc123.jpg');
    await storage.delete(['t/dl.jpg']);
    expect(await storage.head('t/dl.jpg')).toBeNull();
  });
});
```

Run: `pnpm --filter media exec vitest run src/storage/storage.integration.spec.ts` — Expected: FAIL (`storage.client.js` missing).

- [ ] **Step 5: Implement the storage client**

`apps/media/src/storage/storage.client.ts`:

```ts
import type { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateBucketCommand, CreateMultipartUploadCommand,
  DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, ListPartsCommand, PutObjectCommand,
  S3Client, S3ServiceException, UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { SignedGet, SignedPut } from '@ipms/contracts';
import type { StorageConfig } from '../config.js';

const isMissing = (err: unknown): boolean =>
  err instanceof S3ServiceException && (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.name === 'NoSuchUpload' || err.$metadata.httpStatusCode === 404);

const hexToBase64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64');
const expiresAt = (ttlSeconds: number): string => new Date(Date.now() + ttlSeconds * 1000).toISOString();

/**
 * Every call media makes to object storage. R2 and MinIO both speak S3.
 *
 * Two SDK clients: one for media's own calls (the Docker-internal endpoint)
 * and one whose only job is signing URLs with the host a phone can reach.
 * Checksum defaults are pinned to WHEN_REQUIRED: newer SDKs otherwise add
 * CRC32 checksums to every request, which R2 and presigned URLs mishandle.
 */
export class StorageClient {
  private readonly internal: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly config: StorageConfig) {
    const base = {
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    } as const;
    this.internal = new S3Client({ ...base, endpoint: config.endpoint });
    this.signer = new S3Client({ ...base, endpoint: config.publicEndpoint });
  }

  private get bucket(): string { return this.config.bucket; }

  async isHealthy(): Promise<boolean> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  async ensureBucket(): Promise<void> {
    if (await this.isHealthy()) return;
    await this.internal.send(new CreateBucketCommand({ Bucket: this.bucket }));
  }

  /**
   * A PUT URL bound to the declared size, type and SHA-256 when given, so
   * storage itself refuses any other bytes. The phone must send `headers`
   * exactly as returned.
   */
  async presignPut(key: string, o: { contentType: string; sizeBytes?: number; sha256Hex?: string }, ttlSeconds: number): Promise<SignedPut> {
    const command = new PutObjectCommand({
      Bucket: this.bucket, Key: key, ContentType: o.contentType,
      ...(o.sizeBytes === undefined ? {} : { ContentLength: o.sizeBytes }),
      ...(o.sha256Hex === undefined ? {} : { ChecksumSHA256: hexToBase64(o.sha256Hex) }),
    });
    const signable = new Set(['content-type']);
    if (o.sizeBytes !== undefined) signable.add('content-length');
    if (o.sha256Hex !== undefined) signable.add('x-amz-checksum-sha256');
    const signedUrl = await getSignedUrl(this.signer, command, {
      expiresIn: ttlSeconds, signableHeaders: signable, unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    const headers: Record<string, string> = { 'content-type': o.contentType };
    if (o.sha256Hex !== undefined) headers['x-amz-checksum-sha256'] = hexToBase64(o.sha256Hex);
    return { signedUrl, headers, expiresAt: expiresAt(ttlSeconds) };
  }

  async createMultipart(key: string, contentType: string): Promise<string> {
    const out = await this.internal.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    if (!out.UploadId) throw new Error('Storage returned no multipart upload id');
    return out.UploadId;
  }

  presignPart(key: string, uploadId: string, partNumber: number, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.signer, new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn: ttlSeconds });
  }

  async listParts(key: string, uploadId: string): Promise<{ partNumber: number; etag: string }[] | null> {
    try {
      const out = await this.internal.send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, MaxParts: 1000 }));
      return (out.Parts ?? []).map((p) => ({ partNumber: p.PartNumber!, etag: p.ETag! }));
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    await this.internal.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket, Key: key, UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    try {
      await this.internal.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const out = await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: out.ContentLength ?? 0 };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async getStream(key: string): Promise<Readable> {
    const out = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.internal.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.internal.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
  }

  async presignGet(key: string, ttlSeconds: number, downloadName: string): Promise<SignedGet> {
    const safe = downloadName.replace(/[^A-Za-z0-9._-]/g, '_');
    const signedUrl = await getSignedUrl(this.signer, new GetObjectCommand({
      Bucket: this.bucket, Key: key, ResponseContentDisposition: `inline; filename="${safe}"`,
    }), { expiresIn: ttlSeconds });
    return { signedUrl, expiresAt: expiresAt(ttlSeconds) };
  }
}
```

- [ ] **Step 6: Run the storage tests**

Run: `pnpm --filter media exec vitest run src/storage/storage.integration.spec.ts`
Expected: all 6 PASS.

If **"refuses different bytes"** fails (storage accepted the tampered body), MinIO is not enforcing the signed checksum header. Do not weaken the test: check that the request actually carried `x-amz-checksum-sha256` (log `signed.signedUrl` locally — never commit that log) and that `unhoistableHeaders` kept it out of the query string. The server-side hash check in Task 8 is the second layer either way, and the staging smoke test (Task 12) confirms R2's behaviour.

- [ ] **Step 7: Compose, env and gitignore**

`.gitignore` — append:

```
# Real object-storage credentials live only on servers.
docker/env/*.secrets.env
```

`docker/env/media.env` — replace with:

```
PORT=3006
NODE_ENV=production
LOG_LEVEL=info
JWT_SECRET=super_secret_jwt_key_for_local_dev
DATABASE_URL=postgresql://ipms_media:ipms_media@postgres-media:5432/ipms_media
MEDIA_DATABASE_URL=postgresql://ipms_media:ipms_media@postgres-media:5432/ipms_media
NATS_URL=nats://nats:4222
QC_INTERNAL_URL=http://qc:3005
PROJECT_INTERNAL_URL=http://project:3004
# Local MinIO. Staging and production override every S3_* value from
# docker/env/media.secrets.env (gitignored), which only exists on servers.
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=ipms-media-local
S3_ACCESS_KEY_ID=ipms_media
S3_SECRET_ACCESS_KEY=ipms_media_local_secret
S3_FORCE_PATH_STYLE=true
S3_AUTO_CREATE_BUCKET=true
```

`docker/docker-compose.yml` — add a `minio` service after `redis`:

```yaml
  # Local stand-in for Cloudflare R2. Never used in staging or production.
  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    command: ["server", "/data"]
    environment:
      MINIO_ROOT_USER: ipms_media
      MINIO_ROOT_PASSWORD: ipms_media_local_secret
    volumes:
      - minio-data:/data
    ports:
      - "${MINIO_PORT:-9000}:9000"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped
```

add `minio-data:` under the top-level `volumes:` key, and replace the `media` service's comment, `env_file` and `depends_on`:

```yaml
  media:
    <<: *service-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      args: { SERVICE: media }
    env_file:
      - ./env/media.env
      # Servers only: real R2 credentials, overriding the MinIO values above.
      - path: ./env/media.secrets.env
        required: false
    depends_on:
      postgres-media: { condition: service_healthy }
      media-migrate:  { condition: service_completed_successfully }
      nats:           { condition: service_healthy }
      minio:          { condition: service_healthy }
```

(keep the existing `healthcheck` block unchanged).

Run: `docker compose -f docker/docker-compose.yml config --quiet`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/media/package.json apps/media/vitest.config.ts apps/media/src/config.ts apps/media/src/config.spec.ts apps/media/src/storage apps/media/src/testing pnpm-lock.yaml docker/docker-compose.yml docker/env/media.env .gitignore
git commit -m "feat(media): R2/S3 storage client, config and local MinIO

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `MediaObject` schema, keys, statuses and filenames

**Files:**
- Modify: `apps/media/prisma/schema.prisma`
- Create: `apps/media/prisma/migrations/20260928000100_media_core/migration.sql`
- Create: `apps/media/prisma/test-db.ts`
- Create: `apps/media/src/storage/keys.ts`, `apps/media/src/storage/keys.spec.ts`
- Create: `apps/media/src/media/status.ts`, `apps/media/src/media/status.spec.ts`
- Create: `apps/media/src/media/filename.ts`, `apps/media/src/media/filename.spec.ts`

**Interfaces:**
- Produces:
  - Prisma model `MediaObject` (fields below) in `@prisma-clients/media`
  - `evidenceKeys(o: { projectId: string; siteId: string; id: string; kind: 'PHOTO' | 'VIDEO' }): { storageKey: string; thumbnailKey: string }`
  - `PRE_ATTACH: readonly MediaStatus[]` = PENDING, VERIFYING, READY, REJECTED; `VIEWABLE` = READY, ATTACHED, PURGE_SCHEDULED; `LOCKED` = ATTACHED, PURGE_SCHEDULED, PURGED
  - `readableName(o: { siteCode: string | null; capturedAt: Date | null; id: string; variant: 'original' | 'thumbnail'; kind: MediaKind }): string`
  - `startTestDb(): Promise<{ prisma: PrismaClient; stop(): Promise<void> }>`

- [ ] **Step 1: Write the failing unit tests**

`apps/media/src/storage/keys.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evidenceKeys } from './keys.js';

const P = '0192f7a0-0000-7000-8000-000000000001';
const S = '0192f7a0-0000-7000-8000-000000000002';
const M = '0192f7a0-0000-7000-8000-000000000003';

describe('evidenceKeys', () => {
  it('files a photo and its thumbnail under project and site', () => {
    expect(evidenceKeys({ projectId: P, siteId: S, id: M, kind: 'PHOTO' })).toEqual({
      storageKey: `projects/${P}/sites/${S}/evidence/${M}.jpg`,
      thumbnailKey: `projects/${P}/sites/${S}/evidence/${M}.thumb.webp`,
    });
  });

  it('gives a video a phone-made poster', () => {
    expect(evidenceKeys({ projectId: P, siteId: S, id: M, kind: 'VIDEO' }).thumbnailKey).toBe(`projects/${P}/sites/${S}/evidence/${M}.poster.jpg`);
  });

  it('refuses anything that is not a UUID, so no caller can steer a key', () => {
    expect(() => evidenceKeys({ projectId: '../other', siteId: S, id: M, kind: 'PHOTO' })).toThrow('Invalid id');
  });
});
```

`apps/media/src/media/status.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LOCKED, PRE_ATTACH, VIEWABLE } from './status.js';

describe('status groups', () => {
  it('lets retakes and cancellations remove only what is not in a submission', () => {
    expect([...PRE_ATTACH].sort()).toEqual(['PENDING', 'READY', 'REJECTED', 'VERIFYING']);
    for (const status of LOCKED) expect(PRE_ATTACH).not.toContain(status);
  });

  it('only serves verified, still-stored files', () => {
    expect([...VIEWABLE].sort()).toEqual(['ATTACHED', 'PURGE_SCHEDULED', 'READY']);
  });
});
```

`apps/media/src/media/filename.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readableName } from './filename.js';

const id = '0192f7a0-0000-7000-8000-00000000abcd';

describe('readableName', () => {
  it('names a download by site code, capture time (UTC) and a short id', () => {
    expect(readableName({ siteCode: 'KOS121', capturedAt: new Date('2026-09-28T08:05:09Z'), id, variant: 'original', kind: 'PHOTO' }))
      .toBe('KOS121_20260928-080509_00abcd.jpg');
  });

  it('uses the thumbnail and video extensions', () => {
    expect(readableName({ siteCode: 'KOS121', capturedAt: null, id, variant: 'thumbnail', kind: 'PHOTO' })).toBe('KOS121_undated_00abcd.webp');
    expect(readableName({ siteCode: null, capturedAt: null, id, variant: 'original', kind: 'VIDEO' })).toBe('site_undated_00abcd.mp4');
    expect(readableName({ siteCode: 'KOS121', capturedAt: null, id, variant: 'thumbnail', kind: 'VIDEO' })).toBe('KOS121_undated_00abcd.jpg');
  });
});
```

Run: `pnpm --filter media exec vitest run src/storage/keys.spec.ts src/media` — Expected: FAIL (modules missing).

- [ ] **Step 2: Implement keys, statuses and filenames**

`apps/media/src/storage/keys.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checked(value: string): string {
  if (!UUID.test(value)) throw new Error(`Invalid id in storage key: ${value}`);
  return value;
}

/**
 * IDs, never codes: a site code can be edited and R2 cannot rename. Everything
 * for one project sits under `projects/{projectId}/`, which is what the purge
 * in sub-project 5 deletes.
 */
export function evidenceKeys(o: { projectId: string; siteId: string; id: string; kind: 'PHOTO' | 'VIDEO' }): { storageKey: string; thumbnailKey: string } {
  const base = `projects/${checked(o.projectId)}/sites/${checked(o.siteId)}/evidence/${checked(o.id)}`;
  return o.kind === 'PHOTO'
    ? { storageKey: `${base}.jpg`, thumbnailKey: `${base}.thumb.webp` }
    : { storageKey: `${base}.mp4`, thumbnailKey: `${base}.poster.jpg` };
}
```

`apps/media/src/media/status.ts`:

```ts
import type { MediaStatus } from '@ipms/contracts';

/** Not yet part of any submission: a retake or a cancelled work order may remove these. */
export const PRE_ATTACH: readonly MediaStatus[] = ['PENDING', 'VERIFYING', 'READY', 'REJECTED'];
/** Verified and still in storage. */
export const VIEWABLE: readonly MediaStatus[] = ['READY', 'ATTACHED', 'PURGE_SCHEDULED'];
/** Evidence of record: only the admin purge (sub-project 5) may remove it. */
export const LOCKED: readonly MediaStatus[] = ['ATTACHED', 'PURGE_SCHEDULED', 'PURGED'];
```

`apps/media/src/media/filename.ts`:

```ts
import type { MediaKind } from '@ipms/contracts';

const pad = (n: number) => n.toString().padStart(2, '0');

function stamp(at: Date | null): string {
  if (!at) return 'undated';
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
}

/** What a download is called on the reviewer's disk; the bucket key itself is all IDs. */
export function readableName(o: { siteCode: string | null; capturedAt: Date | null; id: string; variant: 'original' | 'thumbnail'; kind: MediaKind }): string {
  const ext = o.variant === 'thumbnail' ? (o.kind === 'VIDEO' ? 'jpg' : 'webp') : (o.kind === 'VIDEO' ? 'mp4' : 'jpg');
  return `${o.siteCode ?? 'site'}_${stamp(o.capturedAt)}_${o.id.slice(-6)}.${ext}`;
}
```

Run: `pnpm --filter media exec vitest run src/storage/keys.spec.ts src/media` — Expected: PASS.

- [ ] **Step 3: Reshape the Prisma model**

In `apps/media/prisma/schema.prisma`, replace the whole `model MediaObject { … }` block (keep the generator, datasource and `OutboxEvent`):

```prisma
/// One file in object storage, or the tombstone of one that was removed.
/// Project, site and work order ids point into other services: no foreign keys.
model MediaObject {
  /// Made on the phone (UUIDv7) at capture, so every retry is the same object.
  id                     String    @id @db.Uuid
  /// PHOTO | VIDEO | DOCUMENT
  kind                   String    @db.VarChar(20)
  /// EVIDENCE | GALLERY | TEMPLATE_DOCUMENT
  category               String    @db.VarChar(30)
  contentType            String    @db.VarChar(100)
  sizeBytes              Int
  originalFilename       String?   @db.VarChar(255)
  projectId              String?   @db.Uuid
  siteId                 String?   @db.Uuid
  /// The site code when the file was registered, for readable download names.
  siteCode               String?   @db.VarChar(50)
  workOrderId            String?   @db.Uuid
  checklistItemId        String?   @db.Uuid
  templateId             String?   @db.Uuid
  templateVersionId      String?   @db.Uuid
  storageKey             String    @unique @db.VarChar(500)
  /// Server-made WebP for photos; phone-made poster JPEG for videos.
  thumbnailKey           String?   @db.VarChar(500)
  /// Set only while a multipart upload is open.
  multipartUploadId      String?   @db.VarChar(1024)
  /// SHA-256 the phone computed at capture; the server must reproduce it.
  contentHash            String    @db.VarChar(64)
  hashVerified           Boolean   @default(false)
  capturedAt             DateTime? @db.Timestamptz(6)
  latitude               Decimal?  @db.Decimal(10, 7)
  longitude              Decimal?  @db.Decimal(10, 7)
  distanceFromSiteM      Int?
  deviceId               String?   @db.VarChar(255)
  uploadedBy             String    @db.Uuid
  createdAt              DateTime  @default(now()) @db.Timestamptz(6)
  /// When the phone reported the upload complete.
  receivedAt             DateTime? @db.Timestamptz(6)
  /// PENDING | VERIFYING | READY | ATTACHED | REJECTED | DISCARDED | PURGE_SCHEDULED | PURGED
  status                 String    @default("PENDING") @db.VarChar(20)
  rejectReason           String?   @db.VarChar(30)
  verifyAttempts         Int       @default(0)
  /// Verification lease / retry time. Null while not queued, or after retries ran out.
  nextAttemptAt          DateTime? @db.Timestamptz(6)
  attachedToSubmissionId String?   @db.Uuid
  attachedAt             DateTime? @db.Timestamptz(6)
  /// Set when the work order is cancelled; the sweeper discards after it.
  discardAfter           DateTime? @db.Timestamptz(6)
  discardedAt            DateTime? @db.Timestamptz(6)
  purgeScheduledAt       DateTime? @db.Timestamptz(6)
  purgedAt               DateTime? @db.Timestamptz(6)
  /// Stays false until sub-project 3 designs watermark signing.
  watermarkVerified      Boolean   @default(false)

  @@index([contentHash])
  @@index([status, nextAttemptAt])
  @@index([workOrderId])
  @@index([uploadedBy, status])
  @@index([projectId])
  @@index([discardAfter])
  @@map("media_object")
}
```

- [ ] **Step 4: Write the migration**

`apps/media/prisma/migrations/20260928000100_media_core/migration.sql`:

```sql
-- The scaffold table never held rows (no endpoint could write one), so it is
-- replaced rather than altered column by column.
DROP TABLE "media_object";

CREATE TABLE "media_object" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalFilename" VARCHAR(255),
    "projectId" UUID,
    "siteId" UUID,
    "siteCode" VARCHAR(50),
    "workOrderId" UUID,
    "checklistItemId" UUID,
    "templateId" UUID,
    "templateVersionId" UUID,
    "storageKey" VARCHAR(500) NOT NULL,
    "thumbnailKey" VARCHAR(500),
    "multipartUploadId" VARCHAR(1024),
    "contentHash" VARCHAR(64) NOT NULL,
    "hashVerified" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMPTZ(6),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "distanceFromSiteM" INTEGER,
    "deviceId" VARCHAR(255),
    "uploadedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "rejectReason" VARCHAR(30),
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6),
    "attachedToSubmissionId" UUID,
    "attachedAt" TIMESTAMPTZ(6),
    "discardAfter" TIMESTAMPTZ(6),
    "discardedAt" TIMESTAMPTZ(6),
    "purgeScheduledAt" TIMESTAMPTZ(6),
    "purgedAt" TIMESTAMPTZ(6),
    "watermarkVerified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "media_object_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_object_storageKey_key" ON "media_object"("storageKey");
CREATE INDEX "media_object_contentHash_idx" ON "media_object"("contentHash");
CREATE INDEX "media_object_status_nextAttemptAt_idx" ON "media_object"("status", "nextAttemptAt");
CREATE INDEX "media_object_workOrderId_idx" ON "media_object"("workOrderId");
CREATE INDEX "media_object_uploadedBy_status_idx" ON "media_object"("uploadedBy", "status");
CREATE INDEX "media_object_projectId_idx" ON "media_object"("projectId");
CREATE INDEX "media_object_discardAfter_idx" ON "media_object"("discardAfter");
```

`apps/media/prisma/test-db.ts`:

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/media';

export async function startTestDb(): Promise<{ prisma: PrismaClient; stop(): Promise<void> }> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // fileURLToPath, not URL.pathname: the latter can stay percent-encoded on macOS.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return { prisma, async stop() { await prisma.$disconnect(); await container.stop(); } };
}
```

- [ ] **Step 5: Generate the client and check the migration matches the schema**

Run:

```bash
pnpm --filter media prisma:generate
docker run -d --rm --name media-drift -e POSTGRES_PASSWORD=x -p 55437:5432 postgres:17-alpine && sleep 4
pnpm --filter media exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --shadow-database-url postgresql://postgres:x@localhost:55437/postgres --exit-code
docker stop media-drift
```

Expected: `generate` succeeds; `migrate diff` prints `No difference detected.` and exits 0. If it prints SQL, the migration and schema disagree: fix `migration.sql` to match and repeat. (If `--shadow-database-url` is rejected by this Prisma version, add `shadowDatabaseUrl` under `datasource` in `apps/media/prisma.config.ts` for the command only, and don't commit that change.)

- [ ] **Step 6: Run the unit tests and typecheck**

Run: `pnpm --filter media exec vitest run src/storage/keys.spec.ts src/media && pnpm --filter media typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/media/prisma apps/media/src/storage/keys.ts apps/media/src/storage/keys.spec.ts apps/media/src/media
git commit -m "feat(media): reshape MediaObject for uploads; key, status and filename rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Directory clients for `qc` and `project`

**Files:**
- Create: `apps/media/src/directory/lookup.ts`
- Create: `apps/media/src/directory/qc.client.ts`, `apps/media/src/directory/qc.client.spec.ts`
- Create: `apps/media/src/directory/project.client.ts`, `apps/media/src/directory/project.client.spec.ts`

**Interfaces:**
- Produces:
  - `type Lookup<T> = { state: 'found'; value: T } | { state: 'not_found' } | { state: 'forbidden' } | { state: 'unavailable' }`, `required<T>(lookup: Lookup<T>, what: string): T` (throws 404/403/503)
  - `interface WorkOrderRef { id: string; projectId: string; siteId: string; siteCode: string; status: string }`, `OPEN_WORK_ORDER = ['NOT_STARTED','ONGOING','REVIEWING','RECTIFYING']`
  - `class QcClient { constructor(baseUrl: string, timeoutMs?: number); workOrder(id: string, bearer: string): Promise<Lookup<WorkOrderRef>> }`
  - `interface SiteGeofence { latitude: number | null; longitude: number | null; effectiveRadiusM: number | null }`
  - `class ProjectClient { constructor(baseUrl: string, timeoutMs?: number); scope(bearer): Promise<Lookup<AuthzScope>>; geofence(siteId, bearer): Promise<SiteGeofence | null> }`
  - `distanceFromSite(site: SiteGeofence | null, lat?: number, lng?: number): number | null` (rounded metres)

- [ ] **Step 1: Write the failing tests**

`apps/media/src/directory/qc.client.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QcClient } from './qc.client.js';

const ID = '0192f7a0-0000-7000-8000-000000000001';
const respond = (status: number, body: unknown = {}) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.restoreAllMocks());

describe('QcClient.workOrder', () => {
  it('reads project, site and status from qc, forwarding the caller token', async () => {
    const fetchSpy = respond(200, { id: ID, projectId: 'p', siteId: 's', status: 'ONGOING', site: { siteCode: 'KOS121' } });
    const lookup = await new QcClient('http://qc:3005').workOrder(ID, 'Bearer t');
    expect(lookup).toEqual({ state: 'found', value: { id: ID, projectId: 'p', siteId: 's', siteCode: 'KOS121', status: 'ONGOING' } });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`http://qc:3005/api/v1/work-orders/${ID}`);
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer t' });
  });

  it.each([[404, 'not_found'], [403, 'forbidden'], [502, 'unavailable']])('maps %i to %s', async (status, state) => {
    respond(status);
    expect((await new QcClient('http://qc:3005').workOrder(ID, 'Bearer t')).state).toBe(state);
  });

  it('treats a network failure as unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await new QcClient('http://qc:3005').workOrder(ID, 'Bearer t')).state).toBe('unavailable');
  });
});
```

`apps/media/src/directory/project.client.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectClient, distanceFromSite } from './project.client.js';

afterEach(() => vi.restoreAllMocks());

describe('ProjectClient', () => {
  it('reads the caller scope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ global: false, projectIds: ['p'], siteIds: [] }), { status: 200 }));
    expect(await new ProjectClient('http://project:3004').scope('Bearer t')).toEqual({ state: 'found', value: { global: false, projectIds: ['p'], siteIds: [] } });
  });

  it('returns null geofence on any failure: a missing distance must not block an upload', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    expect(await new ProjectClient('http://project:3004').geofence('s', 'Bearer t')).toBeNull();
  });
});

describe('distanceFromSite', () => {
  const site = { latitude: 26.4525, longitude: 87.2718, effectiveRadiusM: 100 };
  it('rounds to whole metres', () => {
    expect(distanceFromSite(site, 26.4525, 87.2718)).toBe(0);
    expect(distanceFromSite(site, 26.4534, 87.2718)).toBe(100);
  });
  it('is null without both fixes', () => {
    expect(distanceFromSite(null, 26.4, 87.2)).toBeNull();
    expect(distanceFromSite({ latitude: null, longitude: null, effectiveRadiusM: null }, 26.4, 87.2)).toBeNull();
    expect(distanceFromSite(site, undefined, undefined)).toBeNull();
  });
});
```

Run: `pnpm --filter media exec vitest run src/directory` — Expected: FAIL (modules missing).

- [ ] **Step 2: Implement**

`apps/media/src/directory/lookup.ts`:

```ts
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export type Lookup<T> =
  | { state: 'found'; value: T }
  | { state: 'not_found' }
  | { state: 'forbidden' }
  | { state: 'unavailable' };

/** The lookup as an answer, or the HTTP error that stands in for one. 503 is the phone's cue to retry later. */
export function required<T>(lookup: Lookup<T>, what: string): T {
  switch (lookup.state) {
    case 'found': return lookup.value;
    case 'not_found': throw new NotFoundException(`${what} not found`);
    case 'forbidden': throw new ForbiddenException(`You cannot access this ${what.toLowerCase()}`);
    case 'unavailable': throw new ServiceUnavailableException(`${what} could not be checked right now. Try again shortly.`);
  }
}

export async function getJson<T>(url: string, bearer: string, timeoutMs: number): Promise<Lookup<T>> {
  try {
    const response = await globalThis.fetch(url, { headers: { authorization: bearer }, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 404) return { state: 'not_found' };
    if (response.status === 401 || response.status === 403) return { state: 'forbidden' };
    if (!response.ok) return { state: 'unavailable' };
    return { state: 'found', value: (await response.json()) as T };
  } catch {
    return { state: 'unavailable' };
  }
}
```

`apps/media/src/directory/qc.client.ts`:

```ts
import { getJson, type Lookup } from './lookup.js';

export interface WorkOrderRef { id: string; projectId: string; siteId: string; siteCode: string; status: string }

/** Evidence may only be added while the work order is still being worked. */
export const OPEN_WORK_ORDER: readonly string[] = ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'];

/**
 * Reads a work order through qc's own endpoint with the caller's token, so qc
 * applies the caller's permission and scope: a work order the engineer cannot
 * see is one they cannot upload evidence for.
 */
export class QcClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  async workOrder(id: string, bearer: string): Promise<Lookup<WorkOrderRef>> {
    const lookup = await getJson<{ id: string; projectId: string; siteId: string; status: string; site: { siteCode: string } }>(
      `${this.baseUrl}/api/v1/work-orders/${id}`, bearer, this.timeoutMs,
    );
    if (lookup.state !== 'found') return lookup;
    const { value } = lookup;
    return { state: 'found', value: { id: value.id, projectId: value.projectId, siteId: value.siteId, siteCode: value.site.siteCode, status: value.status } };
  }
}
```

`apps/media/src/directory/project.client.ts`:

```ts
import type { AuthzScope } from '@ipms/authz';
import { haversineMeters } from '@ipms/geo';
import { getJson, type Lookup } from './lookup.js';

export interface SiteGeofence { latitude: number | null; longitude: number | null; effectiveRadiusM: number | null }

export function distanceFromSite(site: SiteGeofence | null, latitude?: number, longitude?: number): number | null {
  if (!site || site.latitude === null || site.longitude === null) return null;
  if (latitude === undefined || longitude === undefined) return null;
  return Math.round(haversineMeters({ latitude: site.latitude, longitude: site.longitude }, { latitude, longitude }));
}

/** Scope and site coordinates, from project's internal endpoints, with the caller's own token. */
export class ProjectClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  scope(bearer: string): Promise<Lookup<AuthzScope>> {
    return getJson<AuthzScope>(`${this.baseUrl}/api/v1/internal/scope`, bearer, this.timeoutMs);
  }

  /** Null on any failure: the distance is informative, and losing it must never lose an upload. */
  async geofence(siteId: string, bearer: string): Promise<SiteGeofence | null> {
    const lookup = await getJson<SiteGeofence>(`${this.baseUrl}/api/v1/internal/sites/${siteId}/geofence`, bearer, this.timeoutMs);
    return lookup.state === 'found' ? lookup.value : null;
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter media exec vitest run src/directory`
Expected: PASS. (If the 100 m case reports 100 ± 1 because of `haversineMeters`' earth radius, change `26.4534` to the latitude that rounds to exactly 100 under that function and keep the assertion exact.)

- [ ] **Step 4: Commit**

```bash
git add apps/media/src/directory
git commit -m "feat(media): qc work order and project scope/geofence clients

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Audit, outbox drainer, metrics and the discarder

**Files:**
- Create: `apps/media/src/media/audit.ts`
- Create: `apps/media/src/outbox/outbox.drainer.ts`
- Create: `apps/media/src/metrics.ts`
- Create: `apps/media/src/media/discarder.ts`
- Create: `apps/media/src/media/discarder.integration.spec.ts`

**Interfaces:**
- Consumes: `StorageClient` (Task 3), `MediaObject` (Task 4).
- Produces:
  - `recordAudit(tx: Tx, e: { actorId: string | null; action: string; objectId: string; previousState: JsonObject; newState: JsonObject }): Promise<void>`; `type Tx = Prisma.TransactionClient`
  - `class OutboxDrainer(prisma: PrismaClient, bus: EventBus)` with `drain(): Promise<void>`
  - metrics: `uploadsRegistered` (Counter, `kind`), `uploadsCompleted` (Counter, `kind`), `verifyDuration` (Histogram), `mediaRejected` (Counter, `reason`), `verifyQueueDepth` (Gauge), `verifyStuck` (Counter), `captureToReceipt` (Histogram, seconds)
  - `class MediaDiscarder(prisma: PrismaClient, storage: StorageClient)` with `discard(row: MediaObject, actorId: string | null, action: 'media.discarded' | 'media.discarded_after_cancel'): Promise<void>`

- [ ] **Step 1: Write the failing discarder test**

`apps/media/src/media/discarder.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { MediaDiscarder } from './discarder.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
beforeAll(async () => { [db, minio] = await Promise.all([startTestDb(), startMinio()]); prisma = db.prisma; });
afterAll(async () => { await db?.stop(); await minio?.stop(); });

describe('MediaDiscarder', () => {
  it('deletes the object and its thumbnail, keeps a tombstone, and audits', async () => {
    const id = uuidv7();
    await minio.client.put(`k/${id}.jpg`, Buffer.from('x'), 'image/jpeg');
    await minio.client.put(`k/${id}.thumb.webp`, Buffer.from('y'), 'image/webp');
    const row = await prisma.mediaObject.create({ data: {
      id, kind: 'PHOTO', category: 'EVIDENCE', contentType: 'image/jpeg', sizeBytes: 1, contentHash: 'a'.repeat(64),
      storageKey: `k/${id}.jpg`, thumbnailKey: `k/${id}.thumb.webp`, uploadedBy: uuidv7(), status: 'READY',
    } });

    await new MediaDiscarder(prisma, minio.client).discard(row, row.uploadedBy, 'media.discarded');

    expect(await minio.client.head(`k/${id}.jpg`)).toBeNull();
    expect(await minio.client.head(`k/${id}.thumb.webp`)).toBeNull();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'DISCARDED' });
    const audit = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'audit.event.recorded' } });
    expect(audit.payload).toMatchObject({ action: 'media.discarded', objectType: 'MediaObject', objectId: id, newState: { status: 'DISCARDED' } });
  });
});
```

Run: `pnpm --filter media exec vitest run src/media/discarder.integration.spec.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement**

`apps/media/src/media/audit.ts`:

```ts
import type { Prisma } from '@prisma-clients/media';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';

export type Tx = Prisma.TransactionClient;

/** Written inside the action's own transaction. A null actor is media itself (verifier, sweeper). */
export async function recordAudit(
  tx: Tx,
  e: { actorId: string | null; action: string; objectId: string; previousState: JsonObject; newState: JsonObject },
): Promise<void> {
  await tx.outboxEvent.create({
    data: buildOutboxRecord(SUBJECTS.AUDIT_EVENT, {
      actorId: e.actorId, action: e.action, objectType: 'MediaObject', objectId: e.objectId,
      previousState: e.previousState, newState: e.newState, details: {},
    }, getCorrelationId() ?? 'system', e.actorId ?? undefined),
  });
}
```

`apps/media/src/outbox/outbox.drainer.ts`:

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/media';
import type { EventBus } from '@ipms/events';
import { createLogger } from '@ipms/observability';

const log = createLogger('media');
const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 100;

/** Same drainer as qc's: publishes committed outbox rows, retrying until NATS accepts them. */
@Injectable()
export class OutboxDrainer implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaClient, private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.drain().catch((err: unknown) => log.error({ err }, 'outbox drain failed'));
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    const pending = await this.prisma.outboxEvent.findMany({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' }, take: BATCH_SIZE });
    for (const row of pending) {
      try {
        await this.bus.publish(row.subject, row.payload, {
          correlationId: row.correlationId,
          eventId: row.id,
          ...(row.actorId === null ? {} : { actorId: row.actorId }),
        });
        await this.prisma.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date() } });
      } catch (err) {
        log.warn({ err, outboxId: row.id, subject: row.subject }, 'outbox publish failed, will retry');
      }
    }
  }
}
```

`apps/media/src/metrics.ts`:

```ts
import { Counter, Gauge, Histogram } from 'prom-client';
import { metricsRegistry } from '@ipms/observability';

const registers = [metricsRegistry];

export const uploadsRegistered = new Counter({ name: 'media_uploads_registered_total', help: 'Files registered for upload', labelNames: ['kind'], registers });
export const uploadsCompleted = new Counter({ name: 'media_uploads_completed_total', help: 'Uploads reported complete by the device', labelNames: ['kind'], registers });
export const verifyDuration = new Histogram({ name: 'media_verify_duration_seconds', help: 'Time to verify one object', buckets: [0.1, 0.5, 1, 5, 15, 60], registers });
export const mediaRejected = new Counter({ name: 'media_rejected_total', help: 'Objects rejected by verification', labelNames: ['reason'], registers });
export const verifyQueueDepth = new Gauge({ name: 'media_verify_queue_depth', help: 'Objects waiting for verification', registers });
export const verifyStuck = new Counter({ name: 'media_verify_stuck_total', help: 'Objects that exhausted verification retries and need an operator', registers });
export const captureToReceipt = new Histogram({
  name: 'media_capture_to_receipt_seconds', help: 'Capture time to upload completion — shows remote sites uploading late',
  buckets: [60, 600, 3600, 21_600, 86_400, 259_200, 604_800], registers,
});
```

`apps/media/src/media/discarder.ts`:

```ts
import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import type { StorageClient } from '../storage/storage.client.js';
import { recordAudit } from './audit.js';

/**
 * Removes a file that never became evidence of record: a retake the engineer
 * threw away, or the unsubmitted leftovers of a cancelled work order. Storage
 * goes first, so a crash between the two leaves a row that is retried, never
 * an orphaned object nobody tracks.
 */
export class MediaDiscarder {
  constructor(private readonly prisma: PrismaClient, private readonly storage: StorageClient) {}

  async discard(row: MediaObject, actorId: string | null, action: 'media.discarded' | 'media.discarded_after_cancel'): Promise<void> {
    if (row.multipartUploadId) await this.storage.abortMultipart(row.storageKey, row.multipartUploadId);
    await this.storage.delete([row.storageKey, ...(row.thumbnailKey ? [row.thumbnailKey] : [])]);
    await this.prisma.$transaction(async (tx) => {
      await tx.mediaObject.update({ where: { id: row.id }, data: { status: 'DISCARDED', discardedAt: new Date(), multipartUploadId: null, nextAttemptAt: null } });
      await recordAudit(tx, { actorId, action, objectId: row.id, previousState: { status: row.status }, newState: { status: 'DISCARDED' } });
    });
  }
}
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter media exec vitest run src/media/discarder.integration.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/media/src/media/audit.ts apps/media/src/media/discarder.ts apps/media/src/media/discarder.integration.spec.ts apps/media/src/outbox apps/media/src/metrics.ts
git commit -m "feat(media): audit entries, outbox drainer, metrics and discarder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Upload service — register, status, parts, complete, discard

**Files:**
- Create: `apps/media/src/uploads/upload.service.ts`
- Create: `apps/media/src/uploads/upload.integration.spec.ts`

**Interfaces:**
- Consumes: `StorageClient`, `evidenceKeys`, `PRE_ATTACH`, `LOCKED`, `QcClient`/`OPEN_WORK_ORDER`, `ProjectClient`/`distanceFromSite`, `required`, `MediaDiscarder`, metrics.
- Produces: `class UploadService(prisma: PrismaClient, storage: StorageClient, qc: Pick<QcClient,'workOrder'>, project: Pick<ProjectClient,'geofence'>, discarder: MediaDiscarder)` with
  - `register(dto: RegisterUploadDto, userId: string, bearer: string): Promise<RegisterUploadResponse>`
  - `status(ids: string[], userId: string): Promise<UploadStatusItem[]>`
  - `parts(id: string, partNumbers: number[], userId: string): Promise<PartUrls>`
  - `complete(id: string, dto: CompleteUploadDto, userId: string): Promise<{ id: string; status: MediaStatus }>`
  - `discard(id: string, userId: string): Promise<{ id: string; status: 'DISCARDED' }>`
  - constants `UPLOAD_URL_TTL_SECONDS = 3600`, `PENDING_CAP = 500`

- [ ] **Step 1: Write the failing integration tests**

`apps/media/src/uploads/upload.integration.spec.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import { MIB, PART_SIZE_BYTES, uuidv7, type RegisterUploadDto, type UploadInstructions } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { MediaDiscarder } from '../media/discarder.js';
import type { Lookup } from '../directory/lookup.js';
import type { WorkOrderRef } from '../directory/qc.client.js';
import { UploadService } from './upload.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
let service: UploadService;

const ENGINEER = uuidv7();
const OTHER = uuidv7();
const PROJECT = uuidv7();
const SITE = uuidv7();
const WORK_ORDER = uuidv7();
let workOrder: Lookup<WorkOrderRef>;

beforeAll(async () => {
  [db, minio] = await Promise.all([startTestDb(), startMinio()]);
  prisma = db.prisma;
  const qc = { workOrder: async () => workOrder };
  const project = { geofence: async () => ({ latitude: 26.4525, longitude: 87.2718, effectiveRadiusM: 100 }) };
  service = new UploadService(prisma, minio.client, qc, project, new MediaDiscarder(prisma, minio.client));
});
afterAll(async () => { await db?.stop(); await minio?.stop(); });
beforeEach(async () => {
  await prisma.mediaObject.deleteMany({});
  workOrder = { state: 'found', value: { id: WORK_ORDER, projectId: PROJECT, siteId: SITE, siteCode: 'KOS121', status: 'ONGOING' } };
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function photo(body: Buffer, patch: Partial<RegisterUploadDto> = {}): RegisterUploadDto {
  return {
    id: uuidv7(), category: 'EVIDENCE', workOrderId: WORK_ORDER, checklistItemId: uuidv7(), kind: 'PHOTO',
    contentType: 'image/jpeg', sizeBytes: body.length, contentHash: sha(body), capturedAt: new Date('2026-09-28T08:00:00Z'),
    latitude: 26.4525, longitude: 87.2718, deviceId: 'RMX3630', ...patch,
  };
}
async function send(upload: UploadInstructions, body: Buffer): Promise<void> {
  if (upload.mode !== 'single') throw new Error('expected a single PUT');
  expect((await fetch(upload.signedUrl, { method: 'PUT', body, headers: upload.headers })).status).toBe(200);
}

describe('registering', () => {
  it('files a photo under its work order’s project and site, with distance, and returns a single PUT', async () => {
    const body = randomBytes(2000);
    const dto = photo(body);
    const out = await service.register(dto, ENGINEER, 'Bearer t');
    expect(out).toMatchObject({ id: dto.id, status: 'PENDING', upload: { mode: 'single' }, posterUpload: null });
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } })).toMatchObject({
      projectId: PROJECT, siteId: SITE, siteCode: 'KOS121', workOrderId: WORK_ORDER, distanceFromSiteM: 0,
      storageKey: `projects/${PROJECT}/sites/${SITE}/evidence/${dto.id}.jpg`,
    });
  });

  it('is repeat-safe: the same id and hash return fresh URLs for the same row', async () => {
    const dto = photo(randomBytes(10));
    await service.register(dto, ENGINEER, 'Bearer t');
    const again = await service.register(dto, ENGINEER, 'Bearer t');
    expect(again.status).toBe('PENDING');
    expect(await prisma.mediaObject.count()).toBe(1);
  });

  it('refuses the same id with different bytes, or from another user', async () => {
    const dto = photo(randomBytes(10));
    await service.register(dto, ENGINEER, 'Bearer t');
    await expect(service.register({ ...dto, contentHash: 'b'.repeat(64) }, ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 409 });
    await expect(service.register(dto, OTHER, 'Bearer t')).rejects.toMatchObject({ status: 409 });
  });

  it('enforces type and size limits', async () => {
    await expect(service.register(photo(randomBytes(10), { contentType: 'image/png' }), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 400 });
    await expect(service.register(photo(randomBytes(10), { sizeBytes: 5 * MIB + 1 }), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 413 });
  });

  it('refuses a closed work order, and passes through qc’s answer when it is out of reach', async () => {
    workOrder = { state: 'found', value: { id: WORK_ORDER, projectId: PROJECT, siteId: SITE, siteCode: 'KOS121', status: 'COMPLETED' } };
    await expect(service.register(photo(randomBytes(10)), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 422 });
    workOrder = { state: 'forbidden' };
    await expect(service.register(photo(randomBytes(10)), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 403 });
    workOrder = { state: 'unavailable' };
    await expect(service.register(photo(randomBytes(10)), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 503 });
  });

  it('caps an uploader at 500 pending files', async () => {
    await prisma.mediaObject.createMany({ data: Array.from({ length: 500 }, () => {
      const id = uuidv7();
      return { id, kind: 'PHOTO', category: 'EVIDENCE', contentType: 'image/jpeg', sizeBytes: 1, contentHash: 'a'.repeat(64), storageKey: `x/${id}`, uploadedBy: ENGINEER };
    }) });
    await expect(service.register(photo(randomBytes(10)), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 429 });
  });
});

describe('uploading and completing', () => {
  it('moves a photo to VERIFYING once its bytes arrived, and says so again on repeat', async () => {
    const body = randomBytes(3000);
    const dto = photo(body);
    await expect(service.complete(dto.id, {}, ENGINEER)).rejects.toMatchObject({ status: 404 });
    const out = await service.register(dto, ENGINEER, 'Bearer t');
    await expect(service.complete(dto.id, {}, ENGINEER)).rejects.toMatchObject({ status: 412 });
    await send(out.upload!, body);
    expect(await service.complete(dto.id, {}, ENGINEER)).toEqual({ id: dto.id, status: 'VERIFYING' });
    expect(await service.complete(dto.id, {}, ENGINEER)).toEqual({ id: dto.id, status: 'VERIFYING' });
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    expect(row.receivedAt).not.toBeNull();
    expect(row.nextAttemptAt).not.toBeNull();
  });

  it('resumes a video: status reports stored parts, fresh part URLs, then completes', async () => {
    // 11 MiB is over the 10 MiB threshold, so it goes up in three 5 MiB parts.
    const video = randomBytes(11 * MIB);
    const dto = photo(video, { kind: 'VIDEO', contentType: 'video/mp4' });
    const out = await service.register(dto, ENGINEER, 'Bearer t');
    expect(out.upload).toMatchObject({ mode: 'multipart', partCount: 3, partSize: PART_SIZE_BYTES });
    expect(out.posterUpload).not.toBeNull();
    if (out.upload?.mode !== 'multipart') throw new Error('expected multipart');
    const partBody = (n: number) => video.subarray((n - 1) * PART_SIZE_BYTES, n * PART_SIZE_BYTES);

    // First part only, then the signal drops.
    await fetch(out.upload.parts[0]!.signedUrl, { method: 'PUT', body: partBody(1) });
    expect(await service.status([dto.id], ENGINEER)).toEqual([{ id: dto.id, status: 'PENDING', completedParts: [1] }]);

    // Hours later the old URLs have expired: ask for the missing parts only.
    const fresh = await service.parts(dto.id, [2, 3], ENGINEER);
    const etags: { partNumber: number; etag: string }[] = [];
    for (const part of fresh.parts) {
      const response = await fetch(part.signedUrl, { method: 'PUT', body: partBody(part.partNumber) });
      etags.push({ partNumber: part.partNumber, etag: response.headers.get('etag')! });
    }
    expect((await service.status([dto.id], ENGINEER))[0]!.completedParts).toEqual([1, 2, 3]);

    // The phone kept part 1's ETag from the first session; here we read it back from storage.
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    const first = (await minio.client.listParts(row.storageKey, row.multipartUploadId!))!.find((p) => p.partNumber === 1)!;
    expect(await service.complete(dto.id, { parts: [first, ...etags] }, ENGINEER)).toEqual({ id: dto.id, status: 'VERIFYING' });
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } })).multipartUploadId).toBeNull();
  });
});

describe('status and discard', () => {
  it('reports unknown ids, and only the caller’s own uploads', async () => {
    const dto = photo(randomBytes(10));
    await service.register(dto, ENGINEER, 'Bearer t');
    const unknown = uuidv7();
    expect(await service.status([dto.id, unknown], ENGINEER)).toEqual([
      { id: dto.id, status: 'PENDING' }, { id: unknown, status: 'UNKNOWN' },
    ]);
    expect(await service.status([dto.id], OTHER)).toEqual([{ id: dto.id, status: 'UNKNOWN' }]);
  });

  it('discards a retake for its uploader only, and never evidence already attached', async () => {
    const body = randomBytes(10);
    const dto = photo(body);
    const out = await service.register(dto, ENGINEER, 'Bearer t');
    await send(out.upload!, body);
    await expect(service.discard(dto.id, OTHER)).rejects.toMatchObject({ status: 403 });
    expect(await service.discard(dto.id, ENGINEER)).toEqual({ id: dto.id, status: 'DISCARDED' });
    expect(await service.discard(dto.id, ENGINEER)).toEqual({ id: dto.id, status: 'DISCARDED' });

    const kept = photo(randomBytes(10));
    await service.register(kept, ENGINEER, 'Bearer t');
    await prisma.mediaObject.update({ where: { id: kept.id }, data: { status: 'ATTACHED' } });
    await expect(service.discard(kept.id, ENGINEER)).rejects.toMatchObject({ status: 409 });
  });
});
```

Run: `pnpm --filter media exec vitest run src/uploads/upload.integration.spec.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement the upload service**

`apps/media/src/uploads/upload.service.ts`:

```ts
import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, NotFoundException,
  PayloadTooLargeException, UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type MediaObject, type PrismaClient } from '@prisma-clients/media';
import {
  MEDIA_LIMITS, MULTIPART_THRESHOLD_BYTES, PART_SIZE_BYTES, partCountFor,
  type CompleteUploadDto, type MediaKind, type MediaStatus, type PartUrls, type RegisterUploadDto,
  type RegisterUploadResponse, type RejectReason, type SignedPut, type UploadInstructions, type UploadStatusItem,
} from '@ipms/contracts';
import { required } from '../directory/lookup.js';
import { distanceFromSite, type ProjectClient } from '../directory/project.client.js';
import { OPEN_WORK_ORDER, type QcClient } from '../directory/qc.client.js';
import type { MediaDiscarder } from '../media/discarder.js';
import { LOCKED } from '../media/status.js';
import { captureToReceipt, uploadsCompleted, uploadsRegistered } from '../metrics.js';
import { evidenceKeys } from '../storage/keys.js';
import type { StorageClient } from '../storage/storage.client.js';

export const UPLOAD_URL_TTL_SECONDS = 3600;
export const PENDING_CAP = 500;

/**
 * The phone's side of the upload protocol. Every method is safe to repeat: a
 * phone on a failing link will call each of them more than once, and the
 * answer must be the same object in the same state, never a second copy.
 */
export class UploadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageClient,
    private readonly qc: Pick<QcClient, 'workOrder'>,
    private readonly project: Pick<ProjectClient, 'geofence'>,
    private readonly discarder: MediaDiscarder,
  ) {}

  async register(dto: RegisterUploadDto, userId: string, bearer: string): Promise<RegisterUploadResponse> {
    const limit = MEDIA_LIMITS[dto.kind];
    if (!limit.contentTypes.includes(dto.contentType)) throw new BadRequestException(`A ${dto.kind.toLowerCase()} must be ${limit.contentTypes.join(' or ')}`);
    if (dto.sizeBytes > limit.maxBytes) throw new PayloadTooLargeException(`A ${dto.kind.toLowerCase()} may be at most ${limit.maxBytes} bytes`);

    const existing = await this.prisma.mediaObject.findUnique({ where: { id: dto.id } });
    if (existing) return this.resume(existing, dto, userId);

    const pending = await this.prisma.mediaObject.count({ where: { uploadedBy: userId, status: 'PENDING' } });
    if (pending >= PENDING_CAP) throw new HttpException(`You already have ${PENDING_CAP} uploads waiting to finish`, HttpStatus.TOO_MANY_REQUESTS);

    const workOrder = required(await this.qc.workOrder(dto.workOrderId, bearer), 'Work order');
    if (!OPEN_WORK_ORDER.includes(workOrder.status)) throw new UnprocessableEntityException('This work order is closed; evidence can no longer be added');
    const site = await this.project.geofence(workOrder.siteId, bearer);

    const keys = evidenceKeys({ projectId: workOrder.projectId, siteId: workOrder.siteId, id: dto.id, kind: dto.kind });
    const multipart = dto.kind === 'VIDEO' && dto.sizeBytes > MULTIPART_THRESHOLD_BYTES;
    const uploadId = multipart ? await this.storage.createMultipart(keys.storageKey, dto.contentType) : null;

    try {
      const row = await this.prisma.mediaObject.create({
        data: {
          id: dto.id, kind: dto.kind, category: 'EVIDENCE', contentType: dto.contentType, sizeBytes: dto.sizeBytes,
          projectId: workOrder.projectId, siteId: workOrder.siteId, siteCode: workOrder.siteCode,
          workOrderId: workOrder.id, checklistItemId: dto.checklistItemId,
          storageKey: keys.storageKey, thumbnailKey: keys.thumbnailKey, multipartUploadId: uploadId,
          contentHash: dto.contentHash, capturedAt: dto.capturedAt,
          latitude: dto.latitude ?? null, longitude: dto.longitude ?? null,
          distanceFromSiteM: distanceFromSite(site, dto.latitude, dto.longitude),
          deviceId: dto.deviceId, uploadedBy: userId,
        },
      });
      uploadsRegistered.inc({ kind: dto.kind });
      return this.instructions(row);
    } catch (err) {
      // Two retries raced: the loser answers with the winner's row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        if (uploadId) await this.storage.abortMultipart(keys.storageKey, uploadId);
        return this.resume(await this.prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } }), dto, userId);
      }
      throw err;
    }
  }

  async status(ids: string[], userId: string): Promise<UploadStatusItem[]> {
    const rows = await this.prisma.mediaObject.findMany({ where: { id: { in: ids }, uploadedBy: userId } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return Promise.all(ids.map(async (id): Promise<UploadStatusItem> => {
      const row = byId.get(id);
      if (!row) return { id, status: 'UNKNOWN' };
      const item: UploadStatusItem = { id, status: row.status as MediaStatus };
      if (row.rejectReason) item.rejectReason = row.rejectReason as RejectReason;
      if (row.status === 'PENDING' && row.multipartUploadId) {
        const parts = await this.storage.listParts(row.storageKey, row.multipartUploadId);
        item.completedParts = (parts ?? []).map((p) => p.partNumber).sort((a, b) => a - b);
      }
      return item;
    }));
  }

  async parts(id: string, partNumbers: number[], userId: string): Promise<PartUrls> {
    const row = await this.own(id, userId);
    if (row.status !== 'PENDING' || !row.multipartUploadId) throw new ConflictException('This upload is not waiting for parts');
    const uploadId = await this.liveUploadId(row);
    const count = partCountFor(row.sizeBytes);
    const bad = partNumbers.filter((n) => n > count);
    if (bad.length) throw new BadRequestException(`This upload has ${count} parts; ${bad.join(', ')} do not exist`);
    return {
      parts: await Promise.all(partNumbers.map(async (partNumber) => ({
        partNumber, signedUrl: await this.storage.presignPart(row.storageKey, uploadId, partNumber, UPLOAD_URL_TTL_SECONDS),
      }))),
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async complete(id: string, dto: CompleteUploadDto, userId: string): Promise<{ id: string; status: MediaStatus }> {
    const row = await this.own(id, userId);
    if (row.status !== 'PENDING') return { id, status: row.status as MediaStatus };

    if (row.multipartUploadId) {
      if (!dto.parts?.length) throw new BadRequestException('A multipart upload completes with its part list');
      if (dto.parts.length !== partCountFor(row.sizeBytes)) {
        throw new HttpException(`Expected ${partCountFor(row.sizeBytes)} parts, got ${dto.parts.length}`, HttpStatus.PRECONDITION_FAILED);
      }
      await this.storage.completeMultipart(row.storageKey, row.multipartUploadId, dto.parts);
    } else if (!(await this.storage.head(row.storageKey))) {
      // 412, not 409: the phone should send the bytes again, then retry.
      throw new HttpException('The file has not arrived in storage yet', HttpStatus.PRECONDITION_FAILED);
    }

    const now = new Date();
    const updated = await this.prisma.mediaObject.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'VERIFYING', multipartUploadId: null, receivedAt: now, nextAttemptAt: now },
    });
    if (updated.count === 1) {
      uploadsCompleted.inc({ kind: row.kind });
      if (row.capturedAt) captureToReceipt.observe((now.getTime() - row.capturedAt.getTime()) / 1000);
    }
    return { id, status: 'VERIFYING' };
  }

  async discard(id: string, userId: string): Promise<{ id: string; status: 'DISCARDED' }> {
    const row = await this.own(id, userId);
    if (row.status === 'DISCARDED') return { id, status: 'DISCARDED' };
    if (LOCKED.includes(row.status as MediaStatus)) throw new ConflictException('This file is part of a submission and cannot be removed');
    await this.discarder.discard(row, userId, 'media.discarded');
    return { id, status: 'DISCARDED' };
  }

  private async own(id: string, userId: string): Promise<MediaObject> {
    const row = await this.prisma.mediaObject.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Upload not found');
    if (row.uploadedBy !== userId) throw new ForbiddenException('Only the uploader can change this upload');
    return row;
  }

  private resume(row: MediaObject, dto: RegisterUploadDto, userId: string): Promise<RegisterUploadResponse> {
    if (row.uploadedBy !== userId) throw new ConflictException('This media id already belongs to another upload');
    if (row.contentHash !== dto.contentHash) throw new ConflictException('This media id was registered with different content');
    return this.instructions(row);
  }

  /** R2's lifecycle rule aborts multipart uploads left for 7 days; a returning phone gets a new one. */
  private async liveUploadId(row: MediaObject): Promise<string> {
    if (row.multipartUploadId && (await this.storage.listParts(row.storageKey, row.multipartUploadId)) !== null) return row.multipartUploadId;
    const uploadId = await this.storage.createMultipart(row.storageKey, row.contentType);
    await this.prisma.mediaObject.update({ where: { id: row.id }, data: { multipartUploadId: uploadId } });
    return uploadId;
  }

  private async instructions(row: MediaObject): Promise<RegisterUploadResponse> {
    if (row.status !== 'PENDING') return { id: row.id, status: row.status as MediaStatus, upload: null, posterUpload: null };
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();

    let upload: UploadInstructions;
    if (row.multipartUploadId) {
      const uploadId = await this.liveUploadId(row);
      const partCount = partCountFor(row.sizeBytes);
      const parts = await Promise.all(Array.from({ length: partCount }, async (_, i) => ({
        partNumber: i + 1, signedUrl: await this.storage.presignPart(row.storageKey, uploadId, i + 1, UPLOAD_URL_TTL_SECONDS),
      })));
      upload = { mode: 'multipart', uploadId, partSize: PART_SIZE_BYTES, partCount, parts, expiresAt };
    } else {
      const signed = await this.storage.presignPut(row.storageKey, { contentType: row.contentType, sizeBytes: row.sizeBytes, sha256Hex: row.contentHash }, UPLOAD_URL_TTL_SECONDS);
      upload = { mode: 'single', ...signed };
    }

    let posterUpload: SignedPut | null = null;
    if ((row.kind as MediaKind) === 'VIDEO' && row.thumbnailKey) {
      posterUpload = await this.storage.presignPut(row.thumbnailKey, { contentType: 'image/jpeg' }, UPLOAD_URL_TTL_SECONDS);
    }
    return { id: row.id, status: 'PENDING', upload, posterUpload };
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter media exec vitest run src/uploads/upload.integration.spec.ts`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/media/src/uploads/upload.service.ts apps/media/src/uploads/upload.integration.spec.ts
git commit -m "feat(media): resumable, repeat-safe upload registration and completion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verification worker

**Files:**
- Create: `apps/media/src/verify/sniff.ts`, `apps/media/src/verify/sniff.spec.ts`
- Create: `apps/media/src/verify/verify.worker.ts`
- Create: `apps/media/src/verify/verify.integration.spec.ts`

**Interfaces:**
- Consumes: `StorageClient`, `recordAudit`, metrics, `MEDIA_LIMITS`.
- Produces: `sniffMatches(contentType: string, head: Buffer): boolean`; `class VerifyWorker(prisma: PrismaClient, storage: StorageClient)` with `runOnce(): Promise<number>` (objects processed) and Nest lifecycle polling every 1 s; constants `MAX_VERIFY_ATTEMPTS = 5`, `LEASE_SECONDS = 300`, `POSTER_MAX_BYTES = 1 MiB`; exported `backoffSeconds(attempt: number): number`.

- [ ] **Step 1: Write the failing tests**

`apps/media/src/verify/sniff.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sniffMatches } from './sniff.js';

describe('sniffMatches', () => {
  it('recognises a JPEG by its SOI marker', () => {
    expect(sniffMatches('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(sniffMatches('image/jpeg', Buffer.from('<html>......'))).toBe(false);
  });

  it('recognises an MP4 by its ftyp box', () => {
    expect(sniffMatches('video/mp4', Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]))).toBe(true);
    expect(sniffMatches('video/mp4', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  it('refuses anything else', () => {
    expect(sniffMatches('application/pdf', Buffer.from('%PDF-1.7....'))).toBe(false);
  });
});
```

`apps/media/src/verify/verify.integration.spec.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { VerifyWorker, backoffSeconds } from './verify.worker.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
let worker: VerifyWorker;
beforeAll(async () => {
  [db, minio] = await Promise.all([startTestDb(), startMinio()]);
  prisma = db.prisma;
  worker = new VerifyWorker(prisma, minio.client);
});
afterAll(async () => { await db?.stop(); await minio?.stop(); });
beforeEach(async () => { await prisma.mediaObject.deleteMany({}); await prisma.outboxEvent.deleteMany({}); });

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const jpeg = () => sharp({ create: { width: 1200, height: 900, channels: 3, background: '#3a6' } }).jpeg({ quality: 80 }).toBuffer();

async function queued(body: Buffer, patch: { kind?: 'PHOTO' | 'VIDEO'; contentType?: string; contentHash?: string; sizeBytes?: number } = {}) {
  const id = uuidv7();
  const kind = patch.kind ?? 'PHOTO';
  const storageKey = `v/${id}.${kind === 'PHOTO' ? 'jpg' : 'mp4'}`;
  const thumbnailKey = `v/${id}.${kind === 'PHOTO' ? 'thumb.webp' : 'poster.jpg'}`;
  await minio.client.put(storageKey, body, patch.contentType ?? 'image/jpeg');
  return prisma.mediaObject.create({ data: {
    id, kind, category: 'EVIDENCE', contentType: patch.contentType ?? 'image/jpeg', sizeBytes: patch.sizeBytes ?? body.length,
    contentHash: patch.contentHash ?? sha(body), storageKey, thumbnailKey, uploadedBy: uuidv7(),
    status: 'VERIFYING', nextAttemptAt: new Date(Date.now() - 1000),
  } });
}

describe('VerifyWorker', () => {
  it('verifies a photo, writes a 400 px WebP thumbnail and marks it READY', async () => {
    const row = await queued(await jpeg());
    expect(await worker.runOnce()).toBe(1);
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'READY', hashVerified: true, nextAttemptAt: null });
    const chunks: Buffer[] = [];
    for await (const c of await minio.client.getStream(row.thumbnailKey!)) chunks.push(c as Buffer);
    const meta = await sharp(Buffer.concat(chunks)).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width!, meta.height!)).toBe(400);
  });

  it('rejects bytes that do not match the phone’s hash, and audits it', async () => {
    const row = await queued(await jpeg(), { contentHash: 'c'.repeat(64) });
    await worker.runOnce();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'REJECTED', rejectReason: 'HASH_MISMATCH' });
    const audit = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'audit.event.recorded' } });
    expect(audit.payload).toMatchObject({ action: 'media.rejected', objectId: row.id, actorId: null });
  });

  it('rejects a file that is not what it claims to be', async () => {
    const row = await queued(Buffer.from('<html>not a photo</html>'));
    await worker.runOnce();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'REJECTED', rejectReason: 'TYPE_MISMATCH' });
  });

  it('rejects a video whose poster never arrived, and accepts one whose poster did', async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), randomBytes(4000)]);
    const missing = await queued(mp4, { kind: 'VIDEO', contentType: 'video/mp4' });
    const present = await queued(mp4, { kind: 'VIDEO', contentType: 'video/mp4' });
    await minio.client.put(present.thumbnailKey!, await jpeg(), 'image/jpeg');
    await worker.runOnce();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: missing.id } })).toMatchObject({ status: 'REJECTED', rejectReason: 'POSTER_MISSING' });
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: present.id } })).toMatchObject({ status: 'READY' });
  });

  it('retries a transient failure with backoff, and parks it for an operator after 5 attempts', async () => {
    const row = await queued(await jpeg());
    await minio.client.delete([row.storageKey]); // storage "loses" it: GetObject fails
    await worker.runOnce();
    const retried = await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } });
    expect(retried).toMatchObject({ status: 'VERIFYING', verifyAttempts: 1 });
    expect(retried.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 25_000);

    await prisma.mediaObject.update({ where: { id: row.id }, data: { verifyAttempts: 4, nextAttemptAt: new Date(Date.now() - 1000) } });
    await worker.runOnce();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'VERIFYING', verifyAttempts: 5, nextAttemptAt: null });
  });

  it('backs off 30 s, 60 s, 120 s … capped at an hour', () => {
    expect([1, 2, 3, 8, 20].map(backoffSeconds)).toEqual([30, 60, 120, 3600, 3600]);
  });
});
```

Run: `pnpm --filter media exec vitest run src/verify` — Expected: FAIL (modules missing).

- [ ] **Step 2: Implement**

`apps/media/src/verify/sniff.ts`:

```ts
/** The file's own first bytes, not its declared type or extension, decide what it is. */
export function sniffMatches(contentType: string, head: Buffer): boolean {
  if (contentType === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (contentType === 'video/mp4') return head.length >= 8 && head.subarray(4, 8).toString('latin1') === 'ftyp';
  return false;
}
```

`apps/media/src/verify/verify.worker.ts`:

```ts
import { createHash } from 'node:crypto';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import { MEDIA_LIMITS, MIB, type MediaKind, type RejectReason } from '@ipms/contracts';
import { createLogger } from '@ipms/observability';
import { recordAudit } from '../media/audit.js';
import { mediaRejected, verifyDuration, verifyQueueDepth, verifyStuck } from '../metrics.js';
import type { StorageClient } from '../storage/storage.client.js';
import { sniffMatches } from './sniff.js';

const log = createLogger('media');
export const MAX_VERIFY_ATTEMPTS = 5;
export const LEASE_SECONDS = 300;
export const POSTER_MAX_BYTES = 1 * MIB;
const BATCH = 2;
const POLL_MS = 1000;

export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** (attempt - 1), 3600);
}

type Outcome = { status: 'READY' } | { status: 'REJECTED'; reason: RejectReason };

/**
 * Re-reads every completed upload from storage and checks it against what the
 * phone declared at capture. Claims work with a lease (nextAttemptAt pushed
 * forward under SKIP LOCKED), so a worker that dies mid-object simply lets the
 * lease expire and the object is picked up again.
 */
@Injectable()
export class VerifyWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaClient, private readonly storage: StorageClient) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.runOnce().catch((err: unknown) => log.error({ err }, 'verification pass failed')).finally(() => { this.running = false; });
    }, POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<number> {
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE media_object SET "nextAttemptAt" = now() + (${LEASE_SECONDS} * interval '1 second')
      WHERE id IN (
        SELECT id FROM media_object
        WHERE status = 'VERIFYING' AND "nextAttemptAt" <= now()
        ORDER BY "nextAttemptAt" LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    verifyQueueDepth.set(await this.prisma.mediaObject.count({ where: { status: 'VERIFYING', nextAttemptAt: { not: null } } }));
    for (const { id } of claimed) {
      const row = await this.prisma.mediaObject.findUniqueOrThrow({ where: { id } });
      const stop = verifyDuration.startTimer();
      try {
        await this.settle(row, await this.verify(row));
      } catch (err) {
        await this.retry(row, err);
      } finally {
        stop();
      }
    }
    return claimed.length;
  }

  private async verify(row: MediaObject): Promise<Outcome> {
    const hash = createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    const keep: Buffer[] = [];
    const limit = MEDIA_LIMITS[row.kind as MediaKind].maxBytes;
    for await (const chunk of await this.storage.getStream(row.storageKey)) {
      const buf = chunk as Buffer;
      hash.update(buf);
      size += buf.length;
      if (head.length < 16) head = Buffer.concat([head, buf.subarray(0, 16 - head.length)]);
      if (row.kind === 'PHOTO' && size <= limit) keep.push(buf);
    }
    if (hash.digest('hex') !== row.contentHash) return { status: 'REJECTED', reason: 'HASH_MISMATCH' };
    if (size > limit) return { status: 'REJECTED', reason: 'SIZE_EXCEEDED' };
    if (!sniffMatches(row.contentType, head)) return { status: 'REJECTED', reason: 'TYPE_MISMATCH' };

    if (row.kind === 'PHOTO') {
      let thumbnail: Buffer;
      try {
        thumbnail = await sharp(Buffer.concat(keep), { limitInputPixels: 50_000_000 })
          .rotate().resize(400, 400, { fit: 'inside' }).webp({ quality: 70 }).toBuffer();
      } catch {
        return { status: 'REJECTED', reason: 'TYPE_MISMATCH' }; // a JPEG header over undecodable bytes
      }
      await this.storage.put(row.thumbnailKey!, thumbnail, 'image/webp');
    } else {
      const poster = await this.storage.head(row.thumbnailKey!);
      if (!poster || poster.sizeBytes > POSTER_MAX_BYTES) return { status: 'REJECTED', reason: 'POSTER_MISSING' };
    }
    return { status: 'READY' };
  }

  private async settle(row: MediaObject, outcome: Outcome): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (outcome.status === 'READY') {
        await tx.mediaObject.update({ where: { id: row.id }, data: { status: 'READY', hashVerified: true, nextAttemptAt: null } });
        return;
      }
      await tx.mediaObject.update({ where: { id: row.id }, data: { status: 'REJECTED', rejectReason: outcome.reason, nextAttemptAt: null } });
      await recordAudit(tx, { actorId: null, action: 'media.rejected', objectId: row.id, previousState: { status: row.status }, newState: { status: 'REJECTED', reason: outcome.reason } });
    });
    if (outcome.status === 'REJECTED') mediaRejected.inc({ reason: outcome.reason });
  }

  private async retry(row: MediaObject, err: unknown): Promise<void> {
    const attempts = row.verifyAttempts + 1;
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      log.error({ err, mediaId: row.id, attempts }, 'verification retries exhausted; needs an operator');
      verifyStuck.inc();
      await this.prisma.mediaObject.update({ where: { id: row.id }, data: { verifyAttempts: attempts, nextAttemptAt: null } });
      return;
    }
    log.warn({ err, mediaId: row.id, attempts }, 'verification failed, will retry');
    await this.prisma.mediaObject.update({
      where: { id: row.id },
      data: { verifyAttempts: attempts, nextAttemptAt: new Date(Date.now() + backoffSeconds(attempts) * 1000) },
    });
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter media exec vitest run src/verify`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/media/src/verify
git commit -m "feat(media): verify uploads against the capture hash; thumbnails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Viewing and the internal `attach`

**Files:**
- Create: `apps/media/src/viewing/view.service.ts`
- Create: `apps/media/src/attach/attach.service.ts`
- Create: `apps/media/src/viewing/view-attach.integration.spec.ts`

**Interfaces:**
- Consumes: `StorageClient.presignGet`, `readableName`, `VIEWABLE`.
- Produces:
  - `VIEW_URL_TTL_SECONDS = 300`
  - `class ViewService(prisma, storage)` with `url(id: string, variant: 'original' | 'thumbnail', scope: AuthzScope): Promise<SignedGet>` and `listForWorkOrder(workOrderId: string, scope: AuthzScope): Promise<MediaView[]>`
  - `class AttachService(prisma)` with `attach(dto: AttachRequestDto): Promise<AttachedMedia[]>`

- [ ] **Step 1: Write the failing tests**

`apps/media/src/viewing/view-attach.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { AttachService } from '../attach/attach.service.js';
import { ViewService } from './view.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
let views: ViewService;
let attach: AttachService;
beforeAll(async () => {
  [db, minio] = await Promise.all([startTestDb(), startMinio()]);
  prisma = db.prisma;
  views = new ViewService(prisma, minio.client);
  attach = new AttachService(prisma);
});
afterAll(async () => { await db?.stop(); await minio?.stop(); });
beforeEach(async () => { await prisma.mediaObject.deleteMany({}); });

const PROJECT = uuidv7();
const SITE = uuidv7();
const WORK_ORDER = uuidv7();
const IN_SCOPE: AuthzScope = { global: false, projectIds: [PROJECT], siteIds: [] };
const OUT_OF_SCOPE: AuthzScope = { global: false, projectIds: [uuidv7()], siteIds: [] };

async function media(status: string, patch: Record<string, unknown> = {}) {
  const id = uuidv7();
  await minio.client.put(`m/${id}.jpg`, Buffer.from('jpeg'), 'image/jpeg');
  await minio.client.put(`m/${id}.thumb.webp`, Buffer.from('webp'), 'image/webp');
  return prisma.mediaObject.create({ data: {
    id, kind: 'PHOTO', category: 'EVIDENCE', contentType: 'image/jpeg', sizeBytes: 4, contentHash: 'a'.repeat(64),
    storageKey: `m/${id}.jpg`, thumbnailKey: `m/${id}.thumb.webp`, uploadedBy: uuidv7(), status,
    projectId: PROJECT, siteId: SITE, siteCode: 'KOS121', workOrderId: WORK_ORDER,
    capturedAt: new Date('2026-09-28T08:00:00Z'), latitude: 26.4525, longitude: 87.2718, distanceFromSiteM: 12, ...patch,
  } });
}

describe('ViewService', () => {
  it('signs a 5-minute link with a readable name for anyone in scope', async () => {
    const row = await media('READY');
    const signed = await views.url(row.id, 'original', IN_SCOPE);
    const response = await fetch(signed.signedUrl);
    expect(await response.text()).toBe('jpeg');
    expect(response.headers.get('content-disposition')).toContain('KOS121_20260928-080000');
    expect(new Date(signed.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
  });

  it('hides media outside the caller’s scope as not found', async () => {
    const row = await media('READY');
    await expect(views.url(row.id, 'original', OUT_OF_SCOPE)).rejects.toMatchObject({ status: 404 });
  });

  it('serves only verified, stored files', async () => {
    for (const status of ['PENDING', 'VERIFYING', 'REJECTED', 'DISCARDED', 'PURGED']) {
      const row = await media(status);
      await expect(views.url(row.id, 'original', IN_SCOPE)).rejects.toMatchObject({ status: 409 });
    }
  });

  it('lists a work order’s evidence with thumbnails, leaving out discarded files', async () => {
    const ready = await media('READY');
    const pending = await media('PENDING');
    await media('DISCARDED');
    const list = await views.listForWorkOrder(WORK_ORDER, IN_SCOPE);
    expect(list.map((m) => m.id).sort()).toEqual([ready.id, pending.id].sort());
    expect(list.find((m) => m.id === ready.id)).toMatchObject({ distanceFromSiteM: 12, latitude: 26.4525, capturedAt: '2026-09-28T08:00:00.000Z' });
    expect(list.find((m) => m.id === ready.id)!.thumbnailUrl).toContain('X-Amz-Signature');
    expect(list.find((m) => m.id === pending.id)!.thumbnailUrl).toBeNull();
    expect(await views.listForWorkOrder(WORK_ORDER, OUT_OF_SCOPE)).toEqual([]);
  });
});

describe('AttachService', () => {
  const SUBMISSION = uuidv7();

  it('attaches READY files on the submission’s site and returns their capture facts', async () => {
    const a = await media('READY');
    const b = await media('READY');
    const out = await attach.attach({ submissionId: SUBMISSION, siteId: SITE, mediaIds: [b.id, a.id] });
    expect(out.map((m) => m.id)).toEqual([b.id, a.id]);
    expect(out[0]).toMatchObject({ contentHash: 'a'.repeat(64), distanceFromSiteM: 12, kind: 'PHOTO' });
    expect(await prisma.mediaObject.count({ where: { status: 'ATTACHED', attachedToSubmissionId: SUBMISSION } })).toBe(2);
    // Repeat for the same submission is harmless.
    expect((await attach.attach({ submissionId: SUBMISSION, siteId: SITE, mediaIds: [a.id] })).map((m) => m.id)).toEqual([a.id]);
  });

  it('changes nothing when any file is missing, unverified, on another site or already in another submission', async () => {
    const good = await media('READY');
    const cases = [
      [uuidv7()],
      [(await media('VERIFYING')).id],
      [(await media('READY', { siteId: uuidv7() })).id],
      [(await media('ATTACHED', { attachedToSubmissionId: uuidv7() })).id],
    ];
    for (const extra of cases) {
      await expect(attach.attach({ submissionId: SUBMISSION, siteId: SITE, mediaIds: [good.id, ...extra] })).rejects.toMatchObject({ status: 409 });
    }
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: good.id } })).status).toBe('READY');
  });
});
```

Run: `pnpm --filter media exec vitest run src/viewing` — Expected: FAIL (modules missing).

- [ ] **Step 2: Implement**

`apps/media/src/viewing/view.service.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { MediaKind, MediaStatus, MediaView, SignedGet } from '@ipms/contracts';
import { readableName } from '../media/filename.js';
import { VIEWABLE } from '../media/status.js';
import type { StorageClient } from '../storage/storage.client.js';

export const VIEW_URL_TTL_SECONDS = 300;

const inScope = (scope: AuthzScope, row: MediaObject): boolean =>
  scope.global || (row.projectId !== null && scope.projectIds.includes(row.projectId)) || (row.siteId !== null && scope.siteIds.includes(row.siteId));

const num = (value: { toString(): string } | null): number | null => (value === null ? null : Number(value.toString()));

/**
 * Anyone whose scope reaches a site sees all of its media (spec M12). Scope is
 * evaluated on every call, so a revoked user's last link dies within 5 minutes.
 */
export class ViewService {
  constructor(private readonly prisma: PrismaClient, private readonly storage: StorageClient) {}

  async url(id: string, variant: 'original' | 'thumbnail', scope: AuthzScope): Promise<SignedGet> {
    const row = await this.prisma.mediaObject.findUnique({ where: { id } });
    // Out of scope reads as absent: a 403 would confirm the id exists.
    if (!row || !inScope(scope, row)) throw new NotFoundException('Media not found');
    if (!VIEWABLE.includes(row.status as MediaStatus)) throw new ConflictException(`This file is ${row.status.toLowerCase()} and cannot be viewed`);
    const key = variant === 'thumbnail' ? row.thumbnailKey : row.storageKey;
    if (!key) throw new NotFoundException('This file has no thumbnail');
    return this.storage.presignGet(key, VIEW_URL_TTL_SECONDS, readableName({ siteCode: row.siteCode, capturedAt: row.capturedAt, id: row.id, variant, kind: row.kind as MediaKind }));
  }

  async listForWorkOrder(workOrderId: string, scope: AuthzScope): Promise<MediaView[]> {
    const rows = await this.prisma.mediaObject.findMany({
      where: { AND: [scopeWhere(scope), { workOrderId, status: { notIn: ['DISCARDED', 'PURGED'] } }] },
      orderBy: { capturedAt: 'asc' },
    });
    return Promise.all(rows.map(async (row): Promise<MediaView> => ({
      id: row.id, kind: row.kind as MediaKind, status: row.status as MediaStatus,
      workOrderId: row.workOrderId, checklistItemId: row.checklistItemId, contentHash: row.contentHash, sizeBytes: row.sizeBytes,
      capturedAt: row.capturedAt?.toISOString() ?? null, receivedAt: row.receivedAt?.toISOString() ?? null,
      latitude: num(row.latitude), longitude: num(row.longitude), distanceFromSiteM: row.distanceFromSiteM, uploadedBy: row.uploadedBy,
      thumbnailUrl: VIEWABLE.includes(row.status as MediaStatus) && row.thumbnailKey
        ? (await this.storage.presignGet(row.thumbnailKey, VIEW_URL_TTL_SECONDS, readableName({ siteCode: row.siteCode, capturedAt: row.capturedAt, id: row.id, variant: 'thumbnail', kind: row.kind as MediaKind }))).signedUrl
        : null,
    })));
  }
}
```

`apps/media/src/attach/attach.service.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import type { AttachRequestDto, AttachedMedia, MediaKind } from '@ipms/contracts';

const num = (value: { toString(): string } | null): number | null => (value === null ? null : Number(value.toString()));

/**
 * qc's submit-time check: every referenced file exists, is verified, belongs
 * to the submission's site, and is not already evidence in another
 * submission. All or nothing, and repeat-safe for the same submission.
 */
export class AttachService {
  constructor(private readonly prisma: PrismaClient) {}

  async attach(dto: AttachRequestDto): Promise<AttachedMedia[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.mediaObject.findMany({ where: { id: { in: dto.mediaIds } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const usable = (row: MediaObject | undefined): row is MediaObject =>
        !!row && row.siteId === dto.siteId &&
        (row.status === 'READY' || (row.status === 'ATTACHED' && row.attachedToSubmissionId === dto.submissionId));
      const refused = dto.mediaIds.filter((id) => !usable(byId.get(id)));
      if (refused.length) throw new ConflictException(`These files cannot be attached: ${refused.join(', ')}`);

      await tx.mediaObject.updateMany({
        where: { id: { in: dto.mediaIds }, status: 'READY' },
        data: { status: 'ATTACHED', attachedToSubmissionId: dto.submissionId, attachedAt: new Date() },
      });
      return dto.mediaIds.map((id) => {
        const row = byId.get(id)!;
        return {
          id, kind: row.kind as MediaKind, contentHash: row.contentHash, capturedAt: row.capturedAt?.toISOString() ?? null,
          latitude: num(row.latitude), longitude: num(row.longitude), distanceFromSiteM: row.distanceFromSiteM,
        };
      });
    });
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter media exec vitest run src/viewing`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/media/src/viewing apps/media/src/attach/attach.service.ts
git commit -m "feat(media): scoped signed viewing and the internal attach contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Cancelled work order cleanup

**Files:**
- Create: `apps/media/src/cleanup/work-order-cancelled.consumer.ts`
- Create: `apps/media/src/cleanup/discard.sweeper.ts`
- Create: `apps/media/src/cleanup/cleanup.integration.spec.ts`

**Interfaces:**
- Consumes: `SUBJECTS.QC_WORK_ORDER_CANCELLED`, `QcWorkOrderCancelled`, `DurableConsumer`, `InMemoryDedupeStore`, `EventBus` (Task 2); `MediaDiscarder` (Task 6); `PRE_ATTACH`.
- Produces: `CANCEL_GRACE_DAYS = 30`; `class WorkOrderCancelledConsumer(prisma, bus)` with `handle(p: QcWorkOrderCancelled): Promise<number>` and `onModuleInit()` subscribing durable `media-work-order-cancelled`; `class DiscardSweeper(prisma, discarder)` with `sweep(now?: Date): Promise<number>`, polling hourly.

- [ ] **Step 1: Write the failing test**

`apps/media/src/cleanup/cleanup.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import type { EventBus } from '@ipms/events';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { MediaDiscarder } from '../media/discarder.js';
import { DiscardSweeper } from './discard.sweeper.js';
import { WorkOrderCancelledConsumer } from './work-order-cancelled.consumer.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
let consumer: WorkOrderCancelledConsumer;
let sweeper: DiscardSweeper;
beforeAll(async () => {
  [db, minio] = await Promise.all([startTestDb(), startMinio()]);
  prisma = db.prisma;
  consumer = new WorkOrderCancelledConsumer(prisma, {} as EventBus); // handle() is exercised directly
  sweeper = new DiscardSweeper(prisma, new MediaDiscarder(prisma, minio.client));
});
afterAll(async () => { await db?.stop(); await minio?.stop(); });
beforeEach(async () => { await prisma.mediaObject.deleteMany({}); });

const WORK_ORDER = uuidv7();
const DAY = 86_400_000;

async function media(status: string, workOrderId = WORK_ORDER) {
  const id = uuidv7();
  await minio.client.put(`c/${id}.jpg`, Buffer.from('x'), 'image/jpeg');
  return prisma.mediaObject.create({ data: {
    id, kind: 'PHOTO', category: 'EVIDENCE', contentType: 'image/jpeg', sizeBytes: 1, contentHash: 'a'.repeat(64),
    storageKey: `c/${id}.jpg`, uploadedBy: uuidv7(), status, workOrderId,
  } });
}

describe('cancelled work orders', () => {
  it('schedules unsubmitted evidence for 30 days after cancellation, leaving attached evidence and other work orders alone', async () => {
    const ready = await media('READY');
    const pending = await media('PENDING');
    const attached = await media('ATTACHED');
    const elsewhere = await media('READY', uuidv7());
    const cancelledAt = new Date('2026-09-01T00:00:00Z');

    expect(await consumer.handle({ workOrderId: WORK_ORDER, projectId: uuidv7(), siteId: uuidv7(), cancelledAt: cancelledAt.toISOString() })).toBe(2);
    for (const row of [ready, pending]) {
      expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).discardAfter).toEqual(new Date(cancelledAt.getTime() + 30 * DAY));
    }
    for (const row of [attached, elsewhere]) {
      expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).discardAfter).toBeNull();
    }
    // Redelivery changes nothing.
    expect(await consumer.handle({ workOrderId: WORK_ORDER, projectId: uuidv7(), siteId: uuidv7(), cancelledAt: new Date().toISOString() })).toBe(0);
  });

  it('discards only once the grace period has passed, and never evidence attached meanwhile', async () => {
    const early = await media('READY');
    const due = await media('READY');
    const attachedSince = await media('ATTACHED');
    const now = new Date();
    await prisma.mediaObject.update({ where: { id: early.id }, data: { discardAfter: new Date(now.getTime() + DAY) } });
    await prisma.mediaObject.updateMany({ where: { id: { in: [due.id, attachedSince.id] } }, data: { discardAfter: new Date(now.getTime() - DAY) } });

    expect(await sweeper.sweep(now)).toBe(1);
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: due.id } })).status).toBe('DISCARDED');
    expect(await minio.client.head(due.storageKey)).toBeNull();
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: early.id } })).status).toBe('READY');
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: attachedSince.id } })).status).toBe('ATTACHED');
  });
});
```

Run: `pnpm --filter media exec vitest run src/cleanup` — Expected: FAIL (modules missing).

- [ ] **Step 2: Implement**

`apps/media/src/cleanup/work-order-cancelled.consumer.ts`:

```ts
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/media';
import { DurableConsumer, InMemoryDedupeStore, SUBJECTS, type EventBus, type QcWorkOrderCancelled } from '@ipms/events';
import type { MediaStatus } from '@ipms/contracts';
import { PRE_ATTACH } from '../media/status.js';

export const CANCEL_GRACE_DAYS = 30;

/**
 * A cancelled work order's unsubmitted evidence is kept 30 days, then
 * discarded by the sweeper. Idempotent on its own (only rows with no
 * discardAfter yet are touched), so an in-memory dedupe store is enough.
 */
@Injectable()
export class WorkOrderCancelledConsumer implements OnModuleInit {
  constructor(private readonly prisma: PrismaClient, private readonly bus: EventBus) {}

  async onModuleInit(): Promise<void> {
    const consumer = new DurableConsumer(this.bus, new InMemoryDedupeStore());
    await consumer.subscribe<QcWorkOrderCancelled>(SUBJECTS.QC_WORK_ORDER_CANCELLED, 'media-work-order-cancelled', async (envelope) => {
      await this.handle(envelope.payload);
    });
  }

  async handle(p: QcWorkOrderCancelled): Promise<number> {
    const discardAfter = new Date(Date.parse(p.cancelledAt) + CANCEL_GRACE_DAYS * 86_400_000);
    const result = await this.prisma.mediaObject.updateMany({
      where: { workOrderId: p.workOrderId, status: { in: [...PRE_ATTACH] as MediaStatus[] }, discardAfter: null },
      data: { discardAfter },
    });
    return result.count;
  }
}
```

`apps/media/src/cleanup/discard.sweeper.ts`:

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/media';
import type { MediaStatus } from '@ipms/contracts';
import { createLogger } from '@ipms/observability';
import type { MediaDiscarder } from '../media/discarder.js';
import { PRE_ATTACH } from '../media/status.js';

const log = createLogger('media');
const HOUR_MS = 3_600_000;
const BATCH = 100;

/** Removes cancelled work orders' leftovers once their grace period ends. Attached evidence is never selected. */
@Injectable()
export class DiscardSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaClient, private readonly discarder: MediaDiscarder) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.sweep().catch((err: unknown) => log.error({ err }, 'discard sweep failed')); }, HOUR_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<number> {
    const due = await this.prisma.mediaObject.findMany({
      where: { discardAfter: { lte: now }, status: { in: [...PRE_ATTACH] as MediaStatus[] } },
      take: BATCH,
    });
    for (const row of due) await this.discarder.discard(row, null, 'media.discarded_after_cancel');
    return due.length;
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter media exec vitest run src/cleanup`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/media/src/cleanup
git commit -m "feat(media): discard a cancelled work order's unsubmitted evidence after 30 days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Controllers and service wiring

**Files:**
- Create: `apps/media/src/uploads/upload.controller.ts`
- Create: `apps/media/src/viewing/view.controller.ts`
- Create: `apps/media/src/attach/attach.controller.ts`
- Create: `apps/media/src/controllers.spec.ts`
- Modify: `apps/media/src/app.module.ts` (full replacement)
- Modify: `apps/media/src/app.module.spec.ts` (append one test)
- Modify: `apps/media/src/main.ts`

**Interfaces:**
- Consumes: every service above; `RequirePermission` and `PERMISSION_KEY` from `@ipms/authz` (the decorator stores `{ permission: string }` under `PERMISSION_KEY`).
- Produces the HTTP surface (all under `/api/v1`):

| Route | Permission | Handler |
|---|---|---|
| `POST media/uploads/status` | `qc_evidence.upload` | `UploadService.status` |
| `POST media/uploads` | `qc_evidence.upload` | `UploadService.register` |
| `POST media/uploads/:id/parts` | `qc_evidence.upload` | `UploadService.parts` |
| `POST media/uploads/:id/complete` | `qc_evidence.upload` | `UploadService.complete` |
| `DELETE media/:id` | `qc_evidence.upload` | `UploadService.discard` |
| `GET media/:id/url` | `qc_submission.view` | `ViewService.url` |
| `GET media` (`?workOrderId=`) | `qc_submission.view` | `ViewService.listForWorkOrder` |
| `POST media/internal/attach` | `qc_submission.submit` | `AttachService.attach` |

- [ ] **Step 1: Write the failing controller-metadata test**

`apps/media/src/controllers.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY } from '@ipms/authz';
import { AttachController } from './attach/attach.controller.js';
import { UploadController } from './uploads/upload.controller.js';
import { ViewController } from './viewing/view.controller.js';

const reflect = Reflect as unknown as { getMetadata(key: string, target: object): unknown };
const permissionOf = (controller: { prototype: object }, method: string) =>
  (reflect.getMetadata(PERMISSION_KEY, (controller.prototype as Record<string, object>)[method]!) as { permission: string } | undefined)?.permission;

/** Every route names its permission: a route without one would be open to any signed-in user. */
describe('media route permissions', () => {
  it.each([
    [UploadController, 'status', 'qc_evidence.upload'],
    [UploadController, 'register', 'qc_evidence.upload'],
    [UploadController, 'parts', 'qc_evidence.upload'],
    [UploadController, 'complete', 'qc_evidence.upload'],
    [UploadController, 'discard', 'qc_evidence.upload'],
    [ViewController, 'url', 'qc_submission.view'],
    [ViewController, 'list', 'qc_submission.view'],
    [AttachController, 'attach', 'qc_submission.submit'],
  ] as const)('%o.%s needs %s', (controller, method, code) => {
    expect(permissionOf(controller, method)).toBe(code);
  });
});
```

Append to `apps/media/src/app.module.spec.ts` inside its `describe`:

```ts
  it('registers the upload, view and attach controllers', () => {
    const controllers = reflectMetadata.getMetadata('controllers', AppModule) as { name: string }[];
    expect(controllers.map((c) => c.name)).toEqual(expect.arrayContaining(['UploadController', 'ViewController', 'AttachController']));
  });
```

Run: `pnpm --filter media exec vitest run src/controllers.spec.ts src/app.module.spec.ts` — Expected: FAIL.

- [ ] **Step 2: Implement the controllers**

`apps/media/src/uploads/upload.controller.ts`:

```ts
import { Body, Controller, Delete, HttpCode, Param, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { CompleteUploadSchema, PartsRequestSchema, RegisterUploadSchema, UploadStatusRequestSchema, UuidSchema } from '@ipms/contracts';
import { UploadService } from './upload.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

/** The phone's upload protocol. Declared before `:id` routes so `status` is never read as an id. */
@Controller('media')
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  @Post('uploads/status') @HttpCode(200) @RequirePermission('qc_evidence.upload')
  status(@Body() body: unknown, @Req() req: Authed) {
    return this.uploads.status(UploadStatusRequestSchema.parse(body).ids, req.user.id);
  }

  @Post('uploads') @RequirePermission('qc_evidence.upload')
  register(@Body() body: unknown, @Req() req: Authed) {
    return this.uploads.register(RegisterUploadSchema.parse(body), req.user.id, req.headers['authorization'] ?? '');
  }

  @Post('uploads/:id/parts') @HttpCode(200) @RequirePermission('qc_evidence.upload')
  parts(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.uploads.parts(UuidSchema.parse(id), PartsRequestSchema.parse(body).partNumbers, req.user.id);
  }

  @Post('uploads/:id/complete') @HttpCode(200) @RequirePermission('qc_evidence.upload')
  complete(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.uploads.complete(UuidSchema.parse(id), CompleteUploadSchema.parse(body ?? {}), req.user.id);
  }

  @Delete(':id') @RequirePermission('qc_evidence.upload')
  discard(@Param('id') id: string, @Req() req: Authed) {
    return this.uploads.discard(UuidSchema.parse(id), req.user.id);
  }
}
```

`apps/media/src/viewing/view.controller.ts`:

```ts
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { ListMediaQuerySchema, UuidSchema, ViewUrlQuerySchema } from '@ipms/contracts';
import { required } from '../directory/lookup.js';
import { ProjectClient } from '../directory/project.client.js';
import { ViewService } from './view.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

@Controller('media')
export class ViewController {
  constructor(private readonly views: ViewService, private readonly project: ProjectClient) {}

  @Get(':id/url') @RequirePermission('qc_submission.view')
  async url(@Param('id') id: string, @Query() query: unknown, @Req() req: Authed) {
    const { variant } = ViewUrlQuerySchema.parse(query);
    return this.views.url(UuidSchema.parse(id), variant, await this.scope(req));
  }

  @Get() @RequirePermission('qc_submission.view')
  async list(@Query() query: unknown, @Req() req: Authed) {
    const { workOrderId } = ListMediaQuerySchema.parse(query);
    return this.views.listForWorkOrder(workOrderId, await this.scope(req));
  }

  private async scope(req: Authed) {
    return required(await this.project.scope(req.headers['authorization'] ?? ''), 'Access scope');
  }
}
```

`apps/media/src/attach/attach.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import { AttachRequestSchema } from '@ipms/contracts';
import { AttachService } from './attach.service.js';

/**
 * Service-to-service only: the gateway refuses every `/media/internal/` path.
 * qc calls this at submit with the submitting engineer's own token.
 */
@Controller('media/internal')
export class AttachController {
  constructor(private readonly attachments: AttachService) {}

  @Post('attach') @HttpCode(200) @RequirePermission('qc_submission.submit')
  attach(@Body() body: unknown) {
    return this.attachments.attach(AttachRequestSchema.parse(body));
  }
}
```

- [ ] **Step 3: Wire the module**

Replace `apps/media/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { EventBus } from '@ipms/events';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { AttachController } from './attach/attach.controller.js';
import { AttachService } from './attach/attach.service.js';
import { DiscardSweeper } from './cleanup/discard.sweeper.js';
import { WorkOrderCancelledConsumer } from './cleanup/work-order-cancelled.consumer.js';
import { loadConfig, type MediaConfig } from './config.js';
import { ProjectClient } from './directory/project.client.js';
import { QcClient } from './directory/qc.client.js';
import { MediaDiscarder } from './media/discarder.js';
import { OutboxDrainer } from './outbox/outbox.drainer.js';
import { PrismaService } from './prisma.service.js';
import { StorageClient } from './storage/storage.client.js';
import { UploadController } from './uploads/upload.controller.js';
import { UploadService } from './uploads/upload.service.js';
import { VerifyWorker } from './verify/verify.worker.js';
import { ViewController } from './viewing/view.controller.js';
import { ViewService } from './viewing/view.service.js';

/**
 * No media route passes a resource to check(), so this scope is never
 * consulted. Scope that matters is resolved per request from project (view
 * endpoints) or enforced by qc when it answers for a work order (uploads).
 * An empty, non-global scope is the least permissive value — do not "fix" it
 * into `global: true`.
 */
const mediaScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

const CONFIG = 'MEDIA_CONFIG';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [UploadController, ViewController, AttachController, HealthController, MetricsController],
  providers: [
    // Registration order matters: JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: mediaScopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    { provide: CONFIG, useFactory: (): MediaConfig => loadConfig() },
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
    {
      provide: StorageClient,
      useFactory: async (config: MediaConfig): Promise<StorageClient> => {
        const storage = new StorageClient(config.storage);
        if (config.storage.autoCreateBucket) await storage.ensureBucket();
        // A media that cannot reach its bucket must not hand out upload URLs.
        registerReadinessCheck('storage', () => storage.isHealthy());
        return storage;
      },
      inject: [CONFIG],
    },
    {
      provide: EventBus,
      useFactory: async (config: MediaConfig): Promise<EventBus> => {
        const bus = new EventBus();
        await bus.connect(config.natsUrl);
        await bus.ensureStreams();
        registerReadinessCheck('nats', () => bus.isHealthy());
        return bus;
      },
      inject: [CONFIG],
    },
    { provide: QcClient, useFactory: (config: MediaConfig) => new QcClient(config.qcUrl), inject: [CONFIG] },
    { provide: ProjectClient, useFactory: (config: MediaConfig) => new ProjectClient(config.projectUrl), inject: [CONFIG] },
    { provide: MediaDiscarder, useFactory: (p: PrismaService, s: StorageClient) => new MediaDiscarder(p.db, s), inject: [PrismaService, StorageClient] },
    {
      provide: UploadService,
      useFactory: (p: PrismaService, s: StorageClient, qc: QcClient, project: ProjectClient, d: MediaDiscarder) => new UploadService(p.db, s, qc, project, d),
      inject: [PrismaService, StorageClient, QcClient, ProjectClient, MediaDiscarder],
    },
    { provide: ViewService, useFactory: (p: PrismaService, s: StorageClient) => new ViewService(p.db, s), inject: [PrismaService, StorageClient] },
    { provide: AttachService, useFactory: (p: PrismaService) => new AttachService(p.db), inject: [PrismaService] },
    { provide: VerifyWorker, useFactory: (p: PrismaService, s: StorageClient) => new VerifyWorker(p.db, s), inject: [PrismaService, StorageClient] },
    { provide: OutboxDrainer, useFactory: (p: PrismaService, bus: EventBus) => new OutboxDrainer(p.db, bus), inject: [PrismaService, EventBus] },
    { provide: WorkOrderCancelledConsumer, useFactory: (p: PrismaService, bus: EventBus) => new WorkOrderCancelledConsumer(p.db, bus), inject: [PrismaService, EventBus] },
    { provide: DiscardSweeper, useFactory: (p: PrismaService, d: MediaDiscarder) => new DiscardSweeper(p.db, d), inject: [PrismaService, MediaDiscarder] },
  ],
})
export class AppModule {}
```

In `apps/media/src/main.ts`, import `GlobalExceptionFilter` alongside `createLogger` and add after `NestFactory.create(...)`:

```ts
  app.useGlobalFilters(new GlobalExceptionFilter('media'));
```

- [ ] **Step 4: Run all media tests and typecheck**

Run: `pnpm --filter media test && pnpm --filter media typecheck && pnpm --filter media build`
Expected: all PASS; typecheck and build exit 0.

- [ ] **Step 5: Boot the stack and smoke-test health**

Run:

```bash
docker compose -f docker/docker-compose.yml up -d --build media
curl -s localhost:3000/health/ready
docker compose -f docker/docker-compose.yml exec media node -e "fetch('http://localhost:3006/health/ready').then(r=>r.text()).then(console.log)"
```

Expected: gateway ready; media's readiness JSON shows `postgres`, `storage` and `nats` all healthy.

- [ ] **Step 6: Commit**

```bash
git add apps/media/src
git commit -m "feat(media): upload, view and attach endpoints with storage readiness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end test, docs and deployment checklist

**Files:**
- Create: `e2e/media.e2e.spec.ts`
- Modify: `docker/env/README.md`
- Modify: `README.md` (service table)

**Interfaces:**
- Consumes: the running Compose stack (Task 11), demo accounts, `api()`/`waitForReady()` from `e2e/helpers/stack.ts`.

- [ ] **Step 1: Write the e2e spec**

`e2e/media.e2e.spec.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

async function login(user: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { email: `${user}@ipms.local`, password: DEMO_PASSWORD } });
  expect(res.status).toBe(201);
  return res.body.accessToken;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** UUIDv7 made the way the phone makes it. */
function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// Smallest valid JPEG header + filler: enough for the sniff; sharp will reject it, so we assert that path too.
const jpegLike = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);

let admin: string;
let engineer: string;
let engineerId: string;
beforeAll(async () => {
  await waitForReady();
  [admin, engineer] = await Promise.all([login('admin'), login('engineer')]);
  engineerId = (await api<{ items: { id: string }[] }>('/api/v1/users?search=engineer', { token: admin })).body.items[0]!.id;
}, 90_000);

describe('media', () => {
  it('register → upload to storage → complete → verified outcome → cleanup', async () => {
    const stamp = Date.now();
    const created = await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: admin, body: { code: `MED-${stamp}`, name: 'E2E media', category: 'QUALITY' } });
    const templateId = created.body.templateId;
    await api(`/api/v1/qc/templates/${templateId}/draft`, { method: 'PUT', token: admin, body: { revision: 1, document: { sections: [{ number: '1', title: 'Photos', items: [{ number: '1.1', requirementText: 'Label', minPhotos: 1, maxPhotos: 2 }] }] } } });
    await api(`/api/v1/qc/templates/${templateId}/publish`, { method: 'POST', token: admin });
    const projectId = (await api<{ id: string }>('/api/v1/projects', { method: 'POST', token: admin, body: { code: `MED-${stamp}`, name: 'Media e2e' } })).body.id;
    const siteId = (await api<{ id: string }>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', token: admin, body: { siteCode: 'KOS121', name: 'KOS121' } })).body.id;
    const scope = { level: 'PROJECT', projectId };
    await api(`/api/v1/users/${engineerId}/projects`, { method: 'POST', token: admin, body: scope });
    let workOrderId = '';
    try {
      await sleep(1500); // scope replicates to project over NATS
      const made = await api<{ created: { id: string }[] }>('/api/v1/work-orders', { method: 'POST', token: admin, body: {
        projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: engineerId, plannedCompletionAt: '2026-12-31T18:14:59Z',
      } });
      workOrderId = made.body.created[0]!.id;

      const id = uuidv7();
      const registration = {
        id, category: 'EVIDENCE', workOrderId, checklistItemId: uuidv7(), kind: 'PHOTO', contentType: 'image/jpeg',
        sizeBytes: jpegLike.length, contentHash: createHash('sha256').update(jpegLike).digest('hex'),
        capturedAt: new Date().toISOString(), deviceId: 'e2e',
      };
      const registered = await api<{ status: string; upload: { mode: string; signedUrl: string; headers: Record<string, string> } }>('/api/v1/media/uploads', { method: 'POST', token: engineer, body: registration });
      expect(registered.status).toBe(201);
      expect(registered.body.upload.mode).toBe('single');

      const put = await fetch(registered.body.upload.signedUrl, { method: 'PUT', body: jpegLike, headers: registered.body.upload.headers });
      expect(put.status).toBe(200);
      expect((await api(`/api/v1/media/uploads/${id}/complete`, { method: 'POST', token: engineer, body: {} })).status).toBe(200);

      // The worker polls every second. Random bytes after a JPEG marker cannot be decoded, so the honest outcome is REJECTED.
      let status = 'VERIFYING';
      for (let i = 0; i < 20 && status === 'VERIFYING'; i++) {
        await sleep(500);
        status = (await api<{ status: string }[]>('/api/v1/media/uploads/status', { method: 'POST', token: engineer, body: { ids: [id] } })).body[0]!.status;
      }
      expect(status).toBe('REJECTED');

      // Internal routes stay off the edge.
      expect((await api('/api/v1/media/internal/attach', { method: 'POST', token: admin, body: {} })).status).toBe(404);

      // Leave nothing behind in storage.
      expect((await api(`/api/v1/media/${id}`, { method: 'DELETE', token: engineer })).status).toBe(200);
    } finally {
      if (workOrderId) await api(`/api/v1/work-orders/${workOrderId}/cancel`, { method: 'POST', token: admin, body: { reason: 'e2e cleanup' } });
      await api(`/api/v1/users/${engineerId}/projects`, { method: 'DELETE', token: admin, body: scope });
    }
  }, 90_000);
});
```

- [ ] **Step 2: Run the e2e suite against the stack**

Run:

```bash
docker compose -f docker/docker-compose.yml up -d --build
pnpm --filter e2e e2e
```

Expected: every spec PASSES, including the existing `work-orders.e2e.spec.ts` (still submits unverified media ids — wiring `attach` into qc is sub-project 2).

- [ ] **Step 3: Document the secrets file and the deployment checklist**

Append to `docker/env/README.md`:

```markdown
## Media object storage

`media.env` points at the local MinIO container. On staging and production,
create **`media.secrets.env`** next to it (gitignored — never commit it) with
that environment's Cloudflare R2 values; Compose loads it after `media.env`,
so its values win:

    S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
    S3_PUBLIC_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
    S3_REGION=auto
    S3_BUCKET=ipms-media-prod            # or ipms-media-staging
    S3_ACCESS_KEY_ID=...
    S3_SECRET_ACCESS_KEY=...
    S3_FORCE_PATH_STYLE=false
    S3_AUTO_CREATE_BUCKET=false

### Deployment checklist (per environment)

1. R2 bucket exists with `r2.dev` public access disabled and no custom domain.
2. An Account API token scoped to **that bucket only**, *Object Read & Write*, **no client IP filter**.
3. Lifecycle rule: abort incomplete multipart uploads after 7 days. No object-expiry rules.
4. `media.secrets.env` created on the server with the values above.
5. When the environment has a web domain: CORS policy allowing `GET`, `PUT`, `HEAD` from that origin only, headers `content-type` and `x-amz-checksum-sha256`, exposing `ETag`.
6. Smoke test: register, upload and complete one photo against the bucket, confirm it turns `READY`, open its view link, then delete it.
```

In `README.md`'s service table, add a MinIO row:

```markdown
| **MinIO (local R2 stand-in)** | `localhost:9000` | `9000` | S3-compatible storage for media in development only |
```

- [ ] **Step 4: Commit**

```bash
git add e2e/media.e2e.spec.ts docker/env/README.md README.md
git commit -m "test(media): end-to-end upload through the gateway; R2 deployment checklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** §3 infra → Task 3; §3.4 readiness → Task 11; §4 model/keys/lifecycle → Tasks 4, 6, 10; §5.1 endpoints 1–7 → Tasks 7, 9, 11; §5.2 attach → Tasks 9, 11; §5.3 errors → Tasks 7, 9 (validation errors surface as 422 via the shared exception filter); §6.1 worker → Task 8; §6.2 cleanup → Tasks 2, 10 (event-driven, see amendments); §6.3 abandoned PENDING → `liveUploadId` in Task 7; §6.4 audit → Tasks 6, 8; §6.5 metrics → Tasks 6–8; §7 security → Tasks 2 (log redaction), 3 (signed headers), 4 (server-built keys), 7 (pending cap), 8 (pixel limit), 9 (per-call scope); §8 testing → every task + Task 12; §9 checklist → Task 12.
- **Deliberately not here:** gallery/document endpoints, watermark verification, `media.*` NATS events, qc calling `attach` — sub-projects 2–5.
