# QC Evidence Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A QC submission carries only real, verified evidence with correct photo and video counts; engineers keep a server-side draft with explicit device handover; rework reuses earlier files; reviewers see the photos and videos on the web.

**Architecture:** `qc` asks `media` (new read-only `POST /media/internal/check`) for each file's kind and usability, validates per-item counts, then calls the existing attach endpoint (relaxed to allow reuse within one work order) and writes the submission. Drafts are a new `WorkOrderDraft` table in `qc` with a holder device and a version number. The web reads evidence through a same-origin redirect route that signs a fresh link on every request.

**Tech Stack:** pnpm + Nx monorepo, NestJS 12 on Fastify, Prisma 7 (`@prisma-clients/<service>`), zod 4, Vitest, Testcontainers (Postgres, MinIO), Next.js (App Router, server components), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-29-qc-evidence-design.md`

## Global Constraints

- ESM imports use `.js` suffixes in `apps/qc`, `apps/media`, `libs/*`.
- New dependencies use exact versions (`pnpm add -E`). This plan adds none.
- IDs are UUIDv7 (`uuidv7()` from `@ipms/contracts`).
- `@ipms/*` libs are consumed **built**: after changing `libs/contracts` or `libs/observability`, run its `build` before testing an app.
- `minVideos` / `maxVideos`: integers 0–5, default 0, `maxVideos >= minVideos`.
- At most **25** media ids per item response.
- Draft `responses` serialised size ≤ **262 144 bytes** (256 KB) → otherwise 413.
- Draftable work-order statuses: `NOT_STARTED`, `ONGOING`, `RECTIFYING`.
- Refusal reasons (in the error envelope's `details.reason`): `MEDIA_NOT_READY`, `DRAFT_HELD_ELSEWHERE`, `DRAFT_STALE`, `WORK_ORDER_CLOSED`.
- Media check reasons: `UPLOADING`, `VERIFYING`, `REJECTED`, `NOT_FOUND`, `WRONG_WORK_ORDER`.
- Draft endpoints require `qc_submission.update`; media check requires `qc_submission.submit`.
- `photoMediaIds` stays accepted for one release, read as `mediaIds` (`mediaIds` wins if both sent).
- Never commit `docker/env/*.secrets.env`; never print secrets or signed URLs in logs.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Refinements to the spec made while planning

These are recorded in the spec by Task 11.

- **R1 — machine-readable codes.** The platform envelope's `error.code` is a fixed enum (`CONFLICT`, …) shared by every client, so the specific code goes in `error.details.reason` (e.g. `{"code":"CONFLICT","details":{"reason":"MEDIA_NOT_READY","files":[…]}}`). The shared exception filter learns to pass `details` through from an `HttpException`.
- **R2 — web links never expire.** Instead of retrying expired links in the browser, the web serves `GET /api/media/:id/:variant` on its own origin, which asks media for a fresh 5-minute link on every request and answers `302` to it. `<img>`, `<video>` and Download point at that route, so a tab left open never shows a broken image.
- **R3 — template editor.** The web draft editor gets Min/Max videos inputs (the spec only mentioned outlines), otherwise web-authored templates could never require video.
- **R4 — concurrent submits.** A lost race on `submission (taskId, attemptNo)` is returned as 409 ("already has a submission awaiting review") instead of 500.
- **R5 — no compose dependency.** `qc` does not `depends_on` media: without media, qc still starts and answers 503 on submits that carry files.

## File Structure

| File | Responsibility |
|---|---|
| `libs/contracts/src/qc/template.ts` | + `minVideos`/`maxVideos` and their check |
| `libs/contracts/src/qc/qc.ts` | `mediaIds` (with `photoMediaIds` compat), draft schemas and view, refusal reasons |
| `libs/contracts/src/qc/work-order.ts` | + `STARTED` event kind |
| `libs/contracts/src/media/media.ts` | Media check request/result types |
| `libs/observability/src/exception.filter.ts` | Pass `details` from `HttpException` responses |
| `apps/qc/prisma/schema.prisma` + migration `20260930000100_qc_evidence` | Video counts, `ItemMedia`, `WorkOrderDraft` |
| `apps/qc/src/templates/{document.ts,excel/*}` | Video counts through templates and Excel |
| `apps/media/src/attach/{judge.ts,attach.service.ts,attach.controller.ts}` | One usability rule for check and attach; reuse within work order |
| `apps/qc/src/submissions/media.client.ts` | HTTP client for media check/attach |
| `apps/qc/src/submissions/refusals.ts` | Builders for 409s with `details.reason` |
| `apps/qc/src/submissions/submission.service.ts` | New submit flow, scoped read |
| `apps/qc/src/drafts/{draft.service.ts,draft.controller.ts}` | Drafts and handover |
| `apps/qc/src/work-orders/work-order.service.ts` | Delete draft on reassign/cancel |
| `apps/web/app/lib/media-api.ts`, `apps/web/app/api/media/[id]/[variant]/route.ts` | Evidence data and fresh-link redirect |
| `apps/web/app/quality/work-orders/[id]/evidence.tsx` | Thumbnails, viewer, New badge |
| `e2e/qc-evidence.e2e.spec.ts` | Full flow through the gateway |

---

### Task 1: Contracts and error details

**Files:**
- Modify: `libs/contracts/src/qc/template.ts` (item schema, `checkItem`)
- Modify: `libs/contracts/src/qc/qc.ts`
- Modify: `libs/contracts/src/qc/work-order.ts:112-114`
- Modify: `libs/contracts/src/media/media.ts` (after `AttachRequestDto`)
- Modify: `libs/observability/src/exception.filter.ts`
- Test: `libs/contracts/src/qc/qc.spec.ts` (create), `libs/contracts/src/qc/template.spec.ts`, `libs/observability/src/exception.filter.spec.ts`

**Interfaces — Produces:**
- `ItemResponseInputSchema` → `{ itemId, selfCheckResult, selfCheckDescription?, textValue?, numberValue?, booleanValue?, selectValue?, mediaIds: string[] }`
- `MAX_MEDIA_PER_ITEM = 25`, `DRAFT_MAX_BYTES = 262_144`, `DRAFTABLE_STATUSES = ['NOT_STARTED','ONGOING','RECTIFYING']`
- `REFUSAL_REASONS = { MEDIA_NOT_READY, DRAFT_HELD_ELSEWHERE, DRAFT_STALE, WORK_ORDER_CLOSED }` (string values equal to keys)
- `DraftItemResponseSchema`, `DraftItemResponse`, `SaveDraftSchema`/`SaveDraftDto`, `TakeoverDraftSchema`/`TakeoverDraftDto`, `WorkOrderDraftView`
- `MediaCheckRequestSchema`/`MediaCheckRequestDto`, `MediaCheckReason`, `MediaCheckResult`
- `WORK_ORDER_EVENT_KINDS` includes `'STARTED'`
- Filter: `new ConflictException({ message, details })` → envelope `error.details = details`

- [ ] **Step 1: Write failing contract tests**

Create `libs/contracts/src/qc/qc.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ItemResponseInputSchema, SaveDraftSchema } from './qc.js';
import { TemplateItemInputSchema, PublishableDocumentSchema } from './template.js';

const ID = '0192f7a0-0000-7000-8000-000000000001';
const M1 = '0192f7a0-0000-7000-8000-0000000000a1';
const M2 = '0192f7a0-0000-7000-8000-0000000000a2';

describe('ItemResponseInputSchema', () => {
  it('reads mediaIds', () => {
    expect(ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS', mediaIds: [M1] }).mediaIds).toEqual([M1]);
  });
  it('reads the old photoMediaIds as mediaIds', () => {
    expect(ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS', photoMediaIds: [M1] }).mediaIds).toEqual([M1]);
  });
  it('prefers mediaIds when both are sent', () => {
    expect(ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS', photoMediaIds: [M1], mediaIds: [M2] }).mediaIds).toEqual([M2]);
  });
  it('defaults to no media and caps at 25', () => {
    expect(ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS' }).mediaIds).toEqual([]);
    expect(() => ItemResponseInputSchema.parse({ itemId: ID, selfCheckResult: 'PASS', mediaIds: Array(26).fill(M1) })).toThrow();
  });
});

describe('SaveDraftSchema', () => {
  it('accepts a partial answer', () => {
    const parsed = SaveDraftSchema.parse({ deviceId: 'd1', deviceLabel: 'Pixel 7', baseVersion: 0, responses: [{ itemId: ID }] });
    expect(parsed.responses[0]).toEqual({ itemId: ID, mediaIds: [] });
  });
  it('refuses a negative base version', () => {
    expect(() => SaveDraftSchema.parse({ deviceId: 'd1', deviceLabel: 'P', baseVersion: -1, responses: [] })).toThrow();
  });
});

describe('video counts on template items', () => {
  const item = { number: '1.1', requirementText: 'Label' };
  it('default to zero', () => {
    expect(TemplateItemInputSchema.parse(item)).toMatchObject({ minVideos: 0, maxVideos: 0 });
  });
  it('are capped at 5', () => {
    expect(() => TemplateItemInputSchema.parse({ ...item, maxVideos: 6 })).toThrow();
  });
  it('need max ≥ min', () => {
    const result = PublishableDocumentSchema.safeParse({ sections: [{ number: '1', title: 'A', items: [{ ...item, minVideos: 2, maxVideos: 1 }] }] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('Must be at least Min Videos (2)');
  });
});
```

Append inside `describe('GlobalExceptionFilter')` in `libs/observability/src/exception.filter.spec.ts` (add `ConflictException` to the `@nestjs/common` import):

```ts
  it('passes details from an HttpException object response', () => {
    const { host: h, response } = host();
    filter.catch(new ConflictException({ message: 'Some files are not ready', details: { reason: 'MEDIA_NOT_READY', files: [{ id: 'x', reason: 'UPLOADING' }] } }), h as never);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.send.mock.calls[0]![0].error).toMatchObject({
      code: 'CONFLICT', message: 'Some files are not ready', details: { reason: 'MEDIA_NOT_READY', files: [{ id: 'x', reason: 'UPLOADING' }] },
    });
  });

  it('adds no details for a plain message', () => {
    const { host: h, response } = host();
    filter.catch(new ConflictException('Taken'), h as never);
    expect(response.send.mock.calls[0]![0].error.details).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ipms/contracts test -- qc.spec && pnpm --filter @ipms/observability test -- exception.filter`
Expected: FAIL (`mediaIds` undefined, `minVideos` missing, `details` absent).

- [ ] **Step 3: Implement**

`libs/contracts/src/qc/template.ts` — in `TemplateItemInputSchema`, after `maxPhotos`:

```ts
  minVideos: z.number().int().min(0).max(5).default(0),
  maxVideos: z.number().int().min(0).max(5).default(0),
```

In `checkItem`, after the photo check:

```ts
  if (item.maxVideos < item.minVideos) {
    ctx.addIssue({ code: 'custom', path: [...path, 'maxVideos'], message: `Must be at least Min Videos (${item.minVideos})` });
  }
```

`libs/contracts/src/qc/qc.ts` — replace `ItemResponseInputSchema` and add the draft contracts:

```ts
export const MAX_MEDIA_PER_ITEM = 25;
export const DRAFT_MAX_BYTES = 262_144;
export const DRAFTABLE_STATUSES = ['NOT_STARTED', 'ONGOING', 'RECTIFYING'] as const;

/** `details.reason` of a 409, for clients to branch on without reading the message. */
export const REFUSAL_REASONS = {
  MEDIA_NOT_READY: 'MEDIA_NOT_READY',
  DRAFT_HELD_ELSEWHERE: 'DRAFT_HELD_ELSEWHERE',
  DRAFT_STALE: 'DRAFT_STALE',
  WORK_ORDER_CLOSED: 'WORK_ORDER_CLOSED',
} as const;

const MediaIdsSchema = z.array(UuidSchema).max(MAX_MEDIA_PER_ITEM);

/** Mobile builds before QC evidence send `photoMediaIds`; read it as `mediaIds` for one release. */
const withMediaIds = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object' || 'mediaIds' in raw || !('photoMediaIds' in raw)) return raw;
  const { photoMediaIds, ...rest } = raw as Record<string, unknown>;
  return { ...rest, mediaIds: photoMediaIds };
};

export const ItemResponseInputSchema = z.preprocess(withMediaIds, z.object({
  itemId: UuidSchema, selfCheckResult: VerdictSchema, selfCheckDescription: z.string().max(5000).optional(), textValue: z.string().max(5000).optional(), numberValue: z.number().optional(), booleanValue: z.boolean().optional(), selectValue: z.string().max(500).optional(), mediaIds: MediaIdsSchema.default([]),
}).strip());

export const DraftItemResponseSchema = z.object({
  itemId: UuidSchema, selfCheckResult: VerdictSchema.optional(), selfCheckDescription: z.string().max(5000).optional(), textValue: z.string().max(5000).optional(), numberValue: z.number().optional(), booleanValue: z.boolean().optional(), selectValue: z.string().max(500).optional(), mediaIds: MediaIdsSchema.default([]),
}).strip();
export type DraftItemResponse = z.infer<typeof DraftItemResponseSchema>;

const DeviceSchema = { deviceId: z.string().trim().min(1).max(255), deviceLabel: z.string().trim().min(1).max(100) };
export const SaveDraftSchema = z.object({ ...DeviceSchema, baseVersion: z.number().int().min(0), responses: z.array(DraftItemResponseSchema).max(1000) }).strip();
export type SaveDraftDto = z.infer<typeof SaveDraftSchema>;
export const TakeoverDraftSchema = z.object(DeviceSchema).strip();
export type TakeoverDraftDto = z.infer<typeof TakeoverDraftSchema>;

export interface WorkOrderDraftView {
  workOrderId: string;
  /** 0 for the unsaved rework pre-fill. */
  version: number;
  deviceId: string | null;
  deviceLabel: string | null;
  updatedAt: string | null;
  responses: DraftItemResponse[];
}
```

`CreateSubmissionSchema` stays as it is (it already references `ItemResponseInputSchema` and has `deviceId`).

`libs/contracts/src/qc/work-order.ts:112`:

```ts
export const WORK_ORDER_EVENT_KINDS = [
  'CREATED', 'STARTED', 'REASSIGNED', 'RESCHEDULED', 'CANCELLED', 'SUBMITTED', 'APPROVED', 'REJECTED',
] as const;
```

`libs/contracts/src/media/media.ts`, after `AttachRequestDto`:

```ts
export const MediaCheckRequestSchema = z.object({
  workOrderId: UuidSchema,
  siteId: UuidSchema,
  mediaIds: z.array(UuidSchema).min(1).max(500),
}).strip();
export type MediaCheckRequestDto = z.infer<typeof MediaCheckRequestSchema>;
export type MediaCheckReason = 'UPLOADING' | 'VERIFYING' | 'REJECTED' | 'NOT_FOUND' | 'WRONG_WORK_ORDER';
/** One per distinct requested id. `kind` is null when the file is missing or belongs elsewhere. */
export interface MediaCheckResult { id: string; kind: MediaKind | null; usable: boolean; reason?: MediaCheckReason }
```

`libs/observability/src/exception.filter.ts` — replace the `HttpException` branch:

```ts
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // A service may attach machine-readable details (e.g. `{ reason: 'MEDIA_NOT_READY' }`) by throwing
      // `new ConflictException({ message, details })`; they reach the client in the envelope.
      const details = typeof body === 'object' && body !== null && typeof (body as { details?: unknown }).details === 'object'
        ? (body as { details: Record<string, unknown> }).details
        : undefined;
      response.status(status).send(
        buildError(STATUS_TO_CODE[status] ?? 'INTERNAL', exception.message, correlationId, details),
      );
      return;
    }
```

- [ ] **Step 4: Run tests, build libs**

Run: `pnpm --filter @ipms/contracts test && pnpm --filter @ipms/observability test && pnpm --filter @ipms/contracts build && pnpm --filter @ipms/observability build`
Expected: all PASS, builds succeed.

Then confirm nothing downstream broke on the renamed field (qc still uses `photoMediaIds`, fixed in Task 6): `pnpm --filter qc typecheck` is **expected to fail** only on `photoMediaIds` references in `submission.service.ts` and its specs — note them, do not fix here.

- [ ] **Step 5: Commit**

```bash
git add libs/contracts libs/observability
git commit -m "feat(contracts): video counts, mediaIds, draft and media-check contracts; pass error details

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: QC schema and migration

**Files:**
- Modify: `apps/qc/prisma/schema.prisma`
- Create: `apps/qc/prisma/migrations/20260930000100_qc_evidence/migration.sql`
- Modify: `apps/qc/prisma/fixtures.ts` (`resetDb`)
- Test: `apps/qc/prisma/schema.integration.spec.ts`

**Interfaces — Produces:** Prisma models `ChecklistItem.minVideos/maxVideos`, `ItemMedia { id, itemResponseId, mediaId, kind, sequence }` (relation field `ItemResponse.media`), `WorkOrderDraft { workOrderId, holderId, deviceId, deviceLabel, version, responses, updatedAt }` (relation field `WorkOrder.draft`).

- [ ] **Step 1: Write the failing schema test**

Append to `apps/qc/prisma/schema.integration.spec.ts`:

```ts
import { seedWorkOrder } from './fixtures.js';

describe('QC evidence schema', () => {
  it('stores video counts, defaulting to zero', async () => {
    const { itemId } = await seedPublishedTemplate(prisma);
    expect(await prisma.checklistItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({ minVideos: 0, maxVideos: 0 });
  });

  it('keeps one draft per work order, removed with the work order', async () => {
    const { templateId } = await seedPublishedTemplate(prisma);
    const order = await seedWorkOrder(prisma, templateId);
    const data = { workOrderId: order.id, holderId: ACTOR, deviceId: 'd1', deviceLabel: 'Pixel 7', version: 1, responses: [] };
    await prisma.workOrderDraft.create({ data });
    await expect(prisma.workOrderDraft.create({ data })).rejects.toThrow();
    await prisma.workOrder.delete({ where: { id: order.id } });
    expect(await prisma.workOrderDraft.count()).toBe(0);
  });
});
```

(Merge the `seedWorkOrder` import into the existing import line from `./fixtures.js`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter qc test -- schema.integration`
Expected: FAIL — `minVideos` / `workOrderDraft` do not exist.

- [ ] **Step 3: Change the schema**

In `ChecklistItem`, after `maxPhotos`:

```prisma
  minVideos       Int              @default(0)
  maxVideos       Int              @default(0)
```

In `ItemResponse`, replace `photos ItemPhoto[]` with `media ItemMedia[]`, and replace the `ItemPhoto` model with:

```prisma
/// One file of an item's evidence in one attempt. `kind` is media's answer at submit, not the phone's.
model ItemMedia {
  id             String       @id @db.Uuid
  itemResponseId String       @db.Uuid
  mediaId        String       @db.Uuid
  /// PHOTO | VIDEO
  kind           String       @db.VarChar(10)
  sequence       Int
  itemResponse   ItemResponse @relation(fields: [itemResponseId], references: [id], onDelete: Cascade)

  @@unique([itemResponseId, sequence])
  @@map("item_media")
}
```

In `WorkOrder`, after `events WorkOrderEvent[]`, add `draft WorkOrderDraft?`, and update the `WorkOrderEvent.kind` doc comment to include `STARTED`. Add:

```prisma
/// The assignee's in-progress checklist, held by one device at a time.
/// Another device takes it over explicitly; a save from the old device is then refused.
model WorkOrderDraft {
  workOrderId String    @id @db.Uuid
  holderId    String    @db.Uuid
  deviceId    String    @db.VarChar(255)
  deviceLabel String    @db.VarChar(100)
  /// Bumped on every save and takeover; a save must name the version it was based on.
  version     Int
  responses   Json
  updatedAt   DateTime  @updatedAt @db.Timestamptz(6)
  workOrder   WorkOrder @relation(fields: [workOrderId], references: [id], onDelete: Cascade)

  @@map("work_order_draft")
}
```

- [ ] **Step 4: Write the migration**

`apps/qc/prisma/migrations/20260930000100_qc_evidence/migration.sql`:

```sql
ALTER TABLE "checklist_item"
  ADD COLUMN "minVideos" integer NOT NULL DEFAULT 0,
  ADD COLUMN "maxVideos" integer NOT NULL DEFAULT 0;

-- Every file recorded before videos existed was a photo.
ALTER TABLE "item_photo" RENAME TO "item_media";
ALTER TABLE "item_media" RENAME CONSTRAINT "item_photo_pkey" TO "item_media_pkey";
ALTER TABLE "item_media" RENAME CONSTRAINT "item_photo_itemResponseId_sequence_key" TO "item_media_itemResponseId_sequence_key";
ALTER TABLE "item_media" RENAME CONSTRAINT "item_photo_itemResponseId_fkey" TO "item_media_itemResponseId_fkey";
ALTER TABLE "item_media" ADD COLUMN "kind" varchar(10) NOT NULL DEFAULT 'PHOTO';
ALTER TABLE "item_media" ALTER COLUMN "kind" DROP DEFAULT;

CREATE TABLE "work_order_draft" (
  "workOrderId" uuid PRIMARY KEY REFERENCES "work_order"("id") ON DELETE CASCADE,
  "holderId" uuid NOT NULL,
  "deviceId" varchar(255) NOT NULL,
  "deviceLabel" varchar(100) NOT NULL,
  "version" integer NOT NULL,
  "responses" jsonb NOT NULL,
  "updatedAt" timestamptz(6) NOT NULL
);
```

Verify the three `item_photo_*` constraint names first against a migrated database: `docker compose -f docker/docker-compose.yml exec postgres-qc psql -U ipms_qc -d ipms_qc -c '\d item_photo'`. If a name differs, use the actual name in the `RENAME CONSTRAINT` line.

- [ ] **Step 5: Generate the client, update `resetDb`, run tests**

`apps/qc/prisma/fixtures.ts` `resetDb`: work orders cascade to drafts, so no change is needed unless a test inserts drafts without work orders; leave it.

Run: `pnpm --filter qc prisma:generate && pnpm --filter qc test -- schema.integration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/qc/prisma
git commit -m "feat(qc): video counts, item_media with kind, work_order_draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Video counts through templates and Excel

**Files:**
- Modify: `apps/qc/src/templates/document.ts` (read ~line 24, write ~line 47)
- Modify: `apps/qc/src/templates/excel/columns.ts`, `excel/parse.ts:24,158`, `excel/workbook.ts:14-20,34,74`
- Test: existing specs under `apps/qc/src/templates/**` and `apps/qc/prisma/template-import.integration.spec.ts`

**Interfaces — Consumes:** Task 1 `minVideos/maxVideos` on `TemplateItemInputSchema`; Task 2 columns.

- [ ] **Step 1: Write failing tests**

In `apps/qc/src/templates/excel/parse.spec.ts`:

1. In the `FULL` document, give item `1.2` video counts so the existing round-trip test covers them: `{ number: '1.2', requirementText: 'Barricaded', responseType: 'BOOLEAN', minPhotos: 1, maxPhotos: 2, minVideos: 0, maxVideos: 1 }`.

2. Add:

```ts
describe('video counts', () => {
  it('reads Min Videos / Max Videos', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE', 1, 2]], [...HEADER, 'Min Videos', 'Max Videos']));
    expect(parsed.errors).toEqual([]);
    expect(parsed.document!.sections[0]!.items[0]).toMatchObject({ minVideos: 1, maxVideos: 2 });
  });

  it('defaults them to 0 in workbooks made before videos existed', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE']]));
    expect(parsed.document!.sections[0]!.items[0]).toMatchObject({ minVideos: 0, maxVideos: 0 });
  });

  it('refuses a count above 5', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE', 0, 6]], [...HEADER, 'Min Videos', 'Max Videos']));
    expect(parsed.errors.map((e) => e.message)).toContain('Must be a whole number from 0 to 5');
  });

  it('the example rows include an item that allows a video', () => {
    expect(EXAMPLE_DOCUMENT.sections.flatMap((s) => s.items).some((item) => item.maxVideos > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter qc test -- parse`
Expected: FAIL on the new cases (and the round-trip, which now carries `maxVideos: 1`).

- [ ] **Step 3: Implement**

`columns.ts` — after the `maxPhotos` entry:

```ts
  { key: 'minVideos', header: 'Min Videos', width: 12 },
  { key: 'maxVideos', header: 'Max Videos', width: 12 },
```

`parse.ts` — `FIELD_COLUMNS` add `minVideos: 'minVideos', maxVideos: 'maxVideos',`; after the photo loop:

```ts
  for (const key of ['minVideos', 'maxVideos'] as const) {
    const raw = cells[key];
    if (raw === undefined) continue;
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0 || count > 5) { error(key, 'Must be a whole number from 0 to 5'); continue; }
    values[key] = count;
  }
```

A workbook without the columns never sets `cells.minVideos`, so the schema default (0) applies.

`workbook.ts`:
- sample items: add `minVideos: 0, maxVideos: 0` to every sample item, except item `1.2` ("Work area barricaded"): `minVideos: 0, maxVideos: 1`.
- after the photo instruction line add: `'Min Videos / Max Videos: 0 to 5. Blank means 0. Videos are recorded at 720p, up to 100 MB each.',`
- the export row: `item.minPhotos, item.maxPhotos, item.minVideos, item.maxVideos, yesNo(item.allowsNa), …`

`document.ts`:
- read mapping: after `maxPhotos: item.maxPhotos,` add `minVideos: item.minVideos,` and `maxVideos: item.maxVideos,`
- `writeTree` data: `minPhotos: item.minPhotos, maxPhotos: item.maxPhotos, minVideos: item.minVideos, maxVideos: item.maxVideos, allowsNa: …`

- [ ] **Step 4: Run tests**

Run: `pnpm --filter qc test -- templates template-import template-publish template-drafts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/qc/src/templates apps/qc/prisma
git commit -m "feat(qc): Min/Max Videos in templates and Excel import/export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Media — read-only check and reuse within a work order

**Files:**
- Create: `apps/media/src/attach/judge.ts`
- Modify: `apps/media/src/attach/attach.service.ts`, `apps/media/src/attach/attach.controller.ts`
- Test: `apps/media/src/attach/judge.spec.ts` (create), `apps/media/src/viewing/view-attach.integration.spec.ts`, `apps/media/src/controllers.spec.ts`

**Interfaces:**
- Consumes: Task 1 `MediaCheckRequestDto`, `MediaCheckResult`, `MediaCheckReason`.
- Produces: `judge(id: string, row: MediaObject | undefined, target: { workOrderId: string; siteId: string }): MediaCheckResult`; `AttachService.check(dto: MediaCheckRequestDto): Promise<MediaCheckResult[]>`; route `POST /api/v1/media/internal/check` (200, permission `qc_submission.submit`).

- [ ] **Step 1: Write failing unit tests for the rule**

`apps/media/src/attach/judge.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MediaObject } from '@prisma-clients/media';
import { judge } from './judge.js';

const target = { workOrderId: 'wo-1', siteId: 'site-1' };
const row = (patch: Partial<MediaObject>) => ({ id: 'm1', kind: 'PHOTO', category: 'EVIDENCE', status: 'READY', siteId: 'site-1', workOrderId: 'wo-1', ...patch }) as MediaObject;

describe('judge', () => {
  it.each([
    ['READY', true, undefined],
    ['ATTACHED', true, undefined],
    ['PENDING', false, 'UPLOADING'],
    ['VERIFYING', false, 'VERIFYING'],
    ['REJECTED', false, 'REJECTED'],
    ['DISCARDED', false, 'NOT_FOUND'],
    ['PURGE_SCHEDULED', false, 'NOT_FOUND'],
    ['PURGED', false, 'NOT_FOUND'],
  ])('%s → usable %s, reason %s', (status, usable, reason) => {
    const result = judge('m1', row({ status }), target);
    expect(result).toEqual({ id: 'm1', kind: 'PHOTO', usable, ...(reason ? { reason } : {}) });
  });

  it('treats a missing row or non-evidence as NOT_FOUND with no kind', () => {
    expect(judge('m1', undefined, target)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'NOT_FOUND' });
    expect(judge('m1', row({ category: 'GALLERY' }), target)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'NOT_FOUND' });
  });

  it('refuses another work order or site as WRONG_WORK_ORDER with no kind', () => {
    expect(judge('m1', row({ workOrderId: 'wo-2' }), target)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'WRONG_WORK_ORDER' });
    expect(judge('m1', row({ siteId: 'site-2' }), target)).toEqual({ id: 'm1', kind: null, usable: false, reason: 'WRONG_WORK_ORDER' });
  });
});
```

- [ ] **Step 2: Update the integration tests for reuse (they will fail against current code)**

In `view-attach.integration.spec.ts` `describe('AttachService')`:

1. In `'changes nothing when any file is missing, unverified, …'`, **remove** the last case (`ATTACHED` with a random `attachedToSubmissionId`) and rename the test to `'changes nothing when any file is missing, unverified, on another site, or another work order'`.

2. Replace `'lets exactly one of two concurrent attaches of the same file win'` with:

```ts
  it('lets later attempts of the same work order reuse a file, keeping the first attempt on record', async () => {
    const row = await media('READY');
    const first = uuidv7();
    const second = uuidv7();
    await attach.attach({ submissionId: first, workOrderId: WORK_ORDER, siteId: SITE, mediaIds: [row.id] });
    await attach.attach({ submissionId: second, workOrderId: WORK_ORDER, siteId: SITE, mediaIds: [row.id] });
    const final = await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } });
    expect(final).toMatchObject({ status: 'ATTACHED', attachedToSubmissionId: first });
  });

  it('serialises concurrent attaches of the same file: both succeed, one submission is on record', async () => {
    const row = await media('READY');
    const submissionA = uuidv7();
    const submissionB = uuidv7();
    const results = await Promise.allSettled([
      attach.attach({ submissionId: submissionA, workOrderId: WORK_ORDER, siteId: SITE, mediaIds: [row.id] }),
      attach.attach({ submissionId: submissionB, workOrderId: WORK_ORDER, siteId: SITE, mediaIds: [row.id] }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const final = await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } });
    expect(final.status).toBe('ATTACHED');
    expect([submissionA, submissionB]).toContain(final.attachedToSubmissionId);
  });
```

3. Replace `'never leaves a partial result for overlapping multi-file attaches'` with:

```ts
  it('attaches every file of overlapping multi-file requests exactly once', async () => {
    const f = await media('READY');
    const g = await media('READY');
    const submissionFG = uuidv7();
    const submissionF = uuidv7();
    const results = await Promise.allSettled([
      attach.attach({ submissionId: submissionFG, workOrderId: WORK_ORDER, siteId: SITE, mediaIds: [f.id, g.id] }),
      attach.attach({ submissionId: submissionF, workOrderId: WORK_ORDER, siteId: SITE, mediaIds: [f.id] }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const [rowF, rowG] = await Promise.all([
      prisma.mediaObject.findUniqueOrThrow({ where: { id: f.id } }),
      prisma.mediaObject.findUniqueOrThrow({ where: { id: g.id } }),
    ]);
    expect([submissionFG, submissionF]).toContain(rowF.attachedToSubmissionId);
    expect(rowG.attachedToSubmissionId).toBe(submissionFG);
  });
```

4. Add a `describe('AttachService.check')` block:

```ts
describe('AttachService.check', () => {
  it('reports kind and usability per distinct id, writing nothing', async () => {
    const ready = await media('READY');
    const attached = await media('ATTACHED', { attachedToSubmissionId: uuidv7() });
    const pending = await media('PENDING');
    const video = await media('VERIFYING', { kind: 'VIDEO' });
    const rejected = await media('REJECTED');
    const foreign = await media('READY', { workOrderId: uuidv7() });
    const missing = uuidv7();
    const out = await attach.check({ workOrderId: WORK_ORDER, siteId: SITE, mediaIds: [ready.id, attached.id, pending.id, video.id, rejected.id, foreign.id, missing, ready.id] });
    expect(out).toEqual([
      { id: ready.id, kind: 'PHOTO', usable: true },
      { id: attached.id, kind: 'PHOTO', usable: true },
      { id: pending.id, kind: 'PHOTO', usable: false, reason: 'UPLOADING' },
      { id: video.id, kind: 'VIDEO', usable: false, reason: 'VERIFYING' },
      { id: rejected.id, kind: 'PHOTO', usable: false, reason: 'REJECTED' },
      { id: foreign.id, kind: null, usable: false, reason: 'WRONG_WORK_ORDER' },
      { id: missing, kind: null, usable: false, reason: 'NOT_FOUND' },
    ]);
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: ready.id } })).status).toBe('READY');
  });
});
```

In `controllers.spec.ts` add the row `[AttachController, 'check', 'qc_submission.submit'],`.

- [ ] **Step 3: Run to verify failures**

Run: `pnpm --filter media test -- judge view-attach controllers`
Expected: FAIL (`judge.js` missing, `check` missing, reuse refused).

- [ ] **Step 4: Implement**

`apps/media/src/attach/judge.ts`:

```ts
import type { MediaObject } from '@prisma-clients/media';
import type { MediaCheckReason, MediaCheckResult, MediaKind } from '@ipms/contracts';

const WAITING: Partial<Record<string, MediaCheckReason>> = { PENDING: 'UPLOADING', VERIFYING: 'VERIFYING', REJECTED: 'REJECTED' };

/**
 * Whether one file can be evidence for a submission of `target`'s work order.
 * The one rule behind both the read-only check and attach.
 *
 * A file already ATTACHED is usable again for the same work order: rework
 * attempts carry forward the files the reviewer did not object to. A file
 * never moves to another work order, even on the same site.
 */
export function judge(id: string, row: MediaObject | undefined, target: { workOrderId: string; siteId: string }): MediaCheckResult {
  if (!row || row.category !== 'EVIDENCE') return { id, kind: null, usable: false, reason: 'NOT_FOUND' };
  if (row.siteId !== target.siteId || row.workOrderId !== target.workOrderId) return { id, kind: null, usable: false, reason: 'WRONG_WORK_ORDER' };
  const kind = row.kind as MediaKind;
  if (row.status === 'READY' || row.status === 'ATTACHED') return { id, kind, usable: true };
  return { id, kind, usable: false, reason: WAITING[row.status] ?? 'NOT_FOUND' };
}
```

`attach.service.ts`:
- Import `judge` and `MediaCheckRequestDto`, `MediaCheckResult`.
- Replace the class doc: `qc's submit-time checks. \`check\` reports, per file, whether it can be evidence (read-only); \`attach\` makes the usable ones evidence of record, all or nothing, and is repeat-safe.`
- Add:

```ts
  async check(dto: MediaCheckRequestDto): Promise<MediaCheckResult[]> {
    const ids = [...new Set(dto.mediaIds)];
    const rows = await this.prisma.mediaObject.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => judge(id, byId.get(id), dto));
  }
```

- In `attach`, replace the `usable` lambda and `refused` line with:

```ts
      const refused = ids.filter((id) => !judge(id, byId.get(id), dto).usable);
```

- Keep `readyCount` / `updateMany({ where: { id: { in: ids }, status: 'READY' } … })` / count guard unchanged. Already-ATTACHED files are not rewritten, so `attachedToSubmissionId` keeps the first attempt. Update the lock comment's last sentence to: `FOR UPDATE makes the second transaction wait, so it reads the first one's ATTACHED rows and neither rewrites them.`

`attach.controller.ts` — add (import `MediaCheckRequestSchema`):

```ts
  /** Read-only: whether each file could be attached right now, and its kind. */
  @Post('check') @HttpCode(200) @RequirePermission('qc_submission.submit')
  check(@Body() body: unknown) {
    return this.attachments.check(MediaCheckRequestSchema.parse(body));
  }
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter media test`
Expected: PASS (all media tests; previously 111 plus the new ones).

- [ ] **Step 6: Commit**

```bash
git add apps/media
git commit -m "feat(media): read-only evidence check; attach reuses files within a work order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: QC media client and refusal builders

**Files:**
- Create: `apps/qc/src/submissions/media.client.ts`, `apps/qc/src/submissions/refusals.ts`
- Test: `apps/qc/src/submissions/media.client.spec.ts`

**Interfaces:**
- Consumes: Task 1 `MediaCheckRequestDto`, `MediaCheckResult`, `AttachRequestDto`, `REFUSAL_REASONS`.
- Produces:
  - `class MediaClient { constructor(baseUrl: string, timeoutMs = 5000); check(body: MediaCheckRequestDto, bearer: string): Promise<MediaCheckResult[]>; attach(body: AttachRequestDto, bearer: string): Promise<'attached' | 'refused'> }` — 401/403 → `ForbiddenException`; network error, timeout or other non-2xx → `ServiceUnavailableException`.
  - `mediaNotReady(files: { id: string; reason?: string }[]): ConflictException`
  - `draftHeldElsewhere(holder: { deviceLabel: string; updatedAt: Date }): ConflictException`
  - `draftStale(version: number): ConflictException`
  - `workOrderClosed(): ConflictException`

- [ ] **Step 1: Write failing tests**

`apps/qc/src/submissions/media.client.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { MediaClient } from './media.client.js';

const body = { workOrderId: 'w', siteId: 's', mediaIds: ['m'] };
const respond = (status: number, json: unknown = {}) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(json), { status }));
afterEach(() => vi.restoreAllMocks());

describe('MediaClient', () => {
  const client = new MediaClient('http://media:3006');

  it('posts the check with the caller’s token and returns the results', async () => {
    const fetch = respond(200, [{ id: 'm', kind: 'PHOTO', usable: true }]);
    expect(await client.check(body, 'Bearer t')).toEqual([{ id: 'm', kind: 'PHOTO', usable: true }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://media:3006/api/v1/media/internal/check');
    expect(init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' } });
    expect(JSON.parse(String(init!.body))).toEqual(body);
  });

  it('maps attach 200 → attached and 409 → refused', async () => {
    respond(200, []);
    expect(await client.attach({ ...body, submissionId: 'x' }, 'Bearer t')).toBe('attached');
    vi.restoreAllMocks();
    respond(409);
    expect(await client.attach({ ...body, submissionId: 'x' }, 'Bearer t')).toBe('refused');
  });

  it('turns 403 into Forbidden and anything else into 503', async () => {
    respond(403);
    await expect(client.check(body, 'Bearer t')).rejects.toBeInstanceOf(ForbiddenException);
    vi.restoreAllMocks();
    respond(500);
    await expect(client.check(body, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.attach({ ...body, submissionId: 'x' }, 'Bearer t')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter qc test -- media.client`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`apps/qc/src/submissions/media.client.ts`:

```ts
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { AttachRequestDto, MediaCheckRequestDto, MediaCheckResult } from '@ipms/contracts';

/**
 * media's internal evidence endpoints, called at submit with the submitting
 * engineer's own token, so media applies their permission.
 *
 * Nothing degrades here: a submission whose evidence cannot be checked is not
 * accepted. 503 tells the phone to keep it queued and retry.
 */
export class MediaClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 5000) {}

  async check(body: MediaCheckRequestDto, bearer: string): Promise<MediaCheckResult[]> {
    const response = await this.post('/api/v1/media/internal/check', body, bearer);
    return (await response.json()) as MediaCheckResult[];
  }

  /** `refused`: some file changed since the check. */
  async attach(body: AttachRequestDto, bearer: string): Promise<'attached' | 'refused'> {
    try {
      await this.post('/api/v1/media/internal/attach', body, bearer);
      return 'attached';
    } catch (err) {
      if (err instanceof Refused) return 'refused';
      throw err;
    }
  }

  private async post(path: string, body: unknown, bearer: string): Promise<Response> {
    let response: Response;
    try {
      response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw unavailable();
    }
    if (response.ok) return response;
    if (response.status === 409) throw new Refused();
    if (response.status === 401 || response.status === 403) throw new ForbiddenException('You cannot submit evidence for this work order');
    throw unavailable();
  }
}

class Refused extends Error {}
const unavailable = () => new ServiceUnavailableException('Evidence could not be checked right now. Try again shortly.');
```

Note: a 409 from `check` never happens (it is read-only); if it did, `Refused` would escape as a 500 — acceptable, since it would be a media bug.

`apps/qc/src/submissions/refusals.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { REFUSAL_REASONS } from '@ipms/contracts';

/** 409s with `details.reason`, which the shared exception filter passes to the client. */
const conflict = (reason: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ message, details: { reason, ...extra } });

export const mediaNotReady = (files: { id: string; reason?: string | undefined }[]) =>
  conflict(REFUSAL_REASONS.MEDIA_NOT_READY, files.length
    ? 'Some evidence files are not ready to submit'
    : 'Evidence files changed while submitting; try again', { files: files.map((f) => ({ id: f.id, reason: f.reason })) });

export const draftHeldElsewhere = (holder: { deviceLabel: string; updatedAt: Date }) =>
  conflict(REFUSAL_REASONS.DRAFT_HELD_ELSEWHERE, `This work order is open on another device (${holder.deviceLabel})`, {
    deviceLabel: holder.deviceLabel, updatedAt: holder.updatedAt.toISOString(),
  });

export const draftStale = (version: number) =>
  conflict(REFUSAL_REASONS.DRAFT_STALE, 'This draft has changed since it was loaded', { version });

export const workOrderClosed = () =>
  conflict(REFUSAL_REASONS.WORK_ORDER_CLOSED, 'This work order is not open for changes');
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter qc test -- media.client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/qc/src/submissions/media.client.ts apps/qc/src/submissions/media.client.spec.ts apps/qc/src/submissions/refusals.ts
git commit -m "feat(qc): media check/attach client and refusal builders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: QC submit flow with evidence checks

**Files:**
- Modify: `apps/qc/src/submissions/submission.service.ts`
- Modify: `apps/qc/src/submissions/submission.controller.ts`
- Modify: `apps/qc/src/app.module.ts`, `docker/env/qc.env`
- Test: `apps/qc/src/submissions/submission.service.spec.ts`, `apps/qc/prisma/submission.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ItemResponseInputSchema.mediaIds`, `MediaKind`; Task 2 `ItemMedia`, `WorkOrderDraft`; Task 5 `MediaClient`, `mediaNotReady`, `draftHeldElsewhere`.
- Produces:
  - `new SubmissionService(prisma: PrismaClient, geofence: SiteGeofenceClient, media: MediaClient, graceDays: number)` — **argument order changes** (media before graceDays).
  - `getSubmission(id: string, scope: AuthzScope)` — scoped; response `responses[].media: { id, itemResponseId, mediaId, kind, sequence }[]` ordered by `sequence`.
  - Env `MEDIA_INTERNAL_URL` (default `http://media:3006`).

- [ ] **Step 1: Update the unit tests (they fail against current code)**

In `submission.service.spec.ts`:

1. Mocks: rename `itemPhoto` → `itemMedia`; add `workOrderDraft: { findUnique: vi.fn().mockResolvedValue(null), deleteMany: vi.fn() }`, and `submission.findFirst` stays. Add:

```ts
    media = {
      check: vi.fn(async (body: { mediaIds: string[] }) => body.mediaIds.map((id) => ({ id, kind: kinds[id] ?? 'PHOTO', usable: true }))),
      attach: vi.fn().mockResolvedValue('attached'),
    };
    service = new SubmissionService(prisma, geofenceClient, media, 7);
```

with `let media: any;` and `let kinds: Record<string, 'PHOTO' | 'VIDEO'> = {};` reset to `{}` in `beforeEach`.

2. The seeded item gains `minVideos: 0, maxVideos: 1`.

3. Replace the four evidence tests (`'rejects when required photos are missing…'` through `'successfully creates submission and records photos…'`) with:

```ts
    const P = (n: number) => `0192f7a0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
    const dtoWith = (mediaIds: string[], extra: Record<string, unknown> = {}) => ({
      taskId, siteId, projectId, templateVersionId, idempotencyKey: `idem-${Math.random()}`,
      responses: [{ itemId, selfCheckResult: 'PASS' as const, mediaIds }], ...extra,
    });

    it('counts photos and videos by the kinds media reports', async () => {
      kinds = { [P(2)]: 'VIDEO' };
      prisma.submission.create.mockResolvedValue({ id: 'sub-1', attemptNo: 2, submittedAt: new Date() });
      prisma.itemResponse.create.mockResolvedValue({ id: 'resp-1' });
      await service.createSubmission(dtoWith([P(1), P(2)]) as any, actorId, 'Bearer t');
      expect(media.check).toHaveBeenCalledWith({ workOrderId: taskId, siteId, mediaIds: [P(1), P(2)] }, 'Bearer t');
      expect(prisma.itemMedia.createMany).toHaveBeenCalledWith({ data: [
        { id: expect.any(String), itemResponseId: 'resp-1', mediaId: P(1), kind: 'PHOTO', sequence: 0 },
        { id: expect.any(String), itemResponseId: 'resp-1', mediaId: P(2), kind: 'VIDEO', sequence: 1 },
      ] });
      const submissionId = prisma.submission.create.mock.calls[0][0].data.id;
      expect(media.attach).toHaveBeenCalledWith({ submissionId, workOrderId: taskId, siteId, mediaIds: [P(1), P(2)] }, 'Bearer t');
      expect(prisma.workOrderDraft.deleteMany).toHaveBeenCalledWith({ where: { workOrderId: taskId } });
    });

    it('refuses too few photos without attaching anything', async () => {
      kinds = { [P(1)]: 'VIDEO' };
      await expect(service.createSubmission(dtoWith([P(1)]) as any, actorId, 'b')).rejects.toThrow('Item 1.1 needs 1–5 photos; it has 0');
      expect(media.attach).not.toHaveBeenCalled();
    });

    it('refuses too many videos', async () => {
      kinds = { [P(2)]: 'VIDEO', [P(3)]: 'VIDEO' };
      await expect(service.createSubmission(dtoWith([P(1), P(2), P(3)]) as any, actorId, 'b')).rejects.toThrow('Item 1.1 allows at most 1 video; it has 2');
    });

    it('refuses the same file twice', async () => {
      await expect(service.createSubmission(dtoWith([P(1), P(1)]) as any, actorId, 'b')).rejects.toThrow('Item 1.1 lists the same file twice');
    });

    it('refuses with MEDIA_NOT_READY and each file’s reason', async () => {
      media.check.mockResolvedValue([{ id: P(1), kind: 'PHOTO', usable: false, reason: 'UPLOADING' }]);
      await expect(service.createSubmission(dtoWith([P(1)]) as any, actorId, 'b')).rejects.toMatchObject({
        status: 409, response: { details: { reason: 'MEDIA_NOT_READY', files: [{ id: P(1), reason: 'UPLOADING' }] } },
      });
      expect(media.attach).not.toHaveBeenCalled();
    });

    it('re-checks and refuses when attach loses a race', async () => {
      media.attach.mockResolvedValue('refused');
      media.check
        .mockResolvedValueOnce([{ id: P(1), kind: 'PHOTO', usable: true }])
        .mockResolvedValueOnce([{ id: P(1), kind: 'PHOTO', usable: false, reason: 'NOT_FOUND' }]);
      await expect(service.createSubmission(dtoWith([P(1)]) as any, actorId, 'b')).rejects.toMatchObject({
        status: 409, response: { details: { reason: 'MEDIA_NOT_READY', files: [{ id: P(1), reason: 'NOT_FOUND' }] } },
      });
      expect(prisma.submission.create).not.toHaveBeenCalled();
    });

    it('refuses while the draft is held by another device', async () => {
      prisma.workOrderDraft.findUnique.mockResolvedValue({ deviceId: 'other', deviceLabel: 'Pixel 7', updatedAt: new Date('2026-09-30T08:00:00Z') });
      await expect(service.createSubmission(dtoWith([P(1)], { deviceId: 'mine' }) as any, actorId, 'b')).rejects.toMatchObject({
        status: 409, response: { details: { reason: 'DRAFT_HELD_ELSEWHERE', deviceLabel: 'Pixel 7' } },
      });
    });

    it('still refuses N/A where it is not allowed', async () => {
      const dto = { ...dtoWith([P(1)]), responses: [{ itemId, selfCheckResult: 'NA' as const, mediaIds: [P(1)] }] };
      await expect(service.createSubmission(dto as any, actorId, 'b')).rejects.toThrow('Item 1.1 does not allow N/A');
    });
```

Any other test in the file that constructs `SubmissionService` or references `itemPhoto` / `photoMediaIds`: update to `itemMedia` / `mediaIds` and the new constructor.

- [ ] **Step 2: Update and extend the integration tests**

In `apps/qc/prisma/submission.integration.spec.ts`:

```ts
import type { MediaClient } from '../src/submissions/media.client.js';
// A media that finds every file usable, reporting kinds from `kinds`.
let kinds: Record<string, 'PHOTO' | 'VIDEO'> = {};
let attachCalls = 0;
const fakeMedia = {
  check: async (body: { mediaIds: string[] }) => body.mediaIds.map((id) => ({ id, kind: kinds[id] ?? 'PHOTO', usable: true })),
  attach: async () => { attachCalls += 1; return 'attached' as const; },
} as unknown as MediaClient;
```

Construct with `new SubmissionService(prisma, noGeofence, fakeMedia, 7)`; reset `kinds = {}`, `attachCalls = 0` in `beforeEach`. Change `photoMediaIds: []` to `mediaIds: []` in `submitFor`. Add:

```ts
describe('createSubmission with evidence', () => {
  const seedPhotoItem = async () => {
    const seeded = await seedPublishedTemplate(prisma);
    await prisma.checklistItem.update({ where: { id: seeded.itemId }, data: { minPhotos: 1, maxPhotos: 2, maxVideos: 1 } });
    return seeded;
  };
  const withMedia = (task: SeededWorkOrder, versionId: string, itemId: string, mediaIds: string[]) => service.createSubmission({
    taskId: task.id, siteId: task.siteId, projectId: task.projectId, templateVersionId: versionId,
    idempotencyKey: `key-${uuidv7()}`, responses: [{ itemId, selfCheckResult: 'PASS', mediaIds }],
  }, ACTOR, 'Bearer t');

  it('records each file with its kind, in order, and removes the draft', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    await prisma.workOrderDraft.create({ data: { workOrderId: task.id, holderId: ACTOR, deviceId: 'd', deviceLabel: 'P', version: 3, responses: [] } });
    const [photo, video] = [uuidv7(), uuidv7()];
    kinds = { [video]: 'VIDEO' };
    const submission = await service.createSubmission({
      taskId: task.id, siteId: task.siteId, projectId: task.projectId, templateVersionId: versionId, deviceId: 'd',
      idempotencyKey: `key-${uuidv7()}`, responses: [{ itemId, selfCheckResult: 'PASS', mediaIds: [photo, video] }],
    }, ACTOR, 'Bearer t');
    const stored = await prisma.itemMedia.findMany({ where: { itemResponse: { submissionId: submission.id } }, orderBy: { sequence: 'asc' } });
    expect(stored.map((m) => [m.mediaId, m.kind, m.sequence])).toEqual([[photo, 'PHOTO', 0], [video, 'VIDEO', 1]]);
    expect(await prisma.workOrderDraft.count({ where: { workOrderId: task.id } })).toBe(0);
  });

  it('lets exactly one of two concurrent submissions of one work order through', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    const results = await Promise.allSettled([withMedia(task, versionId, itemId, [uuidv7()]), withMedia(task, versionId, itemId, [uuidv7()])]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await prisma.submission.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('accepts a retry after a failure between attach and the write', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    const photo = uuidv7();
    const original = prisma.$transaction.bind(prisma);
    let failed = false;
    // Fail the first write after media has attached, as a crash would.
    (prisma as unknown as { $transaction: unknown }).$transaction = (async (...args: Parameters<typeof original>) => {
      if (!failed) { failed = true; throw new Error('connection lost'); }
      return original(...args);
    }) as typeof original;
    try {
      await expect(withMedia(task, versionId, itemId, [photo])).rejects.toThrow('connection lost');
      await expect(withMedia(task, versionId, itemId, [photo])).resolves.toMatchObject({ attemptNo: 1 });
      expect(attachCalls).toBe(2);
    } finally {
      (prisma as unknown as { $transaction: unknown }).$transaction = original;
    }
  });
});

describe('getSubmission scope', () => {
  it('hides a submission outside the caller’s scope as not found', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma);
    const submission = await submit(versionId, itemId);
    await expect(service.getSubmission(submission.id, { global: false, projectIds: [submission.projectId], siteIds: [] })).resolves.toMatchObject({ id: submission.id });
    await expect(service.getSubmission(submission.id, { global: false, projectIds: [uuidv7()], siteIds: [] })).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 3: Run to verify failures**

Run: `pnpm --filter qc test -- submission`
Expected: FAIL (constructor, `itemMedia`, messages, scope).

- [ ] **Step 4: Implement the service**

`submission.service.ts` — new imports:

```ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma-clients/qc';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { uuidv7, type CreateSubmissionDto, type MediaKind, type ReviewSubmissionDto } from '@ipms/contracts';
import type { MediaClient } from './media.client.js';
import { draftHeldElsewhere, mediaNotReady } from './refusals.js';
```

(keep the existing other imports.) Constructor:

```ts
  constructor(
    private readonly prisma: PrismaClient,
    private readonly geofence: SiteGeofenceClient,
    private readonly media: MediaClient,
    private readonly graceDays: number,
  ) {}
```

Reads:

```ts
  /** A submission the caller's scope reaches; anything else reads as not found. */
  async getSubmission(id: string, scope: AuthzScope) {
    const found = await this.prisma.submission.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: { id: true } });
    if (!found) throw new NotFoundException('Submission not found');
    return this.load(id);
  }

  private async load(id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: { responses: { include: { item: true, media: { orderBy: { sequence: 'asc' } } } }, decisions: true, template: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }
```

In `createSubmission`, the duplicate path becomes `if (duplicate) return this.load(duplicate.id);`. After the existing `pending` check, insert the draft check; after the N/A loop, replace the old photo-count line and everything from `const last = …` to the transaction's `itemPhoto` write with the following. The complete new tail of the method:

```ts
    const draft = await this.prisma.workOrderDraft.findUnique({ where: { workOrderId: task.id }, select: { deviceId: true, deviceLabel: true, updatedAt: true } });
    if (draft && draft.deviceId !== dto.deviceId) throw draftHeldElsewhere(draft);

    const items = version.sections.flatMap((section) => section.items);
    const responses = new Map(dto.responses.map((response) => [response.itemId, response]));
    if (responses.size !== dto.responses.length || items.some((item) => item.isRequired && !responses.has(item.id)) || [...responses.keys()].some((id) => !items.some((item) => item.id === id))) throw new BadRequestException('Responses must contain every required item from this template exactly once');
    for (const item of items) {
      const response = responses.get(item.id);
      if (!response) continue;
      if (response.selfCheckResult === 'NA' && !item.allowsNa) throw new BadRequestException(`Item ${item.number} does not allow N/A`);
      if (new Set(response.mediaIds).size !== response.mediaIds.length) throw new BadRequestException(`Item ${item.number} lists the same file twice`);
    }
    const allIds = dto.responses.flatMap((response) => response.mediaIds);
    if (new Set(allIds).size !== allIds.length) throw new BadRequestException('The same file is used by more than one item');

    // Ask media before anything is attached: a submission that fails its counts must not lock files in as evidence.
    const kinds = new Map<string, MediaKind>();
    if (allIds.length) {
      const checked = await this.media.check({ workOrderId: task.id, siteId: task.siteId, mediaIds: allIds }, bearer);
      const unusable = checked.filter((file) => !file.usable);
      if (unusable.length) throw mediaNotReady(unusable);
      for (const file of checked) kinds.set(file.id, file.kind!);
    }
    for (const item of items) {
      const response = responses.get(item.id);
      if (!response) continue;
      const photos = response.mediaIds.filter((id) => kinds.get(id) === 'PHOTO').length;
      const videos = response.mediaIds.length - photos;
      checkCount(item.number, 'photo', photos, item.minPhotos, item.maxPhotos);
      checkCount(item.number, 'video', videos, item.minVideos, item.maxVideos);
    }

    const submissionId = uuidv7();
    if (allIds.length) {
      const attached = await this.media.attach({ submissionId, workOrderId: task.id, siteId: task.siteId, mediaIds: allIds }, bearer);
      if (attached === 'refused') {
        const again = await this.media.check({ workOrderId: task.id, siteId: task.siteId, mediaIds: allIds }, bearer);
        throw mediaNotReady(again.filter((file) => !file.usable));
      }
    }
    // If the write below fails, the files stay attached to `submissionId`, which is never stored.
    // A retry still passes attach: files attached to this work order are reusable by its next submission.

    const last = await this.prisma.submission.aggregate({ where: { taskId: dto.taskId }, _max: { attemptNo: true } });
    const integrityHash = createHash('sha256').update(JSON.stringify(dto.responses.map((r) => ({ itemId: r.itemId, result: r.selfCheckResult, media: r.mediaIds.map((id) => `${kinds.get(id)}:${id}`).sort() })).sort((a, b) => a.itemId.localeCompare(b.itemId)))).digest('hex');
    const outcome = resolveGeofence(await this.geofence.fetch(dto.siteId, bearer), dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const submission = await tx.submission.create({ data: { id: submissionId, taskId: dto.taskId, siteId: dto.siteId, projectId: dto.projectId, templateId: version.templateId, templateVersionId: version.id, templateVersion: version.version, attemptNo: (last._max.attemptNo ?? 0) + 1, status: 'SUBMITTED', submittedBy: actorId, submittedAt: new Date(), integrityHash, idempotencyKey: dto.idempotencyKey, deviceId: dto.deviceId ?? null, latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, distanceFromSiteM: outcome.distanceFromSiteM, geofenceStatus: outcome.geofenceStatus } });
        for (const response of dto.responses) {
          const itemResponse = await tx.itemResponse.create({ data: { id: uuidv7(), submissionId: submission.id, itemId: response.itemId, selfCheckResult: response.selfCheckResult, selfCheckDescription: response.selfCheckDescription ?? null, textValue: response.textValue ?? null, numberValue: response.numberValue ?? null, booleanValue: response.booleanValue ?? null, selectValue: response.selectValue ?? null } });
          if (response.mediaIds.length) await tx.itemMedia.createMany({ data: response.mediaIds.map((mediaId, sequence) => ({ id: uuidv7(), itemResponseId: itemResponse.id, mediaId, kind: kinds.get(mediaId)!, sequence })) });
        }
        // … the existing outbox event, work order update, audit and SUBMITTED timeline event, unchanged …
        await tx.workOrderDraft.deleteMany({ where: { workOrderId: task.id } });
        return submission;
      });
    } catch (err) {
      // Two submissions for one work order raced past the pending check; the unique (taskId, attemptNo) kept one.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('This task already has a submission awaiting review');
      throw err;
    }
  }
```

The `// … existing …` line stands for the four blocks already in the transaction today (outbox `fact`, `tx.workOrder.update` to `REVIEWING`, `recordAudit`, `event(… 'SUBMITTED' …)`): keep them byte-for-byte, in order, between the `for` loop and the new `deleteMany`.

Add below the class:

```ts
/** "needs 1–5 photos", "allows at most 1 video", "needs 2 videos". */
function checkCount(itemNumber: string, noun: 'photo' | 'video', count: number, min: number, max: number): void {
  if (count >= min && count <= max) return;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const wanted = max === 0 ? `allows no ${noun}s` : min === 0 ? `allows at most ${plural(max)}` : min === max ? `needs ${plural(min)}` : `needs ${min}–${max} ${noun}s`;
  throw new BadRequestException(`Item ${itemNumber} ${wanted}; it has ${count}`);
}
```

Check the expected strings against the tests: `needs 1–5 photos; it has 0`, `allows at most 1 video; it has 2` — both produced by this function (min 1/max 5 photos; min 0/max 1 videos).

- [ ] **Step 5: Controller and wiring**

`submission.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { CreateSubmissionSchema, ReviewSubmissionSchema, UuidSchema } from '@ipms/contracts';
import { ProjectDirectoryClient, required } from '../work-orders/project-directory.client.js';
import { SubmissionService } from './submission.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };
const bearerOf = (req: Authed): string => req.headers['authorization'] ?? '';

@Controller('qc/submissions')
export class SubmissionController {
  constructor(private readonly service: SubmissionService, private readonly projects: ProjectDirectoryClient) {}

  /** Scoped like work orders: a submission on a site the caller cannot see reads as not found. */
  @Get(':id') @RequirePermission('qc_submission.view')
  async get(@Param('id') id: string, @Req() req: Authed) {
    const parsed = UuidSchema.parse(id);
    return this.service.getSubmission(parsed, required(await this.projects.scope(bearerOf(req)), 'Scope'));
  }

  @Post() @RequirePermission('qc_submission.create')
  submit(@Body() body: unknown, @Req() req: Authed) {
    return this.service.createSubmission(CreateSubmissionSchema.parse(body), req.user.id, bearerOf(req));
  }

  @Post(':id/review') @RequirePermission('qc_review.approve')
  review(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.service.reviewSubmission(UuidSchema.parse(id), ReviewSubmissionSchema.parse(body), req.user.id);
  }
}
```

`app.module.ts`:

```ts
import { MediaClient } from './submissions/media.client.js';
const mediaInternalUrl = (): string => process.env['MEDIA_INTERNAL_URL'] ?? 'http://media:3006';
// providers:
    { provide: MediaClient, useFactory: () => new MediaClient(mediaInternalUrl()) },
    {
      provide: SubmissionService,
      useFactory: (prisma: PrismaService, geofence: SiteGeofenceClient, media: MediaClient) => new SubmissionService(prisma.db, geofence, media, graceDays()),
      inject: [PrismaService, SiteGeofenceClient, MediaClient],
    },
```

`docker/env/qc.env` — after `PROJECT_INTERNAL_URL=…` add `MEDIA_INTERNAL_URL=http://media:3006`. Do **not** add a compose `depends_on` on media (R5).

If `apps/qc/src/tasks/task-checklist.controller.ts` or any other file calls `getSubmission(` or constructs `SubmissionService`, update it (`grep -rn "getSubmission(\|new SubmissionService" apps/qc/src apps/qc/prisma`).

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter qc typecheck && pnpm --filter qc test`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/qc docker/env/qc.env
git commit -m "feat(qc): submissions check evidence with media, count photos and videos, attach, scope reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Drafts and device handover

**Files:**
- Create: `apps/qc/src/drafts/draft.service.ts`, `apps/qc/src/drafts/draft.controller.ts`
- Modify: `apps/qc/src/work-orders/work-order.service.ts` (`update`, `cancel`)
- Modify: `apps/qc/src/app.module.ts`
- Test: `apps/qc/prisma/drafts.integration.spec.ts` (create), `apps/qc/src/drafts/draft.controller.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1 `SaveDraftDto`, `TakeoverDraftDto`, `WorkOrderDraftView`, `DraftItemResponse`, `DRAFT_MAX_BYTES`, `DRAFTABLE_STATUSES`; Task 2 `WorkOrderDraft`; Task 5 `draftHeldElsewhere`, `draftStale`, `workOrderClosed`; `event()` and `recordAudit()` from existing code.
- Produces:
  - `new DraftService(prisma: PrismaClient)`
  - `get(workOrderId: string, actorId: string): Promise<WorkOrderDraftView>`
  - `save(workOrderId: string, dto: SaveDraftDto, actorId: string): Promise<WorkOrderDraftView>`
  - `takeover(workOrderId: string, dto: TakeoverDraftDto, actorId: string): Promise<WorkOrderDraftView>`
  - Routes `GET|PUT /api/v1/work-orders/:id/draft`, `POST /api/v1/work-orders/:id/draft/takeover`, all `qc_submission.update`.

- [ ] **Step 1: Write failing integration tests**

`apps/qc/prisma/drafts.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';
import { DraftService } from '../src/drafts/draft.service.js';
import { ACTOR, resetDb, seedPublishedTemplate, seedWorkOrder } from './fixtures.js';
import { startTestDb } from './test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let drafts: DraftService;
beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; drafts = new DraftService(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const PHONE = { deviceId: 'phone-a', deviceLabel: 'Pixel 7' };
const TABLET = { deviceId: 'tab-b', deviceLabel: 'Galaxy Tab' };
const order = async (status = 'NOT_STARTED') => {
  const { templateId, itemId } = await seedPublishedTemplate(prisma);
  return { ...(await seedWorkOrder(prisma, templateId, { status })), itemId };
};

describe('drafts', () => {
  it('creates on first save, moves NOT_STARTED to ONGOING with a STARTED entry, and reads back', async () => {
    const wo = await order();
    const saved = await drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [{ itemId: wo.itemId, selfCheckResult: 'PASS', mediaIds: [] }] }, ACTOR);
    expect(saved).toMatchObject({ version: 1, deviceId: 'phone-a', deviceLabel: 'Pixel 7' });
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe('ONGOING');
    expect((await prisma.workOrderEvent.findMany({ where: { workOrderId: wo.id } })).map((e) => e.kind)).toEqual(['STARTED']);
    expect((await drafts.get(wo.id, ACTOR)).responses).toEqual([{ itemId: wo.itemId, selfCheckResult: 'PASS', mediaIds: [] }]);
  });

  it('refuses a stale save and a save from another device', async () => {
    const wo = await order('ONGOING');
    await drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR);
    await expect(drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR)).rejects.toMatchObject({ status: 409, response: { details: { reason: 'DRAFT_STALE', version: 1 } } });
    await expect(drafts.save(wo.id, { ...TABLET, baseVersion: 1, responses: [] }, ACTOR)).rejects.toMatchObject({ status: 409, response: { details: { reason: 'DRAFT_HELD_ELSEWHERE', deviceLabel: 'Pixel 7' } } });
  });

  it('hands over on takeover; the old device is then refused', async () => {
    const wo = await order('ONGOING');
    await drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR);
    expect(await drafts.takeover(wo.id, TABLET, ACTOR)).toMatchObject({ version: 2, deviceId: 'tab-b' });
    await expect(drafts.save(wo.id, { ...PHONE, baseVersion: 2, responses: [] }, ACTOR)).rejects.toMatchObject({ response: { details: { reason: 'DRAFT_HELD_ELSEWHERE', deviceLabel: 'Galaxy Tab' } } });
    await expect(drafts.save(wo.id, { ...TABLET, baseVersion: 2, responses: [] }, ACTOR)).resolves.toMatchObject({ version: 3 });
  });

  it('serialises concurrent first saves: one creates, the other is stale', async () => {
    const wo = await order('ONGOING');
    const results = await Promise.allSettled([
      drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR),
      drafts.save(wo.id, { ...TABLET, baseVersion: 0, responses: [] }, ACTOR),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.workOrderDraft.count()).toBe(1);
  });

  it('is only for the assignee, and only while the work order is open for changes', async () => {
    const wo = await order('ONGOING');
    await expect(drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, uuidv7())).rejects.toMatchObject({ status: 403 });
    const reviewing = await order('REVIEWING');
    await expect(drafts.save(reviewing.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR)).rejects.toMatchObject({ status: 409, response: { details: { reason: 'WORK_ORDER_CLOSED' } } });
    await expect(drafts.get(uuidv7(), ACTOR)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a draft over 256 KB', async () => {
    const wo = await order('ONGOING');
    const big = 'x'.repeat(5000);
    const responses = Array.from({ length: 60 }, () => ({ itemId: wo.itemId, selfCheckDescription: big, mediaIds: [] }));
    await expect(drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses }, ACTOR)).rejects.toMatchObject({ status: 413 });
  });

  it('pre-fills a rework draft from the last attempt without saving it', async () => {
    const wo = await order('RECTIFYING');
    const submissionId = uuidv7();
    const responseId = uuidv7();
    const photo = uuidv7();
    const version = await prisma.templateVersion.findFirstOrThrow({ where: { templateId: wo.templateId } });
    await prisma.submission.create({ data: {
      id: submissionId, taskId: wo.id, siteId: wo.siteId, projectId: wo.projectId, templateId: wo.templateId, templateVersionId: version.id,
      templateVersion: 1, attemptNo: 1, status: 'REJECTED_REWORK', submittedBy: ACTOR, integrityHash: 'h', idempotencyKey: `k-${uuidv7()}`,
    } });
    await prisma.itemResponse.create({ data: { id: responseId, submissionId, itemId: wo.itemId, selfCheckResult: 'PASS', numberValue: 12.5, selfCheckDescription: 'ok' } });
    await prisma.itemMedia.create({ data: { id: uuidv7(), itemResponseId: responseId, mediaId: photo, kind: 'PHOTO', sequence: 0 } });
    await prisma.workOrder.update({ where: { id: wo.id }, data: { currentSubmissionId: submissionId, currentAttemptNo: 1 } });

    expect(await drafts.get(wo.id, ACTOR)).toEqual({
      workOrderId: wo.id, version: 0, deviceId: null, deviceLabel: null, updatedAt: null,
      responses: [{ itemId: wo.itemId, selfCheckResult: 'PASS', selfCheckDescription: 'ok', numberValue: 12.5, mediaIds: [photo] }],
    });
    expect(await prisma.workOrderDraft.count()).toBe(0);
  });
});
```

In `apps/qc/prisma/work-orders.integration.spec.ts` add (inside `describe('work orders against a real database')`, using the file's `create`, `service`, `reach`, `GLOBAL`, `ENGINEER`, `ANTENNA`, `ANTENNA_SITE`):

```ts
  it('deletes the draft when the work order is reassigned or cancelled', async () => {
    const OTHER = uuidv7();
    reach = { [ANTENNA]: [{ userId: ENGINEER, wholeProject: true, siteIds: [] }, { userId: OTHER, wholeProject: true, siteIds: [] }] };
    const addDraft = (workOrderId: string) => prisma.workOrderDraft.create({ data: { workOrderId, holderId: ENGINEER, deviceId: 'd', deviceLabel: 'P', version: 1, responses: [] } });

    const reassigned = (await create(ANTENNA, ANTENNA_SITE)).created[0]!;
    await addDraft(reassigned.id);
    await service.update(GLOBAL, reassigned.id, { assigneeId: OTHER }, ACTOR, 'Bearer t');
    expect(await prisma.workOrderDraft.count({ where: { workOrderId: reassigned.id } })).toBe(0);

    const cancelled = (await create(ANTENNA, ANTENNA_SITE)).created[0]!;
    await addDraft(cancelled.id);
    await service.cancel(GLOBAL, cancelled.id, { reason: 'Site dropped' }, ACTOR);
    expect(await prisma.workOrderDraft.count({ where: { workOrderId: cancelled.id } })).toBe(0);
  });

  it('keeps the draft when only the date moves', async () => {
    const order = (await create(ANTENNA, ANTENNA_SITE)).created[0]!;
    await prisma.workOrderDraft.create({ data: { workOrderId: order.id, holderId: ENGINEER, deviceId: 'd', deviceLabel: 'P', version: 1, responses: [] } });
    await service.update(GLOBAL, order.id, { plannedCompletionAt: new Date('2026-10-15T18:14:59Z') }, ACTOR, 'Bearer t');
    expect(await prisma.workOrderDraft.count({ where: { workOrderId: order.id } })).toBe(1);
  });
```

This file also constructs `SubmissionService` and submits with `photoMediaIds: []`; Task 6 already updated both (new constructor with a fake media client, `mediaIds: []`). If not, update them here the same way.

`apps/qc/src/drafts/draft.controller.spec.ts` — permission metadata, following `apps/media/src/controllers.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY } from '@ipms/authz';
import { DraftController } from './draft.controller.js';

const reflect = Reflect as unknown as { getMetadata(key: string, target: object): unknown };
const permissionOf = (method: string) =>
  (reflect.getMetadata(PERMISSION_KEY, (DraftController.prototype as unknown as Record<string, object>)[method]!) as { permission: string } | undefined)?.permission;

describe('draft routes', () => {
  it.each(['get', 'save', 'takeover'])('%s needs qc_submission.update', (method) => {
    expect(permissionOf(method)).toBe('qc_submission.update');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter qc test -- drafts draft.controller work-orders.integration`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the service**

`apps/qc/src/drafts/draft.service.ts`:

```ts
import { ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { Prisma, PrismaClient, WorkOrderDraft } from '@prisma-clients/qc';
import {
  DRAFT_MAX_BYTES, DRAFTABLE_STATUSES,
  type DraftItemResponse, type SaveDraftDto, type TakeoverDraftDto, type WorkOrderDraftView,
} from '@ipms/contracts';
import { recordAudit } from '../templates/audit.js';
import { draftHeldElsewhere, draftStale, workOrderClosed } from '../submissions/refusals.js';
import { event } from '../work-orders/work-order.service.js';

type Db = PrismaClient | Prisma.TransactionClient;

const view = (draft: WorkOrderDraft): WorkOrderDraftView => ({
  workOrderId: draft.workOrderId, version: draft.version, deviceId: draft.deviceId, deviceLabel: draft.deviceLabel,
  updatedAt: draft.updatedAt.toISOString(), responses: draft.responses as unknown as DraftItemResponse[],
});

/**
 * The assignee's in-progress checklist, kept so they can move to another device.
 *
 * One device holds it at a time. Another device must take it over explicitly;
 * after that, a save from the old device is refused, so a forgotten phone can
 * never overwrite newer work. Each save names the version it was based on.
 *
 * Every write locks the work order row first: that serialises the first save
 * (when there is no draft row to lock yet) as well as later ones.
 */
@Injectable()
export class DraftService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(workOrderId: string, actorId: string): Promise<WorkOrderDraftView> {
    const order = await this.requireWorkable(this.prisma, workOrderId, actorId);
    const draft = await this.prisma.workOrderDraft.findUnique({ where: { workOrderId } });
    if (draft) return view(draft);
    if (order.status === 'RECTIFYING' && order.currentSubmissionId) return this.prefill(workOrderId, order.currentSubmissionId);
    throw new NotFoundException('There is no draft for this work order');
  }

  async save(workOrderId: string, dto: SaveDraftDto, actorId: string): Promise<WorkOrderDraftView> {
    if (Buffer.byteLength(JSON.stringify(dto.responses)) > DRAFT_MAX_BYTES) throw new PayloadTooLargeException('This draft is too large to save');
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireWorkable(tx, workOrderId, actorId, true);
      const draft = await tx.workOrderDraft.findUnique({ where: { workOrderId } });
      const responses = dto.responses as unknown as Prisma.InputJsonArray;
      if (!draft) {
        if (dto.baseVersion !== 0) throw draftStale(0);
        const created = await tx.workOrderDraft.create({ data: { workOrderId, holderId: actorId, deviceId: dto.deviceId, deviceLabel: dto.deviceLabel, version: 1, responses } });
        if (order.status === 'NOT_STARTED') await this.start(tx, workOrderId, actorId);
        return view(created);
      }
      if (draft.deviceId !== dto.deviceId) throw draftHeldElsewhere(draft);
      if (draft.version !== dto.baseVersion) throw draftStale(draft.version);
      return view(await tx.workOrderDraft.update({ where: { workOrderId }, data: { deviceLabel: dto.deviceLabel, version: draft.version + 1, responses } }));
    });
  }

  async takeover(workOrderId: string, dto: TakeoverDraftDto, actorId: string): Promise<WorkOrderDraftView> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireWorkable(tx, workOrderId, actorId, true);
      const draft = await tx.workOrderDraft.findUnique({ where: { workOrderId } });
      if (!draft) throw new NotFoundException('There is no draft for this work order');
      return view(await tx.workOrderDraft.update({ where: { workOrderId }, data: { deviceId: dto.deviceId, deviceLabel: dto.deviceLabel, version: draft.version + 1 } }));
    });
  }

  private async requireWorkable(db: Db, workOrderId: string, actorId: string, lock = false) {
    if (lock) await db.$queryRaw`SELECT id FROM work_order WHERE id = ${workOrderId}::uuid FOR UPDATE`;
    const order = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { status: true, assigneeId: true, currentSubmissionId: true } });
    if (!order) throw new NotFoundException('Work order not found');
    if (order.assigneeId !== actorId) throw new ForbiddenException('This work order is not assigned to you');
    if (!(DRAFTABLE_STATUSES as readonly string[]).includes(order.status)) throw workOrderClosed();
    return order;
  }

  /** The first save: managers see that work has begun. */
  private async start(tx: Prisma.TransactionClient, workOrderId: string, actorId: string): Promise<void> {
    await tx.workOrder.update({ where: { id: workOrderId }, data: { status: 'ONGOING' } });
    await recordAudit(tx, {
      actorId, action: 'work_order.status_changed', objectType: 'WorkOrder', objectId: workOrderId,
      previousState: { status: 'NOT_STARTED' }, newState: { status: 'ONGOING' },
    });
    await event(tx, workOrderId, 'STARTED', new Date(), actorId, {});
  }

  /** Rework starts from the last attempt: same answers, same files. Not saved until the phone saves it. */
  private async prefill(workOrderId: string, submissionId: string): Promise<WorkOrderDraftView> {
    const responses = await this.prisma.itemResponse.findMany({
      where: { submissionId }, include: { media: { orderBy: { sequence: 'asc' } } }, orderBy: { id: 'asc' },
    });
    return {
      workOrderId, version: 0, deviceId: null, deviceLabel: null, updatedAt: null,
      responses: responses.map((r) => ({
        itemId: r.itemId,
        selfCheckResult: r.selfCheckResult as DraftItemResponse['selfCheckResult'],
        ...(r.selfCheckDescription !== null ? { selfCheckDescription: r.selfCheckDescription } : {}),
        ...(r.textValue !== null ? { textValue: r.textValue } : {}),
        ...(r.numberValue !== null ? { numberValue: Number(r.numberValue.toString()) } : {}),
        ...(r.booleanValue !== null ? { booleanValue: r.booleanValue } : {}),
        ...(r.selectValue !== null ? { selectValue: r.selectValue } : {}),
        mediaIds: r.media.map((m) => m.mediaId),
      })),
    };
  }
}
```

If `objectType: 'WorkOrder'` is not accepted by `recordAudit`'s `AuditObject` type, it already is — `submission.service.ts` uses it.

- [ ] **Step 4: Controller, work-order hooks, wiring**

`apps/qc/src/drafts/draft.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { SaveDraftSchema, TakeoverDraftSchema, UuidSchema } from '@ipms/contracts';
import { DraftService } from './draft.service.js';

type Authed = { user: AuthzUser };

/** The assignee's server-side draft, for switching devices. See DraftService. */
@Controller('work-orders/:id/draft')
export class DraftController {
  constructor(private readonly drafts: DraftService) {}

  @Get() @RequirePermission('qc_submission.update')
  get(@Param('id') id: string, @Req() req: Authed) {
    return this.drafts.get(UuidSchema.parse(id), req.user.id);
  }

  @Put() @RequirePermission('qc_submission.update')
  save(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.drafts.save(UuidSchema.parse(id), SaveDraftSchema.parse(body), req.user.id);
  }

  @Post('takeover') @HttpCode(200) @RequirePermission('qc_submission.update')
  takeover(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.drafts.takeover(UuidSchema.parse(id), TakeoverDraftSchema.parse(body), req.user.id);
  }
}
```

`work-order.service.ts`:
- In `update`'s transaction, after the `tx.workOrder.update(…)`: `if (reassign) await tx.workOrderDraft.deleteMany({ where: { workOrderId: id } });` with the comment `// The draft was the previous assignee's; the new one starts from the checklist. Its files stay with the work order.`
- In `cancel`'s transaction, after the `changed.count` check: `await tx.workOrderDraft.deleteMany({ where: { workOrderId: id } });`

`app.module.ts`: import `DraftController`, `DraftService`; add `DraftController` to `controllers` **before** `WorkOrderController`; add provider `{ provide: DraftService, useFactory: (prisma: PrismaService) => new DraftService(prisma.db), inject: [PrismaService] }`.

Gateway: `/api/v1/work-orders` already routes to qc, so no gateway change.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter qc typecheck && pnpm --filter qc test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/qc
git commit -m "feat(qc): server-side drafts with explicit device handover and rework pre-fill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Web — video counts in the template editor and outlines

**Files:**
- Modify: `apps/web/app/lib/qc-api.ts` (`ChecklistItem`)
- Modify: `apps/web/app/quality/templates/[id]/draft/editor-state.ts`, `draft-editor.tsx`
- Modify: `apps/web/app/quality/templates/labels.ts`, `version-view.tsx`, `apps/web/app/quality/work-orders/checklist-outline.tsx`
- Test: `apps/web/app/quality/templates/[id]/draft/editor-state.spec.ts`, `apps/web/app/quality/templates/labels.spec.ts` (create)

**Interfaces — Produces:** `videoLabel(min: number, max: number): string | null`; `EditorItem.minVideos/maxVideos: number`.

- [ ] **Step 1: Write failing tests**

`apps/web/app/quality/templates/labels.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { photoLabel, videoLabel } from './labels';

describe('evidence labels', () => {
  it('describes video counts like photo counts', () => {
    expect(videoLabel(0, 0)).toBeNull();
    expect(videoLabel(0, 2)).toBe('Optional, up to 2 videos');
    expect(videoLabel(1, 1)).toBe('1 video');
    expect(videoLabel(1, 3)).toBe('1–3 videos');
  });
  it('leaves photo labels unchanged', () => {
    expect(photoLabel(0, 1)).toBe('Optional, up to 1 photo');
    expect(photoLabel(2, 4)).toBe('2–4 photos');
  });
});
```

In `editor-state.spec.ts` add:

```ts
it('carries video counts through load and save, defaulting new items to 0', () => {
  const state = fromSections([{ number: '1', title: 'A', items: [{ number: '1.1', requirementText: 'R', severity: 'NORMAL', responseType: 'RESULT_ONLY', selectOptions: [], minPhotos: 0, maxPhotos: 0, minVideos: 1, maxVideos: 2, allowsNa: false, isRequired: true, guidanceText: null }] }]);
  expect(toDocument(state).sections[0]!.items[0]).toMatchObject({ minVideos: 1, maxVideos: 2 });
  const added = editorReducer(state, { type: 'addItem', sectionKey: state.sections[0]!.key });
  expect(added.sections[0]!.items[1]).toMatchObject({ minVideos: 0, maxVideos: 0 });
});
```

(Import `fromSections`, `toDocument`, `editorReducer` if the spec does not already.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- labels editor-state`
Expected: FAIL.

- [ ] **Step 3: Implement**

`labels.ts` — replace the `plural`/`photoLabel` pair with:

```ts
function countLabel(noun: 'photo' | 'video') {
  const plural = (n: number): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return (min: number, max: number): string | null => {
    if (max === 0) return null;
    if (min === 0) return `Optional, up to ${plural(max)}`;
    return min === max ? plural(min) : `${min}–${max} ${noun}s`;
  };
}

export const photoLabel = countLabel('photo');
export const videoLabel = countLabel('video');
```

`qc-api.ts` `ChecklistItem`: `minPhotos: number; maxPhotos: number; minVideos: number; maxVideos: number; allowsNa: …`.

`editor-state.ts`: add `minVideos: number; maxVideos: number;` to `EditorItem` and to the `WireSection` item type; `fromSections` maps `minVideos: item.minVideos, maxVideos: item.maxVideos`; `toDocument` emits them after `maxPhotos`; `blankItem` sets both to 0.

`draft-editor.tsx`, after the Max photos label:

```tsx
                    <label className="field">Min videos
                      <input type="number" min={0} max={5} value={item.minVideos} onChange={(e) => updateItem(section, item, { minVideos: Number(e.target.value) })} />
                      <FieldError message={err('minVideos')} />
                    </label>
                    <label className="field">Max videos
                      <input type="number" min={0} max={5} value={item.maxVideos} onChange={(e) => updateItem(section, item, { maxVideos: Number(e.target.value) })} />
                      <FieldError message={err('maxVideos')} />
                    </label>
```

`version-view.tsx`: import `videoLabel`; beside `const photos = …` add `const videos = videoLabel(item.minVideos, item.maxVideos);` and after the photos badge `{videos ? <span className="badge blue">{videos}</span> : null}`.

`checklist-outline.tsx`: import `videoLabel`; the summary count becomes `items.filter((item) => item.minPhotos > 0 || item.minVideos > 0).length` with the label `Photo/video proof`; per item add `const video = videoLabel(item.minVideos, item.maxVideos);` and `{video ? <i className="tag">{video}</i> : null}` after the photo tag.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter web test && pnpm --filter web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): Min/Max videos in the template editor and checklist outlines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web — evidence on the work-order page

**Files:**
- Create: `apps/web/app/lib/media-api.ts`, `apps/web/app/api/media/[id]/[variant]/route.ts`
- Create: `apps/web/app/quality/work-orders/[id]/evidence-model.ts`, `apps/web/app/quality/work-orders/[id]/evidence.tsx`
- Modify: `apps/web/app/lib/qc-api.ts` (`ItemPhoto` → `ItemMedia`, `photos` → `media`)
- Modify: `apps/web/app/quality/work-orders/[id]/filled-checklist.tsx`, `review-console.tsx`, `page.tsx`
- Modify: `apps/web/app/styles.css` (replace `.filled-photos` rules)
- Test: `apps/web/app/lib/media-api.spec.ts`, `apps/web/app/quality/work-orders/[id]/evidence-model.spec.ts`, `apps/web/app/api/media/route.spec.ts` (create all)

**Interfaces:**
- Consumes: media `GET /api/v1/media?workOrderId=` → `MediaView[]`; `GET /api/v1/media/:id/url?variant=original|thumbnail` → `{ signedUrl, expiresAt }`; qc submission `responses[].media`.
- Produces:
  - `listWorkOrderMedia(workOrderId: string): Promise<ApiResult<MediaView[]>>`
  - `mediaUrl(id: string, variant: 'original' | 'thumbnail'): Promise<ApiResult<{ signedUrl: string; expiresAt: string }>>`
  - Route `GET /api/media/:id/:variant` → 302 to a fresh signed URL; 404/403/401/503 as JSON.
  - `buildEvidence(response: { media: ItemMedia[] }, facts: Map<string, MediaView>, previous: Set<string> | null): EvidenceFile[]` with `EvidenceFile = { id, kind, capturedAt: string | null, distanceText: string, isNew: boolean, thumbSrc: string, originalSrc: string, downloadSrc: string }`
  - `<Evidence files={EvidenceFile[]} />` (client component)

- [ ] **Step 1: Write failing tests**

`apps/web/app/quality/work-orders/[id]/evidence-model.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildEvidence, distanceText } from './evidence-model';

const fact = (id: string, patch: Record<string, unknown> = {}) => [id, { id, kind: 'PHOTO', capturedAt: '2026-09-30T08:00:00.000Z', distanceFromSiteM: 12, ...patch }] as const;

describe('buildEvidence', () => {
  it('orders by sequence and links through the same-origin media route', () => {
    const files = buildEvidence(
      { media: [{ id: 'r2', itemResponseId: 'x', mediaId: 'b', kind: 'VIDEO', sequence: 1 }, { id: 'r1', itemResponseId: 'x', mediaId: 'a', kind: 'PHOTO', sequence: 0 }] },
      new Map([fact('a'), fact('b', { kind: 'VIDEO', distanceFromSiteM: null })]) as never,
      null,
    );
    expect(files.map((f) => [f.id, f.kind, f.isNew])).toEqual([['a', 'PHOTO', false], ['b', 'VIDEO', false]]);
    expect(files[0]).toMatchObject({ thumbSrc: '/api/media/a/thumbnail', originalSrc: '/api/media/a/original', downloadSrc: '/api/media/a/original', distanceText: '12 m from site' });
    expect(files[1]!.distanceText).toBe('No location');
  });

  it('marks files not in the previous attempt as new', () => {
    const files = buildEvidence(
      { media: [{ id: 'r1', itemResponseId: 'x', mediaId: 'a', kind: 'PHOTO', sequence: 0 }, { id: 'r2', itemResponseId: 'x', mediaId: 'c', kind: 'PHOTO', sequence: 1 }] },
      new Map([fact('a'), fact('c')]) as never,
      new Set(['a']),
    );
    expect(files.map((f) => f.isNew)).toEqual([false, true]);
  });

  it('still lists a file media no longer describes, without facts', () => {
    const [file] = buildEvidence({ media: [{ id: 'r1', itemResponseId: 'x', mediaId: 'gone', kind: 'PHOTO', sequence: 0 }] }, new Map(), null);
    expect(file).toMatchObject({ id: 'gone', capturedAt: null, distanceText: 'No location' });
  });
});

describe('distanceText', () => {
  it('uses km beyond 1000 m', () => {
    expect(distanceText(1450)).toBe('1.5 km from site');
    expect(distanceText(0)).toBe('0 m from site');
  });
});
```

`apps/web/app/api/media/route.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mediaUrl = vi.fn();
vi.mock('../../lib/media-api', () => ({ mediaUrl }));
const { GET } = await import('./[id]/[variant]/route');

const call = (id: string, variant: string) => GET(new Request('http://web/api/media'), { params: Promise.resolve({ id, variant }) });

describe('GET /api/media/:id/:variant', () => {
  beforeEach(() => mediaUrl.mockReset());

  it('redirects to a freshly signed link and forbids caching', async () => {
    mediaUrl.mockResolvedValue({ state: 'ready', data: { signedUrl: 'https://r2.example/x?X-Amz-Signature=s', expiresAt: '' } });
    const response = await call('0192f7a0-0000-7000-8000-000000000001', 'thumbnail');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://r2.example/x?X-Amz-Signature=s');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mediaUrl).toHaveBeenCalledWith('0192f7a0-0000-7000-8000-000000000001', 'thumbnail');
  });

  it('refuses an unknown variant or a malformed id without calling media', async () => {
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'raw')).status).toBe(404);
    expect((await call('../etc', 'original')).status).toBe(404);
    expect(mediaUrl).not.toHaveBeenCalled();
  });

  it('passes through sign-in, permission and availability failures', async () => {
    mediaUrl.mockResolvedValue({ state: 'unauthenticated' });
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'original')).status).toBe(401);
    mediaUrl.mockResolvedValue({ state: 'forbidden', message: 'no' });
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'original')).status).toBe(403);
    mediaUrl.mockResolvedValue({ state: 'unavailable', status: 409, message: 'not ready' });
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'original')).status).toBe(409);
    mediaUrl.mockResolvedValue({ state: 'unavailable', status: null, message: 'down' });
    expect((await call('0192f7a0-0000-7000-8000-000000000001', 'original')).status).toBe(503);
  });
});
```

`apps/web/app/lib/media-api.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: [] });
vi.mock('./api-client', () => ({ authFetch }));
const api = await import('./media-api');
beforeEach(() => { authFetch.mockClear(); });

describe('media-api', () => {
  it('lists a work order’s media', async () => {
    await api.listWorkOrderMedia('wo-1');
    expect(authFetch).toHaveBeenCalledWith('/api/v1/media', { query: { workOrderId: 'wo-1' } });
  });
  it('asks for a view link by variant', async () => {
    await api.mediaUrl('m-1', 'thumbnail');
    expect(authFetch).toHaveBeenCalledWith('/api/v1/media/m-1/url', { query: { variant: 'thumbnail' } });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- evidence-model media-api route`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the data layer and route**

`apps/web/app/lib/media-api.ts`:

```ts
import 'server-only';
import type { MediaView, SignedGet } from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

export type MediaVariant = 'original' | 'thumbnail';

/** Every file on a work order the caller's scope reaches, with capture facts. Thumbnail links inside expire; the page uses `/api/media/…` instead. */
export function listWorkOrderMedia(workOrderId: string): Promise<ApiResult<MediaView[]>> {
  return authFetch<MediaView[]>('/api/v1/media', { query: { workOrderId } });
}

/** A 5-minute link to one file. Never rendered into a page: see `app/api/media/[id]/[variant]/route.ts`. */
export function mediaUrl(id: string, variant: MediaVariant): Promise<ApiResult<SignedGet>> {
  return authFetch<SignedGet>(`/api/v1/media/${encodeURIComponent(id)}/url`, { query: { variant } });
}
```

(If `@ipms/contracts` is not a web dependency for these types, check `apps/web/package.json`; `api-client.ts` already imports `ErrorCode` from it, so it is.)

`apps/web/app/api/media/[id]/[variant]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { mediaUrl, type MediaVariant } from '../../../../lib/media-api';

const VARIANTS: readonly MediaVariant[] = ['original', 'thumbnail'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Evidence files on this origin, for `<img>`, `<video>` and downloads.
 *
 * The session cookie is http-only here, so the browser cannot ask media
 * itself. Each request signs a fresh 5-minute link and redirects to it: a page
 * left open never holds a link that has expired, and no signed URL is ever
 * rendered into HTML.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variant: string }> },
): Promise<NextResponse> {
  const { id, variant } = await params;
  if (!UUID.test(id) || !VARIANTS.includes(variant as MediaVariant)) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const result = await mediaUrl(id, variant as MediaVariant);
  switch (result.state) {
    case 'ready': {
      const response = NextResponse.redirect(result.data.signedUrl, 302);
      response.headers.set('cache-control', 'no-store');
      return response;
    }
    case 'unauthenticated': return NextResponse.json({ message: 'Sign in to view this file.' }, { status: 401 });
    case 'forbidden': return NextResponse.json({ message: result.message }, { status: 403 });
    case 'unavailable': return NextResponse.json({ message: result.message }, { status: result.status && result.status < 500 ? result.status : 503 });
  }
}
```

- [ ] **Step 4: Implement the model and component**

`apps/web/app/lib/qc-api.ts`:

```ts
export interface ItemMedia { id: string; itemResponseId: string; mediaId: string; kind: 'PHOTO' | 'VIDEO'; sequence: number }
// SubmissionDetail:
  responses: (ItemResponse & { item: ChecklistItem; media: ItemMedia[] })[];
```

(remove `ItemPhoto`; fix any other reference with `grep -rn "ItemPhoto\|\.photos" apps/web/app`.)

`apps/web/app/quality/work-orders/[id]/evidence-model.ts`:

```ts
import type { MediaView } from '@ipms/contracts';
import type { ItemMedia } from '../../../lib/qc-api';

export interface EvidenceFile {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  capturedAt: string | null;
  distanceText: string;
  /** Not in the previous attempt: the engineer added or replaced it in this one. */
  isNew: boolean;
  thumbSrc: string;
  originalSrc: string;
  downloadSrc: string;
}

export function distanceText(metres: number | null | undefined): string {
  if (metres === null || metres === undefined) return 'No location';
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km from site` : `${metres} m from site`;
}

/**
 * One item's files, in the order the engineer attached them. `facts` comes
 * from media (capture time, distance); a file media no longer lists still
 * appears, without them. `previous` is the prior attempt's file ids for this
 * item, or null on a first attempt.
 */
export function buildEvidence(response: { media: ItemMedia[] }, facts: Map<string, Pick<MediaView, 'capturedAt' | 'distanceFromSiteM'>>, previous: Set<string> | null): EvidenceFile[] {
  return [...response.media].sort((a, b) => a.sequence - b.sequence).map((file) => {
    const fact = facts.get(file.mediaId);
    const src = (variant: 'original' | 'thumbnail') => `/api/media/${file.mediaId}/${variant}`;
    return {
      id: file.mediaId, kind: file.kind, capturedAt: fact?.capturedAt ?? null, distanceText: distanceText(fact?.distanceFromSiteM),
      isNew: previous !== null && !previous.has(file.mediaId),
      thumbSrc: src('thumbnail'), originalSrc: src('original'), downloadSrc: src('original'),
    };
  });
}
```

`apps/web/app/quality/work-orders/[id]/evidence.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { formatDateTime } from '../labels';
import type { EvidenceFile } from './evidence-model';

/** A file that cannot be loaded shows a quiet placeholder instead of a broken image. */
function Thumb({ file }: { file: EvidenceFile }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="evidence-missing" aria-label="File unavailable">▣</span>;
  return <img src={file.thumbSrc} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function Evidence({ files }: { files: EvidenceFile[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (files.length === 0) return null;
  const current = open === null ? null : files[open]!;
  const step = (by: number) => setOpen((index) => (index === null ? null : (index + by + files.length) % files.length));

  return (
    <>
      <ul className="evidence" aria-label="Evidence">
        {files.map((file, index) => (
          <li key={file.id}>
            <button type="button" onClick={() => setOpen(index)} aria-label={`Open ${file.kind === 'VIDEO' ? 'video' : 'photo'} ${index + 1}`}>
              <Thumb file={file} />
              {file.kind === 'VIDEO' ? <span className="evidence-play" aria-hidden="true">▶</span> : null}
              {file.isNew ? <span className="evidence-new">New</span> : null}
            </button>
            <small>{file.capturedAt ? formatDateTime(file.capturedAt) : 'Time unknown'}</small>
            <small>{file.distanceText}</small>
          </li>
        ))}
      </ul>
      {current ? (
        <div className="evidence-viewer" role="dialog" aria-modal="true" aria-label="Evidence viewer" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(null); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); }} tabIndex={-1}>
          <div className="evidence-stage">
            {current.kind === 'VIDEO'
              ? <video key={current.id} src={current.originalSrc} poster={current.thumbSrc} controls autoPlay />
              : <img key={current.id} src={current.originalSrc} alt="" />}
          </div>
          <div className="evidence-bar">
            <button type="button" onClick={() => step(-1)} disabled={files.length < 2} aria-label="Previous">‹</button>
            <span>{(open ?? 0) + 1} / {files.length} · {current.distanceText}</span>
            <button type="button" onClick={() => step(1)} disabled={files.length < 2} aria-label="Next">›</button>
            <a className="primary-button" href={current.downloadSrc} download>Download</a>
            <button type="button" onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
```

Full-size zoom uses the browser's own image zoom (pinch / ctrl-scroll) inside `.evidence-stage`, which scrolls; no zoom library.

`styles.css` — replace the four `.filled-photos` lines with:

```css
.evidence { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
.evidence li { width: 112px; display: grid; gap: 2px; }
.evidence button { position: relative; width: 112px; height: 112px; padding: 0; border: 1px solid #cfd6e1; border-radius: 8px; overflow: hidden; background: var(--pale); cursor: zoom-in; }
.evidence img { width: 100%; height: 100%; object-fit: cover; display: block; }
.evidence small { font-size: 11px; color: var(--muted); }
.evidence-play { position: absolute; inset: 0; display: grid; place-content: center; font-size: 28px; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,.6); }
.evidence-new { position: absolute; top: 6px; left: 6px; padding: 1px 6px; border-radius: 999px; background: #1f6feb; color: #fff; font-size: 11px; font-weight: 600; }
.evidence-missing { display: grid; place-content: center; width: 100%; height: 100%; font-size: 22px; color: var(--muted); }
.evidence-viewer { position: fixed; inset: 0; z-index: 50; display: grid; grid-template-rows: 1fr auto; background: rgba(10, 14, 22, .92); }
.evidence-stage { overflow: auto; display: grid; place-items: center; padding: 16px; }
.evidence-stage img, .evidence-stage video { max-width: 100%; max-height: calc(100vh - 96px); }
.evidence-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; padding: 12px 16px; color: #fff; }
```

`filled-checklist.tsx`:
- import `Evidence` and `type EvidenceFile`.
- props gain `evidence: Map<string, EvidenceFile[]>` (keyed by `response.id`).
- replace the whole `{photos.length > 0 ? … : null}` block and the `const photos = …` line with `<Evidence files={evidence.get(response.id) ?? []} />`.
- update the component doc comment's last sentence to `…QC's call on it, and its photos and videos.`

`review-console.tsx`: if it renders per-item rows, add the same `evidence` prop and `<Evidence files={evidence.get(response.id) ?? []} />` under each item's requirement text, so a reviewer sees the files beside the approve/reject control. If it does not render per-item content (read it first), leave it unchanged.

`page.tsx` — after `submission` is resolved:

```tsx
import { listWorkOrderMedia } from '../../../lib/media-api';
import { buildEvidence, type EvidenceFile } from './evidence-model';

  // Evidence facts and the previous attempt (for the New badge) come in parallel.
  const previousId = submission && submission.attemptNo > 1
    ? wo.events.filter((e) => e.kind === 'SUBMITTED' && e.detail['attemptNo'] === submission.attemptNo - 1).map((e) => e.detail['submissionId']).find((v): v is string => typeof v === 'string')
    : undefined;
  const [mediaFacts, previousResult] = await Promise.all([
    submission ? listWorkOrderMedia(wo.id) : Promise.resolve(null),
    previousId ? getSubmission(previousId) : Promise.resolve(null),
  ]);
  const facts = new Map((mediaFacts?.state === 'ready' ? mediaFacts.data : []).map((m) => [m.id, m]));
  const previous = previousResult?.state === 'ready' ? previousResult.data : null;
  const evidence = new Map<string, EvidenceFile[]>();
  for (const response of submission?.responses ?? []) {
    const before = previous ? new Set(previous.responses.find((r) => r.itemId === response.itemId)?.media.map((m) => m.mediaId) ?? []) : null;
    evidence.set(response.id, buildEvidence(response, facts, before));
  }
```

and pass `evidence={evidence}` to `<FilledChecklist … />` (and `<ReviewConsole … />` if Step 4 added the prop). A media outage leaves `facts` empty: files still render (through the route), without time and distance.

- [ ] **Step 5: Run tests, typecheck, and look at it**

Run: `pnpm --filter web test && pnpm --filter web exec tsc --noEmit`
Expected: PASS.

Then with the stack running (`docker compose -f docker/docker-compose.yml up -d --build web qc media gateway`) open a work order that has a submission with evidence (Task 10's e2e leaves one; or submit one by hand), and check in the browser pane: thumbnails load, a video shows the play mark, the viewer opens and steps with arrows, Download saves `KOS…_….jpg`, and on attempt 2 the replaced file has **New**. Check at 375 px width that the strip wraps and the viewer bar wraps without horizontal scroll.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): show each item's photos and videos on the work order, with viewer and New badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end through the gateway

**Files:**
- Create: `e2e/qc-evidence.e2e.spec.ts`
- Modify: `e2e/work-orders.e2e.spec.ts` (no fake media ids), `e2e/media.e2e.spec.ts` (check route stays internal)

**Interfaces — Consumes:** everything above, through `http://gateway` via `e2e/helpers/stack.ts` (`api`, `waitForReady`, `DEMO_PASSWORD`).

- [ ] **Step 1: Stop the existing e2e from inventing media ids**

In `e2e/work-orders.e2e.spec.ts`, the template item becomes `{ number: '1.1', requirementText: 'PPE worn', minPhotos: 0, maxPhotos: 0 }` and the response `{ itemId: …, selfCheckResult: 'PASS' }` (no media). Remove the now-unused `mediaId` helper. That test is about the work-order lifecycle; evidence is covered by the new file.

In `e2e/media.e2e.spec.ts`, beside the attach assertion add:

```ts
      expect((await api('/api/v1/media/internal/check', { method: 'POST', token: admin, body: {} })).status).toBe(404);
```

- [ ] **Step 2: Write the evidence e2e**

`e2e/qc-evidence.e2e.spec.ts`:

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
function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// Two real 16×16 JPEGs (sharp can decode them, so they verify as READY).
const ORANGE = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKQAI2f/2Q==', 'base64');
const BLUE = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIAB6Ev/2Q==', 'base64');
// An MP4 media only sniffs (`ftyp` at offset 4); its poster is a real JPEG.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), randomBytes(4000)]);

let admin: string;
let qc: string;
let engineer: string;
let engineerId: string;
beforeAll(async () => {
  await waitForReady();
  [admin, qc, engineer] = await Promise.all([login('admin'), login('qc'), login('engineer')]);
  engineerId = (await api<{ items: { id: string }[] }>('/api/v1/users?search=engineer', { token: admin })).body.items[0]!.id;
}, 90_000);

async function upload(workOrderId: string, itemId: string, kind: 'PHOTO' | 'VIDEO', bytes: Buffer, poster?: Buffer): Promise<string> {
  const id = uuidv7();
  const registered = await api<{ upload: { signedUrl: string; headers: Record<string, string> }; posterUpload: { signedUrl: string; headers: Record<string, string> } | null }>('/api/v1/media/uploads', {
    method: 'POST', token: engineer,
    body: { id, category: 'EVIDENCE', workOrderId, checklistItemId: itemId, kind, contentType: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4', sizeBytes: bytes.length, contentHash: sha(bytes), capturedAt: new Date().toISOString(), deviceId: 'e2e-phone' },
  });
  expect(registered.status).toBe(201);
  if (poster) expect((await fetch(registered.body.posterUpload!.signedUrl, { method: 'PUT', body: poster, headers: registered.body.posterUpload!.headers })).status).toBe(200);
  expect((await fetch(registered.body.upload.signedUrl, { method: 'PUT', body: bytes, headers: registered.body.upload.headers })).status).toBe(200);
  expect((await api(`/api/v1/media/uploads/${id}/complete`, { method: 'POST', token: engineer, body: {} })).status).toBe(200);
  return id;
}

async function waitReady(ids: string[]): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const statuses = (await api<{ status: string }[]>('/api/v1/media/uploads/status', { method: 'POST', token: engineer, body: { ids } })).body.map((s) => s.status);
    if (statuses.every((s) => s === 'READY' || s === 'ATTACHED')) return;
    expect(statuses).not.toContain('REJECTED');
    await sleep(500);
  }
  throw new Error('media did not verify in time');
}

describe('QC evidence', () => {
  it('draft → takeover → submit with a photo and a video → rework reuses a file → approve', async () => {
    const stamp = Date.now();
    const templateId = (await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code: `EV-${stamp}`, name: 'E2E evidence', category: 'QUALITY' } })).body.templateId;
    await api(`/api/v1/qc/templates/${templateId}/draft`, { method: 'PUT', token: qc, body: { revision: 1, document: { sections: [{ number: '1', title: 'Install', items: [
      { number: '1.1', requirementText: 'Serial label', minPhotos: 1, maxPhotos: 2, minVideos: 0, maxVideos: 1 },
    ] }] } } });
    expect((await api(`/api/v1/qc/templates/${templateId}/publish`, { method: 'POST', token: qc })).status).toBe(201);
    const projectId = (await api<{ id: string }>('/api/v1/projects', { method: 'POST', token: admin, body: { code: `EV-${stamp}`, name: 'Evidence e2e' } })).body.id;
    const siteId = (await api<{ id: string }>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', token: admin, body: { siteCode: 'KOS121', name: 'KOS121' } })).body.id;
    const scope = { level: 'PROJECT', projectId };
    await api(`/api/v1/users/${engineerId}/projects`, { method: 'POST', token: admin, body: scope });
    let workOrderId = '';
    try {
      await sleep(1500); // scope replicates to project over NATS
      workOrderId = (await api<{ created: { id: string }[] }>('/api/v1/work-orders', { method: 'POST', token: admin, body: {
        projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: engineerId, plannedCompletionAt: '2026-12-31T18:14:59Z',
      } })).body.created[0]!.id;
      const checklist = await api<{ version: { id: string; sections: { items: { id: string }[] }[] } }>(`/api/v1/qc/tasks/${workOrderId}/checklist`, { token: engineer });
      const itemId = checklist.body.version.sections[0]!.items[0]!.id;
      const versionId = checklist.body.version.id;

      // Draft on the phone; the tablet must take over before it can save; the phone is then refused.
      const phone = { deviceId: 'phone-a', deviceLabel: 'Pixel 7' };
      const tablet = { deviceId: 'tab-b', deviceLabel: 'Galaxy Tab' };
      const saved = await api<{ version: number }>(`/api/v1/work-orders/${workOrderId}/draft`, { method: 'PUT', token: engineer, body: { ...phone, baseVersion: 0, responses: [{ itemId, selfCheckResult: 'PASS' }] } });
      expect(saved.status).toBe(200);
      expect((await api<{ status: string }>(`/api/v1/work-orders/${workOrderId}`, { token: admin })).body.status).toBe('ONGOING');
      const blocked = await api<{ error: { details: { reason: string } } }>(`/api/v1/work-orders/${workOrderId}/draft`, { method: 'PUT', token: engineer, body: { ...tablet, baseVersion: 1, responses: [] } });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.details.reason).toBe('DRAFT_HELD_ELSEWHERE');
      expect((await api(`/api/v1/work-orders/${workOrderId}/draft/takeover`, { method: 'POST', token: engineer, body: tablet })).status).toBe(200);
      const phoneLate = await api<{ error: { details: { reason: string } } }>(`/api/v1/work-orders/${workOrderId}/draft`, { method: 'PUT', token: engineer, body: { ...phone, baseVersion: 2, responses: [] } });
      expect(phoneLate.body.error.details.reason).toBe('DRAFT_HELD_ELSEWHERE');

      // Evidence: one photo and one video with its poster.
      const photo = await upload(workOrderId, itemId, 'PHOTO', ORANGE);
      const video = await upload(workOrderId, itemId, 'VIDEO', MP4, BLUE);
      await waitReady([photo, video]);

      const submit = (mediaIds: string[], deviceId: string) => api<{ id: string; attemptNo: number }>('/api/v1/qc/submissions', { method: 'POST', token: engineer, body: {
        taskId: workOrderId, siteId, projectId, templateVersionId: versionId, idempotencyKey: `e2e-${uuidv7()}`, deviceId,
        responses: [{ itemId, selfCheckResult: 'PASS', mediaIds }],
      } });
      // The phone no longer holds the draft.
      expect((await submit([photo, video], 'phone-a')).status).toBe(409);
      const first = await submit([photo, video], 'tab-b');
      expect(first.status).toBe(201);
      expect((await api(`/api/v1/work-orders/${workOrderId}/draft`, { token: engineer })).status).toBe(409); // REVIEWING: closed to drafts

      const review = (id: string, decision: string, result: string) => api(`/api/v1/qc/submissions/${id}/review`, { method: 'POST', token: qc, body: { decision, comment: 'e2e', itemReviews: [{ itemId, result }] } });
      await review(first.body.id, 'REJECT_REWORK', 'REJECTED');

      // Rework: the draft is pre-filled with the same files; replace the photo, keep the video.
      const prefill = await api<{ version: number; responses: { mediaIds: string[] }[] }>(`/api/v1/work-orders/${workOrderId}/draft`, { token: engineer });
      expect(prefill.body.version).toBe(0);
      expect(prefill.body.responses[0]!.mediaIds).toEqual([photo, video]);
      const newPhoto = await upload(workOrderId, itemId, 'PHOTO', BLUE);
      await waitReady([newPhoto]);
      const second = await submit([newPhoto, video], 'any-device');
      expect(second.status).toBe(201);
      expect(second.body.attemptNo).toBe(2);
      await review(second.body.id, 'APPROVE', 'APPROVED');

      type Detail = { responses: { media: { mediaId: string; kind: string; sequence: number }[] }[] };
      const firstDetail = await api<Detail>(`/api/v1/qc/submissions/${first.body.id}`, { token: qc });
      const secondDetail = await api<Detail>(`/api/v1/qc/submissions/${second.body.id}`, { token: qc });
      expect(firstDetail.body.responses[0]!.media.map((m) => [m.mediaId, m.kind])).toEqual([[photo, 'PHOTO'], [video, 'VIDEO']]);
      expect(secondDetail.body.responses[0]!.media.map((m) => [m.mediaId, m.kind])).toEqual([[newPhoto, 'PHOTO'], [video, 'VIDEO']]);

      // Reviewers can open the files.
      const link = await api<{ signedUrl: string }>(`/api/v1/media/${video}/url?variant=thumbnail`, { token: qc });
      expect(link.status).toBe(200);
      expect((await fetch(link.body.signedUrl)).status).toBe(200);

      const events = (await api<{ events: { kind: string }[] }>(`/api/v1/work-orders/${workOrderId}`, { token: admin })).body.events.map((e) => e.kind);
      expect(events).toEqual(['CREATED', 'STARTED', 'SUBMITTED', 'REJECTED', 'SUBMITTED', 'APPROVED']);
    } finally {
      await api(`/api/v1/users/${engineerId}/projects`, { method: 'DELETE', token: admin, body: scope });
    }
  }, 120_000);

  it('refuses unknown evidence with MEDIA_NOT_READY, naming the file', async () => {
    const stamp = Date.now();
    const templateId = (await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code: `EVX-${stamp}`, name: 'E2E evidence refusal', category: 'QUALITY' } })).body.templateId;
    await api(`/api/v1/qc/templates/${templateId}/draft`, { method: 'PUT', token: qc, body: { revision: 1, document: { sections: [{ number: '1', title: 'Install', items: [{ number: '1.1', requirementText: 'Label', minPhotos: 1, maxPhotos: 1 }] }] } } });
    await api(`/api/v1/qc/templates/${templateId}/publish`, { method: 'POST', token: qc });
    const projectId = (await api<{ id: string }>('/api/v1/projects', { method: 'POST', token: admin, body: { code: `EVX-${stamp}`, name: 'Evidence refusal' } })).body.id;
    const siteId = (await api<{ id: string }>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', token: admin, body: { siteCode: 'KOS122', name: 'KOS122' } })).body.id;
    const scope = { level: 'PROJECT', projectId };
    await api(`/api/v1/users/${engineerId}/projects`, { method: 'POST', token: admin, body: scope });
    try {
      await sleep(1500);
      const workOrderId = (await api<{ created: { id: string }[] }>('/api/v1/work-orders', { method: 'POST', token: admin, body: {
        projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: engineerId, plannedCompletionAt: '2026-12-31T18:14:59Z',
      } })).body.created[0]!.id;
      const checklist = await api<{ version: { id: string; sections: { items: { id: string }[] }[] } }>(`/api/v1/qc/tasks/${workOrderId}/checklist`, { token: engineer });
      const unknown = uuidv7();
      const refused = await api<{ error: { code: string; details: { reason: string; files: { id: string; reason: string }[] } } }>('/api/v1/qc/submissions', { method: 'POST', token: engineer, body: {
        taskId: workOrderId, siteId, projectId, templateVersionId: checklist.body.version.id, idempotencyKey: `e2e-${uuidv7()}`,
        responses: [{ itemId: checklist.body.version.sections[0]!.items[0]!.id, selfCheckResult: 'PASS', mediaIds: [unknown] }],
      } });
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'MEDIA_NOT_READY', files: [{ id: unknown, reason: 'NOT_FOUND' }] } });
      await api(`/api/v1/work-orders/${workOrderId}/cancel`, { method: 'POST', token: admin, body: { reason: 'e2e cleanup' } });
    } finally {
      await api(`/api/v1/users/${engineerId}/projects`, { method: 'DELETE', token: admin, body: scope });
    }
  }, 90_000);
});
```

Note: the approved work order is left `COMPLETED` (evidence of record stays); only the scope grant is handed back, as `work-orders.e2e.spec.ts` does.

- [ ] **Step 3: Run the stack and the e2e suite**

```bash
docker compose -f docker/docker-compose.yml up -d --build
pnpm --filter e2e e2e
```

Expected: all e2e files PASS (media runs against whatever `docker/env/media.secrets.env` points at — R2 staging locally).

- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "test(e2e): QC evidence — drafts, handover, photo+video submit, rework reuse, review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs, spec amendments, full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-qc-evidence-design.md` (§11 gains R1–R5)
- Modify: `docker/env/README.md` (qc row mentions `MEDIA_INTERNAL_URL`)

- [ ] **Step 1: Record the refinements**

Append to the spec's §11:

```markdown
- **Planning refinements (2026-09-30):**
  - R1: the specific refusal code is `error.details.reason` (the envelope `code` stays the shared enum, e.g. `CONFLICT`). The shared exception filter passes `details` through.
  - R2: the web serves evidence through `GET /api/media/:id/:variant`, which signs a fresh link and redirects on every request, instead of retrying expired links in the browser.
  - R3: the web template editor has Min/Max videos inputs.
  - R4: a lost race on `(taskId, attemptNo)` returns 409, not 500.
  - R5: qc does not `depends_on` media in compose; submits with files answer 503 while media is down.
```

In `docker/env/README.md`, the QC Service row's description becomes `Quality Control inspections and checklists service + migrations. Calls media at submit (MEDIA_INTERNAL_URL).`

- [ ] **Step 2: Full verification**

```bash
pnpm --filter @ipms/contracts test && pnpm --filter @ipms/observability test
pnpm --filter media typecheck && pnpm --filter media test
pnpm --filter qc typecheck && pnpm --filter qc test
pnpm --filter web test && pnpm --filter web exec tsc --noEmit
pnpm --filter gateway test
pnpm --filter e2e e2e
```

Expected: everything PASS. Record the counts in `.git/sdd/progress.md`.

- [ ] **Step 3: Commit**

```bash
git add docs docker/env/README.md
git commit -m "docs(qc): record QC evidence planning refinements

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
