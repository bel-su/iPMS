# Notification Service — In-App QC Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `notification` deliver in-app notifications for QC submissions (reviewers on submit, engineer on approve/reject), with a read API and a web bell backed by real data.

**Architecture:** `qc` enriches its two existing submission events. `notification` consumes them through two durables, resolves reviewers by calling a new key-guarded IAM endpoint that reuses `check()`, and writes one idempotent row per recipient. The web bell polls through Next route handlers that proxy the gateway.

**Tech Stack:** NestJS 12 + Fastify, Prisma 7 (per-service client), NATS JetStream via `@ipms/events`, zod 4 contracts, Next 16 / React 19, vitest 4, pnpm + nx.

**Spec:** `docs/superpowers/specs/2026-10-02-notification-service-design.md`. Task 1 amends it where this plan found the spec wrong (see the "Spec corrections" note).

## Global Constraints

- Node `>=22.13.0`, pnpm `10.15.0`. TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; relative imports in services end in `.js`.
- `@ipms/contracts` and `@ipms/events` are consumed by services as **built packages** (`dist`). After changing either, run `pnpm --filter @ipms/contracts build && pnpm --filter @ipms/events build` before running another package's tests or typecheck.
- Every Nest service is provided through a factory with an explicit `inject` list. A constructor parameter typed with an `import type` is erased by `emitDecoratorMetadata`, and Nest then cannot resolve it at bootstrap. Never provide such a class bare.
- Business routes sit under the `api/v1` global prefix. The gateway prefix `/api/v1/notifications` already routes to `notification`; the gateway refuses every `/internal/` path.
- Controller paths: `notifications`, `notifications/unread-count`, `notifications/:id/read`, `notifications/read-all`. IAM: `internal/authz/holders`.
- Durable names, exactly: `notification-submission-submitted`, `notification-submission-reviewed`.
- Notification `type` values, exactly: `QC_SUBMISSION_SUBMITTED`, `QC_SUBMISSION_APPROVED`, `QC_SUBMISSION_REJECTED`. `actionUrl` is `/quality/work-orders/<workOrderId>`.
- Idempotency: unique `(recipientId, eventId)`, writes use `createMany({ skipDuplicates: true })`.
- Reviewer permission checked through IAM: `qc_review.approve`.
- Service credential: request header `x-internal-key`, env var `INTERNAL_SERVICE_KEY`. IAM refuses to start in `NODE_ENV=production` without it; with it unset elsewhere the IAM endpoint refuses every call.
- No new permission codes. Notification routes are authenticated and own-data-only: every query filters by `recipientId` = the JWT subject.
- List: `limit` default 20, max 50. Web polls `GET /notifications/unread-count` every 30 s while the tab is visible.
- Out of scope: FCM push, email, `DevicePushToken` endpoints, websockets, preferences, `project.*` and `media.*` events, mobile app, notification retention.
- Commits end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (shown below as a second `-m`).

## Spec corrections found while planning

1. `eventId` on `Notification` is **nullable**, not `NOT NULL`. `docker/seed-notification.sql` inserts rows without one, and Postgres treats NULLs as distinct in a unique index, so legacy and seeded rows are unaffected.
2. The event payloads also gain `workOrderTitle` and `siteCode`. Without them every reviewer notification would read identically.
3. A `qc` event published before this change lacks the new fields (the stream keeps events for 7 days). Retrying cannot fix that, so the consumer logs and acks it instead of retrying into the DLQ.
4. `notification` needs `GlobalExceptionFilter` in `main.ts`, or a zod validation failure becomes a 500.

## File Structure

| File | Responsibility |
|---|---|
| `libs/contracts/src/notification/notification.ts` | Wire types and query schema for the notification API |
| `libs/contracts/src/iam/holders.ts` | Request/response schemas for the IAM holders lookup |
| `libs/events/src/payloads/qc.ts`, `subjects.ts` | Enriched QC payloads; durable names |
| `apps/qc/src/submissions/submission.service.ts` | Fills the new payload fields |
| `apps/iam/src/internal/internal-key.guard.ts` | Constant-time shared-secret guard |
| `apps/iam/src/internal/internal-authz.controller.ts` | `POST /internal/authz/holders` |
| `apps/iam/src/effective/effective.service.ts` | `holders()` built on the shared `check()` |
| `apps/notification/prisma/...` | `eventId`, `workOrderId`, unique key |
| `apps/notification/src/notifications/cursor.ts` | Opaque `(createdAt, id)` cursor |
| `apps/notification/src/notifications/notification.service.ts` | Fan-out write, list, count, mark-read |
| `apps/notification/src/notifications/notification.controller.ts` | HTTP API |
| `apps/notification/src/http/current-user.ts` | Caller id from the verified token |
| `apps/notification/src/directory/iam-directory.client.ts` | Calls IAM holders |
| `apps/notification/src/events/content.ts` | Title/body/url per event |
| `apps/notification/src/events/qc-notification.consumer.ts` | The two durables |
| `apps/web/app/lib/notification-api.ts`, `app/api/notifications/**` | Server-side proxy to the gateway |
| `apps/web/app/components/notification-model.ts`, `notification-center.tsx` | Pure view model; the bell |
| `e2e/notifications.e2e.spec.ts` | Submit → notified → reject → notified |

---

### Task 1: Shared contracts, event payloads, durable names, spec corrections

**Files:**
- Create: `libs/contracts/src/notification/notification.ts`, `libs/contracts/src/notification/notification.spec.ts`
- Create: `libs/contracts/src/iam/holders.ts`, `libs/contracts/src/iam/holders.spec.ts`
- Modify: `libs/contracts/src/index.ts`
- Modify: `libs/events/src/payloads/qc.ts`, `libs/events/src/subjects.ts`, `libs/events/src/subjects.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-02-notification-service-design.md`

**Interfaces:**
- Produces (contracts): `NotificationDto`, `NotificationPage`, `UnreadCount`, `ListNotificationsQuery`, `ListNotificationsQuerySchema`, `NotificationIdSchema`, `HoldersRequestSchema`, `HoldersRequest`, `HoldersResultSchema`, `HoldersResult`.
- Produces (events): `QcSubmissionSubmitted` and `QcSubmissionReviewed` with the new fields; `STREAMS.QC.durableConsumers` containing both notification durables.

- [ ] **Step 1: Create the working branch**

```bash
git checkout -b kedar/notification-service
```

- [ ] **Step 2: Write the failing contract tests**

`libs/contracts/src/notification/notification.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ListNotificationsQuerySchema, NotificationIdSchema } from './notification.js';

describe('ListNotificationsQuerySchema', () => {
  it('defaults to 20 items, read and unread', () => {
    expect(ListNotificationsQuerySchema.parse({})).toEqual({ limit: 20, unreadOnly: false });
  });

  it('coerces a query string', () => {
    expect(ListNotificationsQuerySchema.parse({ limit: '5', unreadOnly: 'true', cursor: 'abc' }))
      .toEqual({ limit: 5, unreadOnly: true, cursor: 'abc' });
  });

  it('refuses a limit above 50', () => {
    expect(() => ListNotificationsQuerySchema.parse({ limit: '51' })).toThrow();
  });

  it('refuses unreadOnly values other than true or false', () => {
    expect(() => ListNotificationsQuerySchema.parse({ unreadOnly: 'yes' })).toThrow();
  });
});

describe('NotificationIdSchema', () => {
  it('accepts any UUID shape, including non-v7 ids from seed data', () => {
    expect(NotificationIdSchema.safeParse('77777777-1111-1111-1111-111111111111').success).toBe(true);
  });

  it('refuses anything else', () => {
    expect(NotificationIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
```

`libs/contracts/src/iam/holders.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../common/ids.js';
import { HoldersRequestSchema, HoldersResultSchema } from './holders.js';

describe('HoldersRequestSchema', () => {
  it('accepts a permission and a project id', () => {
    const projectId = uuidv7();
    expect(HoldersRequestSchema.parse({ permission: 'qc_review.approve', projectId })).toEqual({ permission: 'qc_review.approve', projectId });
  });

  it('refuses an empty permission or a bad project id', () => {
    expect(() => HoldersRequestSchema.parse({ permission: '', projectId: uuidv7() })).toThrow();
    expect(() => HoldersRequestSchema.parse({ permission: 'x', projectId: 'nope' })).toThrow();
  });
});

describe('HoldersResultSchema', () => {
  it('requires an array of strings', () => {
    expect(HoldersResultSchema.parse({ userIds: ['a'] })).toEqual({ userIds: ['a'] });
    expect(() => HoldersResultSchema.parse({ userIds: 'a' })).toThrow();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @ipms/contracts test`
Expected: FAIL — `Cannot find module './notification.js'` and `'./holders.js'`.

- [ ] **Step 4: Implement the contracts**

`libs/contracts/src/notification/notification.ts`:

```ts
import { z } from 'zod';

export const NOTIFICATION_TYPES = [
  'QC_SUBMISSION_SUBMITTED',
  'QC_SUBMISSION_APPROVED',
  'QC_SUBMISSION_REJECTED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * `type` is a plain string, not `NotificationType`: the column is a varchar and
 * seeded or future rows carry types this slice does not emit.
 */
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  workOrderId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationDto[];
  nextCursor: string | null;
}

export interface UnreadCount {
  count: number;
}

export const ListNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(200).optional(),
  unreadOnly: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

/**
 * Any UUID shape, not `UuidSchema`: that one demands v7, and ids in seeded
 * environments are not.
 */
export const NotificationIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Invalid id',
);
```

`libs/contracts/src/iam/holders.ts`:

```ts
import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

/** Who holds `permission` with reach to `projectId`, for service-to-service callers with no user token. */
export const HoldersRequestSchema = z.object({
  permission: z.string().min(1).max(100),
  projectId: UuidSchema,
});
export type HoldersRequest = z.infer<typeof HoldersRequestSchema>;

export const HoldersResultSchema = z.object({ userIds: z.array(z.string()) });
export type HoldersResult = z.infer<typeof HoldersResultSchema>;
```

In `libs/contracts/src/index.ts`, add after the `iam/user.js` line and at the end:

```ts
export * from './iam/holders.js';
```
```ts
export * from './notification/notification.js';
```

- [ ] **Step 5: Run the contract tests**

Run: `pnpm --filter @ipms/contracts test`
Expected: PASS.

- [ ] **Step 6: Write the failing events tests**

In `libs/events/src/subjects.spec.ts`, replace the test `'gives media its own durable for cancelled work orders'` and the whole `describe('QC stream', ...)` block with:

```ts
  it('gives media its own durable for cancelled work orders', () => {
    expect(SUBJECTS.QC_WORK_ORDER_CANCELLED).toBe('qc.work_order.cancelled');
    expect(STREAMS.QC.durableConsumers).toContain('media-work-order-cancelled');
  });

  it('gives notification one durable per submission subject', () => {
    // One filter_subject per durable, as for the IAM stream above.
    expect(STREAMS.QC.durableConsumers).toContain('notification-submission-submitted');
    expect(STREAMS.QC.durableConsumers).toContain('notification-submission-reviewed');
  });

  it('no longer declares the unused qc-scope-cache placeholder', () => {
    expect(STREAMS.IAM.durableConsumers).not.toContain('qc-scope-cache');
  });
});

describe('QC stream', () => {
  it('carries every qc subject', () => {
    expect(STREAMS.QC.subjects).toEqual(['qc.>']);
  });
});
```

(The first line of the replaced `it` is inside the existing `describe('durable naming', ...)`; the `});` after `no longer declares…` closes that describe.)

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm --filter @ipms/events exec vitest run src/subjects.spec.ts`
Expected: FAIL — durable names missing from `STREAMS.QC` and `qc-scope-cache` still present.

- [ ] **Step 8: Implement the events changes**

`libs/events/src/payloads/qc.ts` — replace the two interfaces:

```ts
export interface QcSubmissionSubmitted {
  submissionId: string;
  taskId: string;
  /** The work order's id; the same value as `taskId`, named for what consumers mean by it. */
  workOrderId: string;
  workOrderTitle: string;
  projectId: string;
  siteId: string;
  siteCode: string;
  attemptNo: number;
  submittedBy: string;
  submittedAt: string;
}

export interface QcSubmissionReviewed {
  submissionId: string;
  taskId: string;
  workOrderId: string;
  workOrderTitle: string;
  projectId: string;
  siteId: string;
  siteCode: string;
  attemptNo: number;
  /** Who submitted the work being reviewed: the person to tell about the decision. */
  submittedBy: string;
  decision: 'APPROVE' | 'REJECT_REWORK';
  reviewedBy: string;
  reviewedAt: string;
  comment: string | null;
}
```

`libs/events/src/subjects.ts`: in `STREAMS.IAM.durableConsumers` remove `'qc-scope-cache'` (leave the three `project-scope-*` names). Replace the `QC` entry's comment and consumers:

```ts
    // media hears of cancelled work orders so it can release their unsubmitted
    // evidence; notification has one durable per submission subject (a durable
    // carries a single filter_subject, see the note on IAM above).
    durableConsumers: [
      'media-work-order-cancelled',
      'notification-submission-submitted',
      'notification-submission-reviewed',
    ],
```

- [ ] **Step 9: Build and run the events tests**

Run: `pnpm --filter @ipms/contracts build && pnpm --filter @ipms/events test`
Expected: PASS. (`bus.integration.spec.ts` needs NATS; if it errors for lack of a broker, run `pnpm --filter @ipms/events exec vitest run src/subjects.spec.ts src/envelope.spec.ts src/dedupe.spec.ts` instead and say so in the commit body.)

- [ ] **Step 10: Confirm nothing else referenced the removed placeholder**

Run: `grep -rn "qc-scope-cache" apps libs docs --include='*.ts' --include='*.md' | grep -v node_modules | grep -v dist`
Expected: only mentions in the spec and this plan.

- [ ] **Step 11: Correct the spec**

In `docs/superpowers/specs/2026-10-02-notification-service-design.md`:

Replace

```
- `QcSubmissionSubmitted` gains `workOrderId: string` and `siteId: string`.
- `QcSubmissionReviewed` gains `submittedBy: string`, `workOrderId: string`, `siteId: string`.
```

with

```
- `QcSubmissionSubmitted` gains `workOrderId`, `workOrderTitle`, `siteId`, `siteCode`.
- `QcSubmissionReviewed` gains `submittedBy`, `workOrderId`, `workOrderTitle`, `siteId`, `siteCode`.

The title and site code let a reviewer tell notifications apart. Events published before
this change lack the fields; the consumer logs and acknowledges them rather than retrying
(§4.2).
```

Replace

```
- `eventId String @db.Uuid` — the envelope's `eventId`;
```

with

```
- `eventId String? @db.Uuid` — the envelope's `eventId`. Nullable: seeded rows
  (`docker/seed-notification.sql`) have none, and Postgres treats NULLs as distinct in a
  unique index;
```

Replace the paragraph beginning `Existing rows: none in any environment` (through `needs no backfill.`) with:

```
Existing rows: seeded development rows keep a NULL `eventId` and are unaffected by the unique key.
```

Replace `- Malformed payload (missing recipient fields) → throw; it is retried then DLQ'd.` with:

```
- Payload without the enrichment fields (an event published before this change) → log a
  warning and acknowledge; retrying cannot supply them.
```

- [ ] **Step 12: Commit**

```bash
git add libs/contracts libs/events docs/superpowers/specs/2026-10-02-notification-service-design.md docs/superpowers/plans/2026-10-02-notification-service.md
git commit -m "feat(events): enrich QC submission events; add notification contracts and durables" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `qc` publishes the enriched payloads

**Files:**
- Modify: `apps/qc/src/submissions/submission.service.ts` (the `fact` in `submit`, ~line 185; the review transaction, ~lines 224-243)
- Test: `apps/qc/src/submissions/submission.service.spec.ts`

**Interfaces:**
- Consumes: `QcSubmissionSubmitted`, `QcSubmissionReviewed` from Task 1.
- Produces: outbox rows whose `payload` carries `workOrderId`, `workOrderTitle`, `siteId`, `siteCode` (and `submittedBy` on review).

- [ ] **Step 1: Write the failing tests**

In the `describe('createSubmission validation', ...)` block, after the test `'counts photos and videos by the kinds media reports'`, add:

```ts
    it('publishes the work order and site labels the notification service needs', async () => {
      prisma.workOrder.findUnique.mockResolvedValue({
        id: taskId, assigneeId: actorId, status: 'ONGOING', projectId, siteId, templateId,
        title: 'Tower foundation check', siteCode: 'KOS121',
      });
      prisma.submission.create.mockResolvedValue({
        id: 'sub-1', taskId, projectId, siteId, attemptNo: 2, submittedAt: new Date('2026-10-02T08:00:00Z'),
      });
      prisma.itemResponse.create.mockResolvedValue({ id: 'resp-1' });
      await service.createSubmission(dtoWith([P(1)]) as any, actorId, 'Bearer t');
      const record = prisma.outboxEvent.create.mock.calls[0][0].data;
      expect(record.subject).toBe('qc.submission.submitted');
      expect(record.payload).toMatchObject({
        submissionId: 'sub-1', workOrderId: taskId, workOrderTitle: 'Tower foundation check',
        siteId, siteCode: 'KOS121', projectId, submittedBy: actorId, attemptNo: 2,
      });
    });
```

In `describe('reviewSubmission', ...)`, add a `submitter` constant next to the others:

```ts
    const submitter = '0192f7a0-0000-7000-8000-000000000006';
    const siteId = '0192f7a0-0000-7000-8000-000000000007';
```

and this test after `'looks the submission up within the caller’s scope'`:

```ts
    it('publishes who submitted the work and the labels the notification service needs', async () => {
      prisma.submission.update.mockResolvedValue({
        id: submissionId, status: 'REJECTED_REWORK', taskId, projectId, siteId, attemptNo: 2,
        submittedBy: submitter, reviewedAt: new Date('2026-10-02T09:00:00Z'),
      });
      prisma.workOrder.findUnique.mockResolvedValue({ id: taskId, title: 'Tower foundation check', siteCode: 'KOS121' });
      const dto = { decision: 'REJECT_REWORK' as const, comment: 'Photo is blurred', itemReviews: [{ itemId, result: 'REJECTED' as const }] };
      await service.reviewSubmission(submissionId, dto as any, actorId, scope);
      const record = prisma.outboxEvent.create.mock.calls[0][0].data;
      expect(record.subject).toBe('qc.submission.reviewed');
      expect(record.payload).toMatchObject({
        submissionId, workOrderId: taskId, workOrderTitle: 'Tower foundation check', siteId, siteCode: 'KOS121',
        submittedBy: submitter, decision: 'REJECT_REWORK', reviewedBy: actorId, comment: 'Photo is blurred',
      });
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter qc exec vitest run src/submissions/submission.service.spec.ts -t "notification service needs"`
Expected: FAIL — `payload` lacks `workOrderId` / `workOrderTitle`.

- [ ] **Step 3: Implement the submit payload**

In `submission.service.ts`, replace the `fact` in `submit`:

```ts
        const fact: QcSubmissionSubmitted = {
          submissionId: submission.id, taskId: submission.taskId, projectId: submission.projectId,
          attemptNo: submission.attemptNo, submittedBy: actorId, submittedAt: submission.submittedAt!.toISOString(),
        };
```

with:

```ts
        const fact: QcSubmissionSubmitted = {
          submissionId: submission.id, taskId: submission.taskId, projectId: submission.projectId,
          workOrderId: task.id, workOrderTitle: task.title, siteId: task.siteId, siteCode: task.siteCode,
          attemptNo: submission.attemptNo, submittedBy: actorId, submittedAt: submission.submittedAt!.toISOString(),
        };
```

- [ ] **Step 4: Implement the review payload**

In `reviewSubmission`, replace

```ts
      const fact: QcSubmissionReviewed = {
        submissionId: reviewed.id, taskId: reviewed.taskId, projectId: reviewed.projectId, attemptNo: reviewed.attemptNo,
        decision: dto.decision, reviewedBy: actorId, reviewedAt: reviewed.reviewedAt!.toISOString(), comment: dto.comment ?? null,
      };
```

with (the work order is now read before the fact, and reused further down):

```ts
      const order = await tx.workOrder.findUnique({ where: { id: reviewed.taskId }, select: { id: true, title: true, siteCode: true } });
      const fact: QcSubmissionReviewed = {
        submissionId: reviewed.id, taskId: reviewed.taskId, projectId: reviewed.projectId, attemptNo: reviewed.attemptNo,
        workOrderId: reviewed.taskId, workOrderTitle: order?.title ?? '', siteId: reviewed.siteId, siteCode: order?.siteCode ?? '',
        submittedBy: reviewed.submittedBy,
        decision: dto.decision, reviewedBy: actorId, reviewedAt: reviewed.reviewedAt!.toISOString(), comment: dto.comment ?? null,
      };
```

and delete the later line `const order = await tx.workOrder.findUnique({ where: { id: reviewed.taskId }, select: { id: true } });` (the existing `if (order) { await event(...) }` that follows keeps working against the earlier `order`).

- [ ] **Step 5: Run the qc tests and typecheck**

Run: `pnpm --filter qc test && pnpm --filter qc typecheck`
Expected: PASS. If typecheck reports a missing `title`/`siteCode` on a test fixture, add them to that fixture; production code is unaffected.

- [ ] **Step 6: Commit**

```bash
git add apps/qc
git commit -m "feat(qc): publish work order, site and submitter on submission events" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: IAM holders lookup and internal key guard

**Files:**
- Create: `apps/iam/src/internal/internal-key.guard.ts`, `apps/iam/src/internal/internal-key.guard.spec.ts`
- Create: `apps/iam/src/internal/internal-authz.controller.ts`, `apps/iam/src/internal/internal-authz.controller.spec.ts`
- Create: `apps/iam/src/effective/effective.holders.spec.ts`
- Modify: `apps/iam/src/effective/effective.service.ts`
- Modify: `apps/iam/src/app.module.ts`, `apps/iam/src/app.module.spec.ts`

**Interfaces:**
- Consumes: `HoldersRequestSchema`, `HoldersResult` (Task 1).
- Produces: `EffectiveService.holders(permission: string, projectId: string): Promise<string[]>`; `InternalKeyGuard`; `INTERNAL_KEY_HEADER = 'x-internal-key'`; `POST /api/v1/internal/authz/holders` returning `{ userIds: string[] }`.

- [ ] **Step 1: Write the failing `holders` tests**

`apps/iam/src/effective/effective.holders.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@ipms/contracts';
import { EffectiveService } from './effective.service.js';

const PROJECT = uuidv7();
const OTHER_PROJECT = uuidv7();
const PERMISSION = 'qc_review.approve';
const PAST = new Date('2026-01-01T00:00:00Z');

interface UserOptions {
  id?: string;
  isActive?: boolean;
  permissions?: string[];
  roleActive?: boolean;
  validUntil?: Date | null;
  projectIds?: string[];
  global?: boolean;
  overrides?: unknown[];
}

function user(opts: UserOptions = {}) {
  return {
    id: opts.id ?? uuidv7(),
    isActive: opts.isActive ?? true,
    tokenVersion: 0,
    roles: [{
      role: {
        code: 'QC_MANAGER',
        isActive: opts.roleActive ?? true,
        permissions: (opts.permissions ?? [PERMISSION]).map((code) => ({ permission: { code } })),
      },
      validFrom: null,
      validUntil: opts.validUntil ?? null,
    }],
    globalScopes: opts.global ? [{ id: 'g' }] : [],
    projectScopes: (opts.projectIds ?? [PROJECT]).map((projectId) => ({ projectId })),
    siteScopes: [],
    overrides: opts.overrides ?? [],
  };
}

function build(users: unknown[]) {
  const prisma = { user: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue(users) } };
  return { service: new EffectiveService(prisma as never), prisma };
}

describe('EffectiveService.holders', () => {
  it('asks only for active users', async () => {
    const { service, prisma } = build([]);
    await service.holders(PERMISSION, PROJECT);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });

  it('includes a project-scoped user holding the permission for that project', async () => {
    const holder = user();
    const { service } = build([holder]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([holder.id]);
  });

  it('excludes a user whose scope is a different project', async () => {
    const { service } = build([user({ projectIds: [OTHER_PROJECT] })]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });

  it('includes a user with global scope', async () => {
    const holder = user({ global: true, projectIds: [] });
    const { service } = build([holder]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([holder.id]);
  });

  it('excludes a user without the permission', async () => {
    const { service } = build([user({ permissions: ['task.view'] })]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });

  it('excludes an expired role assignment and an inactive role', async () => {
    const { service } = build([user({ validUntil: PAST }), user({ roleActive: false })]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });

  it('excludes a user with a live DENY override', async () => {
    const denied = user({
      overrides: [{
        permission: { code: PERMISSION }, effect: 'DENY', projectId: null, siteId: null,
        validFrom: null, validUntil: null, reason: 'suspended',
      }],
    });
    const { service } = build([denied]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });

  it('excludes a deactivated user even if one reaches this method', async () => {
    const { service } = build([user({ isActive: false })]);
    expect(await service.holders(PERMISSION, PROJECT)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter iam exec vitest run src/effective/effective.holders.spec.ts`
Expected: FAIL — `service.holders is not a function`.

- [ ] **Step 3: Implement `holders` on `EffectiveService`**

In `apps/iam/src/effective/effective.service.ts`, add above the `LoadedUser` interface:

```ts
/** Everything `check()` needs about one user; shared by `load` and `holders`. */
const USER_INCLUDE = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  globalScopes: true,
  projectScopes: true,
  siteScopes: true,
  overrides: { include: { permission: true } },
} as const;
```

In `load`, replace the whole `include: { ... }` object with `include: USER_INCLUDE,` so it reads:

```ts
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: USER_INCLUDE,
    });
```

Add this method after `simulate`:

```ts
  /**
   * Users who hold `permission` with reach to `projectId`, for callers that act
   * on an event rather than a user's request and so have no token to forward.
   *
   * Runs the shared `check()` with the project as the resource, exactly as the
   * owning endpoint would, so "who may review" cannot drift from what review
   * enforces. Global-scope users pass the project gate; a user with only site
   * scopes does not, because `check()` decides that, not this method.
   *
   * Loads every active user with their relations. Fine while that is tens or
   * hundreds; if it grows into the thousands, narrow the query by role first.
   */
  async holders(permission: string, projectId: string): Promise<string[]> {
    const now = new Date();
    const users = (await this.prisma.user.findMany({
      where: { isActive: true },
      include: USER_INCLUDE,
    })) as unknown as LoadedUser[];
    return users
      .filter((user) => check({
        user: this.toAuthzUser(user, now),
        permission,
        resource: { type: 'PROJECT', id: projectId, projectId },
        scope: this.toScope(user),
        overrides: this.toOverrides(user, now),
        now,
      }).allowed)
      .map((user) => user.id);
  }
```

- [ ] **Step 4: Run to verify it passes (and the old spec still does)**

Run: `pnpm --filter iam exec vitest run src/effective`
Expected: PASS for both `effective.holders.spec.ts` and `effective.service.spec.ts`.

- [ ] **Step 5: Write the failing guard tests**

`apps/iam/src/internal/internal-key.guard.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InternalKeyGuard } from './internal-key.guard.js';

function context(headers: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as never;
}

afterEach(() => vi.unstubAllEnvs());

describe('InternalKeyGuard', () => {
  it('accepts the configured key', () => {
    vi.stubEnv('INTERNAL_SERVICE_KEY', 'k-123');
    expect(new InternalKeyGuard().canActivate(context({ 'x-internal-key': 'k-123' }))).toBe(true);
  });

  it('refuses a missing, wrong or repeated header', () => {
    vi.stubEnv('INTERNAL_SERVICE_KEY', 'k-123');
    const guard = new InternalKeyGuard();
    expect(() => guard.canActivate(context({}))).toThrow('Authentication required');
    expect(() => guard.canActivate(context({ 'x-internal-key': 'k-124' }))).toThrow('Authentication required');
    expect(() => guard.canActivate(context({ 'x-internal-key': ['k-123', 'k-123'] }))).toThrow('Authentication required');
  });

  it('refuses everything when no key is configured outside production', () => {
    vi.stubEnv('INTERNAL_SERVICE_KEY', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => new InternalKeyGuard().canActivate(context({ 'x-internal-key': '' }))).toThrow('Authentication required');
  });

  it('refuses to start in production without a key', () => {
    vi.stubEnv('INTERNAL_SERVICE_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new InternalKeyGuard()).toThrow('INTERNAL_SERVICE_KEY is not set');
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter iam exec vitest run src/internal/internal-key.guard.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the guard**

`apps/iam/src/internal/internal-key.guard.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

export const INTERNAL_KEY_HEADER = 'x-internal-key';

/** Hashing first makes the comparison constant-length, so `timingSafeEqual` never throws on a length mismatch. */
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Authenticates service-to-service calls that have no user token to forward,
 * such as an event consumer asking who may review a project.
 *
 * Fails closed: with no key configured it refuses every call, and in
 * production it refuses to start. The gateway already refuses every
 * `/internal/` path; this is the second lock, so a gateway regression does not
 * expose the endpoint.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly expected: Buffer | null;

  constructor() {
    const key = process.env['INTERNAL_SERVICE_KEY'];
    if (!key && process.env['NODE_ENV'] === 'production') throw new Error('INTERNAL_SERVICE_KEY is not set');
    this.expected = key ? digest(key) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const given = request.headers[INTERNAL_KEY_HEADER];
    if (this.expected === null || typeof given !== 'string' || !timingSafeEqual(digest(given), this.expected)) {
      throw new UnauthorizedException('Authentication required');
    }
    return true;
  }
}
```

- [ ] **Step 8: Write the failing controller tests**

`apps/iam/src/internal/internal-authz.controller.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { InternalAuthzController } from './internal-authz.controller.js';
import { InternalKeyGuard } from './internal-key.guard.js';

const reflectMetadata = Reflect as unknown as { getMetadata(key: string, target: object): unknown };

describe('InternalAuthzController', () => {
  it('returns the holders the service finds', async () => {
    const projectId = uuidv7();
    const effective = { holders: vi.fn().mockResolvedValue(['u-1', 'u-2']) };
    const controller = new InternalAuthzController(effective as never);
    expect(await controller.holders({ permission: 'qc_review.approve', projectId })).toEqual({ userIds: ['u-1', 'u-2'] });
    expect(effective.holders).toHaveBeenCalledWith('qc_review.approve', projectId);
  });

  it('refuses a malformed body', async () => {
    const controller = new InternalAuthzController({ holders: vi.fn() } as never);
    await expect(controller.holders({ permission: '', projectId: 'x' })).rejects.toThrow();
  });

  // Public bypasses the user-token guard; the key guard must be what stands in front of every route here.
  it('is public to the token guard but locked by the internal key guard', () => {
    expect(reflectMetadata.getMetadata(IS_PUBLIC_KEY, InternalAuthzController)).toBe(true);
    expect(reflectMetadata.getMetadata(GUARDS_METADATA, InternalAuthzController)).toContain(InternalKeyGuard);
  });
});
```

- [ ] **Step 9: Run to verify it fails**

Run: `pnpm --filter iam exec vitest run src/internal/internal-authz.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 10: Implement the controller**

`apps/iam/src/internal/internal-authz.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '@ipms/authz';
import { HoldersRequestSchema, type HoldersResult } from '@ipms/contracts';
import { EffectiveService } from '../effective/effective.service.js';
import { InternalKeyGuard } from './internal-key.guard.js';

/**
 * Service-to-service only: the gateway refuses every `/internal/` path.
 *
 * `@Public()` bypasses the user-token guard, because the caller is an event
 * consumer with no user; `@UseGuards(InternalKeyGuard)` replaces it. Both sit
 * on the class, so a route added here later cannot end up with neither.
 */
@Public()
@UseGuards(InternalKeyGuard)
@Controller('internal/authz')
export class InternalAuthzController {
  constructor(private readonly effective: EffectiveService) {}

  @Post('holders')
  @HttpCode(200)
  async holders(@Body() body: unknown): Promise<HoldersResult> {
    const { permission, projectId } = HoldersRequestSchema.parse(body);
    return { userIds: await this.effective.holders(permission, projectId) };
  }
}
```

- [ ] **Step 11: Register the controller and test the registration**

In `apps/iam/src/app.module.ts` add the import beside the other controller imports:

```ts
import { InternalAuthzController } from './internal/internal-authz.controller.js';
```

and append `InternalAuthzController` to the module's `controllers: [...]` array.

In `apps/iam/src/app.module.spec.ts`, add inside the `describe('AppModule guard registration', ...)` block:

```ts
  it('serves the internal holders lookup', () => {
    const controllers = reflectMetadata.getMetadata('controllers', AppModule) as unknown[];
    expect(controllers).toContain(InternalAuthzController);
  });
```

with `import { InternalAuthzController } from './internal/internal-authz.controller.js';` at the top.

- [ ] **Step 12: Run the whole IAM suite and typecheck**

Run: `pnpm --filter iam test && pnpm --filter iam typecheck`
Expected: PASS. (Integration specs that need Docker via testcontainers may be skipped or fail for lack of Docker; confirm failures are only those and note it.)

- [ ] **Step 13: Commit**

```bash
git add apps/iam
git commit -m "feat(iam): internal holders lookup guarded by a shared service key" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Notification schema, migration and dependency

**Files:**
- Modify: `apps/notification/prisma/schema.prisma`
- Create: `apps/notification/prisma/migrations/20261002000100_notification_event_key/migration.sql`
- Modify: `apps/notification/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: Prisma `Notification` with `eventId: string | null`, `workOrderId: string | null`, compound unique `recipientId_eventId`; `@ipms/events` available to the service.

- [ ] **Step 1: Edit the schema**

In `apps/notification/prisma/schema.prisma`, replace the `Notification` model with:

```prisma
model Notification {
  id String @id @db.Uuid
  recipientId String @db.Uuid
  // The envelope eventId that produced this row. Nullable because seeded rows
  // have none; Postgres treats NULLs as distinct in a unique index, so they never
  // collide. For real rows the unique key below is what makes a redelivered event
  // a no-op rather than a duplicate notification.
  eventId String? @db.Uuid
  type String @db.VarChar(50)
  title String @db.VarChar(250)
  body String
  actionUrl String? @db.VarChar(500)
  workOrderId String? @db.Uuid
  isRead Boolean @default(false)
  readAt DateTime? @db.Timestamptz(6)
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  @@unique([recipientId, eventId])
  // The only query the in-app notification list will ever issue.
  @@index([recipientId, isRead, createdAt])
  @@map("notification")
}
```

- [ ] **Step 2: Write the migration**

`apps/notification/prisma/migrations/20261002000100_notification_event_key/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "notification" ADD COLUMN "eventId" UUID,
ADD COLUMN "workOrderId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipientId_eventId_key" ON "notification"("recipientId", "eventId");
```

- [ ] **Step 3: Add the dependency and install**

In `apps/notification/package.json` `dependencies`, add (alphabetical, after `@ipms/contracts`):

```json
    "@ipms/events": "workspace:*",
```

Run: `pnpm install`
Expected: lockfile updated; no registry downloads beyond workspace linking.

- [ ] **Step 4: Validate and regenerate the client**

Run:

```bash
cd apps/notification && DATABASE_URL=postgresql://codegen:codegen@127.0.0.1:5432/codegen pnpm exec prisma validate && DATABASE_URL=postgresql://codegen:codegen@127.0.0.1:5432/codegen pnpm exec prisma generate && cd ../..
```

Expected: "The schema … is valid" and "Generated Prisma Client".

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter notification typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/notification/prisma apps/notification/package.json pnpm-lock.yaml
git commit -m "feat(notification): idempotency key and work order link on notifications" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `NotificationService` (write, list, count, mark read)

**Files:**
- Create: `apps/notification/src/notifications/cursor.ts`, `apps/notification/src/notifications/cursor.spec.ts`
- Create: `apps/notification/src/notifications/notification.service.ts`, `apps/notification/src/notifications/notification.service.spec.ts`

**Interfaces:**
- Consumes: Prisma `Notification` (Task 4); `NotificationDto`, `NotificationPage`, `NotificationIdSchema` (Task 1).
- Produces:
  - `encodeCursor(row: { createdAt: Date; id: string }): string`, `decodeCursor(value: string): { createdAt: Date; id: string }` (throws `BadRequestException('Invalid cursor')`).
  - `class NotificationService` with `constructor(prisma: PrismaClient)` and
    `createMany(items: NewNotification[]): Promise<number>`,
    `list(recipientId: string, q: { limit: number; cursor?: string | undefined; unreadOnly: boolean }): Promise<NotificationPage>`,
    `unreadCount(recipientId: string): Promise<number>`,
    `markRead(recipientId: string, id: string): Promise<void>` (throws `NotFoundException`),
    `markAllRead(recipientId: string): Promise<number>`.
  - `interface NewNotification { recipientId: string; eventId: string; type: string; title: string; body: string; actionUrl: string; workOrderId: string }`.

- [ ] **Step 1: Write the failing cursor tests**

`apps/notification/src/notifications/cursor.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const ROW = { createdAt: new Date('2026-10-02T08:00:00.123Z'), id: '0192f7a0-0000-7000-8000-000000000001' };

describe('cursor', () => {
  it('round-trips a row position', () => {
    expect(decodeCursor(encodeCursor(ROW))).toEqual(ROW);
  });

  it('refuses garbage, a bad timestamp and a bad id', () => {
    const forge = (text: string) => Buffer.from(text).toString('base64url');
    expect(() => decodeCursor('%%%')).toThrow('Invalid cursor');
    expect(() => decodeCursor(forge('not-a-date|' + ROW.id))).toThrow('Invalid cursor');
    expect(() => decodeCursor(forge(ROW.createdAt.toISOString() + '|nope'))).toThrow('Invalid cursor');
    expect(() => decodeCursor(forge(`${ROW.createdAt.toISOString()}|${ROW.id}|extra`))).toThrow('Invalid cursor');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter notification exec vitest run src/notifications/cursor.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the cursor**

`apps/notification/src/notifications/cursor.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { NotificationIdSchema } from '@ipms/contracts';

export interface Cursor {
  createdAt: Date;
  id: string;
}

/** Opaque to clients: `createdAt|id`, base64url. Both halves are validated on the way back in. */
export function encodeCursor(row: Cursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

export function decodeCursor(value: string): Cursor {
  const [iso, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  const valid = rest.length === 0
    && id !== undefined
    && NotificationIdSchema.safeParse(id).success
    && !Number.isNaN(createdAt.getTime())
    // Round-trip check: `new Date('2026')` parses, and must not be accepted as a position.
    && createdAt.toISOString() === iso;
  if (!valid) throw new BadRequestException('Invalid cursor');
  return { createdAt, id: id as string };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter notification exec vitest run src/notifications/cursor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing service tests**

`apps/notification/src/notifications/notification.service.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { NotificationService, type NewNotification } from './notification.service.js';
import { encodeCursor } from './cursor.js';

const ME = '0192f7a0-0000-7000-8000-0000000000aa';

function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `0192f7a0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`,
    recipientId: ME, eventId: null, type: 'QC_SUBMISSION_SUBMITTED', title: `t${n}`, body: `b${n}`,
    actionUrl: '/quality/work-orders/x', workOrderId: null, isRead: false, readAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 2, 8, 0, 60 - n)), ...extra,
  };
}

function build() {
  const prisma = {
    notification: {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(3),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { service: new NotificationService(prisma as never), prisma };
}

const NEW: NewNotification = {
  recipientId: ME, eventId: '0192f7a0-0000-7000-8000-0000000000e1', type: 'QC_SUBMISSION_SUBMITTED',
  title: 'T', body: 'B', actionUrl: '/quality/work-orders/w', workOrderId: '0192f7a0-0000-7000-8000-0000000000b1',
};

describe('NotificationService.createMany', () => {
  it('writes one row per recipient, skipping duplicates, and returns how many were new', async () => {
    const { service, prisma } = build();
    const count = await service.createMany([NEW, { ...NEW, recipientId: '0192f7a0-0000-7000-8000-0000000000ab' }]);
    expect(count).toBe(2);
    const arg = prisma.notification.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(2);
    expect(arg.data[0]).toMatchObject({ recipientId: ME, eventId: NEW.eventId, type: NEW.type, workOrderId: NEW.workOrderId });
    expect(new Set(arg.data.map((d: { id: string }) => d.id)).size).toBe(2);
  });

  it('does nothing for an empty list', async () => {
    const { service, prisma } = build();
    expect(await service.createMany([])).toBe(0);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });
});

describe('NotificationService.list', () => {
  it('only ever asks for the caller’s own rows, newest first', async () => {
    const { service, prisma } = build();
    await service.list(ME, { limit: 20, unreadOnly: false });
    const arg = prisma.notification.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ recipientId: ME });
    expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(arg.take).toBe(21);
  });

  it('narrows to unread when asked', async () => {
    const { service, prisma } = build();
    await service.list(ME, { limit: 20, unreadOnly: true });
    expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({ recipientId: ME, isRead: false });
  });

  it('continues from a cursor without dropping rows that share a timestamp', async () => {
    const { service, prisma } = build();
    const last = row(5);
    await service.list(ME, { limit: 20, unreadOnly: false, cursor: encodeCursor(last) });
    expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({
      recipientId: ME,
      OR: [{ createdAt: { lt: last.createdAt } }, { createdAt: last.createdAt, id: { lt: last.id } }],
    });
  });

  it('returns a next cursor only when a further page exists, and never the extra row', async () => {
    const { service, prisma } = build();
    prisma.notification.findMany.mockResolvedValue([row(1), row(2), row(3)]);
    const page = await service.list(ME, { limit: 2, unreadOnly: false });
    expect(page.items.map((i) => i.title)).toEqual(['t1', 't2']);
    expect(page.nextCursor).toBe(encodeCursor(row(2)));

    prisma.notification.findMany.mockResolvedValue([row(1)]);
    expect((await service.list(ME, { limit: 2, unreadOnly: false })).nextCursor).toBeNull();
  });

  it('shapes rows for the wire', async () => {
    const { service, prisma } = build();
    prisma.notification.findMany.mockResolvedValue([row(1)]);
    const [item] = (await service.list(ME, { limit: 20, unreadOnly: false })).items;
    expect(item).toEqual({
      id: row(1).id, type: 'QC_SUBMISSION_SUBMITTED', title: 't1', body: 'b1', actionUrl: '/quality/work-orders/x',
      workOrderId: null, isRead: false, createdAt: row(1).createdAt.toISOString(),
    });
  });
});

describe('NotificationService read state', () => {
  it('counts only the caller’s unread rows', async () => {
    const { service, prisma } = build();
    expect(await service.unreadCount(ME)).toBe(3);
    expect(prisma.notification.count).toHaveBeenCalledWith({ where: { recipientId: ME, isRead: false } });
  });

  it('marks one row read, scoped to its recipient', async () => {
    const { service, prisma } = build();
    await service.markRead(ME, row(1).id);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: row(1).id, recipientId: ME, isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });

  it('treats an already-read row as success', async () => {
    const { service, prisma } = build();
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.findFirst.mockResolvedValue({ id: row(1).id });
    await expect(service.markRead(ME, row(1).id)).resolves.toBeUndefined();
  });

  it('answers not found for someone else’s row, the same as for a missing one', async () => {
    const { service, prisma } = build();
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead(ME, row(1).id)).rejects.toMatchObject({ status: 404 });
    expect(prisma.notification.findFirst).toHaveBeenCalledWith({ where: { id: row(1).id, recipientId: ME }, select: { id: true } });
  });

  it('marks all of the caller’s unread rows read and reports how many', async () => {
    const { service, prisma } = build();
    prisma.notification.updateMany.mockResolvedValue({ count: 4 });
    expect(await service.markAllRead(ME)).toBe(4);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { recipientId: ME, isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter notification exec vitest run src/notifications/notification.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the service**

`apps/notification/src/notifications/notification.service.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import type { Notification, PrismaClient } from '@prisma-clients/notification';
import { uuidv7, type NotificationDto, type NotificationPage } from '@ipms/contracts';
import { decodeCursor, encodeCursor } from './cursor.js';

export interface NewNotification {
  recipientId: string;
  eventId: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string;
  workOrderId: string;
}

export interface ListQuery {
  limit: number;
  cursor?: string | undefined;
  unreadOnly: boolean;
}

function toDto(row: Notification): NotificationDto {
  return {
    id: row.id, type: row.type, title: row.title, body: row.body, actionUrl: row.actionUrl,
    workOrderId: row.workOrderId, isRead: row.isRead, createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Every method takes the caller's id and puts it in the query's `where`. That is
 * the whole authorization model for this service: a notification is readable and
 * writable by its recipient only, so a row that is someone else's is
 * indistinguishable from one that does not exist.
 */
export class NotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * One row per recipient. `skipDuplicates` leans on the unique
   * `(recipientId, eventId)` key, so a redelivered event, or a retry after a
   * partial write, adds only what is missing.
   *
   * `createdAt` is set here rather than by the database default: Postgres keeps
   * microseconds, JavaScript keeps milliseconds, and the list cursor compares
   * timestamps it has round-tripped through JavaScript.
   */
  async createMany(items: NewNotification[]): Promise<number> {
    if (items.length === 0) return 0;
    const createdAt = new Date();
    const result = await this.prisma.notification.createMany({
      data: items.map((item) => ({ id: uuidv7(), createdAt, ...item })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async list(recipientId: string, query: ListQuery): Promise<NotificationPage> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId,
        ...(query.unreadOnly ? { isRead: false } : {}),
        ...(after
          ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One extra row says whether another page exists without a second query.
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toDto),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  unreadCount(recipientId: string): Promise<number> {
    return this.prisma.notification.count({ where: { recipientId, isRead: false } });
  }

  async markRead(recipientId: string, id: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id, recipientId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    if (result.count > 0) return;
    // Nothing changed: either it was already read (success) or it is not theirs (not found).
    const existing = await this.prisma.notification.findFirst({ where: { id, recipientId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Notification not found');
  }

  async markAllRead(recipientId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return result.count;
  }
}
```

- [ ] **Step 8: Run to verify it passes, then typecheck**

Run: `pnpm --filter notification exec vitest run src/notifications && pnpm --filter notification typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/notification/src/notifications
git commit -m "feat(notification): notification service with idempotent fan-out and cursor list" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: HTTP API, caller identity, exception filter

**Files:**
- Create: `apps/notification/src/http/current-user.ts`, `apps/notification/src/http/current-user.spec.ts`
- Create: `apps/notification/src/notifications/notification.controller.ts`, `apps/notification/src/notifications/notification.controller.spec.ts`
- Modify: `apps/notification/src/main.ts`

**Interfaces:**
- Consumes: `NotificationService` (Task 5); `ListNotificationsQuerySchema`, `NotificationIdSchema`, `NotificationPage`, `UnreadCount` (Task 1).
- Produces: `userIdFrom(request)`, `CurrentUserId` param decorator; `NotificationController` serving the four routes. `POST notifications/:id/read` → 204; `POST notifications/read-all` → 200 `{ updated: number }`.

- [ ] **Step 1: Write the failing identity tests**

`apps/notification/src/http/current-user.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { userIdFrom } from './current-user.js';

describe('userIdFrom', () => {
  it('returns the verified token subject', () => {
    expect(userIdFrom({ user: { id: 'u-1' } })).toBe('u-1');
  });

  it('refuses a request the token guard did not populate', () => {
    expect(() => userIdFrom({})).toThrow('Authentication required');
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `pnpm --filter notification exec vitest run src/http`
Expected: FAIL — module not found.

`apps/notification/src/http/current-user.ts`:

```ts
import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

/** Pulled out of the decorator so it can be tested without a Nest execution context. */
export function userIdFrom(request: { user?: { id: string } }): string {
  if (!request.user) throw new UnauthorizedException('Authentication required');
  return request.user.id;
}

/**
 * The caller, from the token `JwtUserGuard` verified. Handlers take their
 * recipient id from here and never from the URL or body, which is what keeps a
 * user from naming someone else's notifications.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    userIdFrom(context.switchToHttp().getRequest<{ user?: { id: string } }>()),
);
```

Run again: Expected PASS.

- [ ] **Step 3: Write the failing controller tests**

`apps/notification/src/notifications/notification.controller.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '@ipms/authz';
import { NotificationController } from './notification.controller.js';

const reflectMetadata = Reflect as unknown as { getMetadata(key: string, target: object): unknown };
const ME = 'u-1';
const ID = '0192f7a0-0000-7000-8000-000000000001';

function build() {
  const service = {
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    unreadCount: vi.fn().mockResolvedValue(4),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(2),
  };
  return { controller: new NotificationController(service as never), service };
}

describe('NotificationController', () => {
  it('lists for the caller, parsing the query string', async () => {
    const { controller, service } = build();
    await controller.list(ME, { limit: '5', unreadOnly: 'true' });
    expect(service.list).toHaveBeenCalledWith(ME, { limit: 5, unreadOnly: true });
  });

  it('refuses an out-of-range limit', async () => {
    const { controller } = build();
    await expect(controller.list(ME, { limit: '500' })).rejects.toThrow();
  });

  it('reports the caller’s unread count', async () => {
    const { controller } = build();
    expect(await controller.unreadCount(ME)).toEqual({ count: 4 });
  });

  it('marks one read for the caller', async () => {
    const { controller, service } = build();
    await controller.markRead(ME, ID);
    expect(service.markRead).toHaveBeenCalledWith(ME, ID);
  });

  it('refuses an id that is not a UUID before touching the service', async () => {
    const { controller, service } = build();
    await expect(controller.markRead(ME, 'nope')).rejects.toThrow();
    expect(service.markRead).not.toHaveBeenCalled();
  });

  it('marks all read and reports how many changed', async () => {
    const { controller } = build();
    expect(await controller.markAllRead(ME)).toEqual({ updated: 2 });
  });

  // These routes carry no @RequirePermission: any signed-in user may read their own
  // notifications. That is only safe while none is @Public, so pin it.
  it('leaves every route behind the token guard', () => {
    expect(reflectMetadata.getMetadata(IS_PUBLIC_KEY, NotificationController)).toBeUndefined();
    for (const handler of ['list', 'unreadCount', 'markRead', 'markAllRead'] as const) {
      expect(reflectMetadata.getMetadata(IS_PUBLIC_KEY, NotificationController.prototype[handler])).toBeUndefined();
    }
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter notification exec vitest run src/notifications/notification.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the controller**

`apps/notification/src/notifications/notification.controller.ts`:

```ts
import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ListNotificationsQuerySchema, NotificationIdSchema,
  type NotificationPage, type UnreadCount,
} from '@ipms/contracts';
import { CurrentUserId } from '../http/current-user.js';
import { NotificationService } from './notification.service.js';

/**
 * No `@RequirePermission` here, on purpose. A signed-in user may read and mark
 * their own notifications and nobody else's, and that boundary is the
 * `recipientId` filter in `NotificationService`, not a permission code.
 * `JwtUserGuard` still runs on every route, so the caller is always verified.
 * Do not add `@Public()` to anything in this class.
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(@CurrentUserId() userId: string, @Query() query: unknown): Promise<NotificationPage> {
    return this.notifications.list(userId, ListNotificationsQuerySchema.parse(query));
  }

  @Get('unread-count')
  async unreadCount(@CurrentUserId() userId: string): Promise<UnreadCount> {
    return { count: await this.notifications.unreadCount(userId) };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUserId() userId: string): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(userId) };
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@CurrentUserId() userId: string, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(userId, NotificationIdSchema.parse(id));
  }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter notification exec vitest run src/notifications src/http`
Expected: PASS.

- [ ] **Step 7: Map validation errors to 4xx**

In `apps/notification/src/main.ts`, change the first import line to bring in the filter, and register it:

```ts
import { GlobalExceptionFilter, createLogger } from '@ipms/observability';
```

```ts
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  // The platform error envelope. Without it a zod failure on a bad query is a 500.
  app.useGlobalFilters(new GlobalExceptionFilter('notification'));
  app.enableShutdownHooks();
```

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter notification typecheck`
Expected: PASS.

```bash
git add apps/notification/src
git commit -m "feat(notification): own-data notification API" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: IAM client, content, and the QC consumer

**Files:**
- Create: `apps/notification/src/directory/iam-directory.client.ts`, `apps/notification/src/directory/iam-directory.client.spec.ts`
- Create: `apps/notification/src/events/content.ts`, `apps/notification/src/events/content.spec.ts`
- Create: `apps/notification/src/events/qc-notification.consumer.ts`, `apps/notification/src/events/qc-notification.consumer.spec.ts`

**Interfaces:**
- Consumes: `NotificationService.createMany`, `NewNotification` (Task 5); `HoldersResultSchema` (Task 1); `QcSubmissionSubmitted`, `QcSubmissionReviewed`, `SUBJECTS`, `DurableConsumer`, `EventBus`, `InMemoryDedupeStore`, `EventEnvelope` from `@ipms/events`.
- Produces:
  - `class IamDirectoryClient` — `constructor(baseUrl: string, key: string, timeoutMs?: number, fetchImpl?: typeof fetch)`; `holders(permission: string, projectId: string): Promise<string[]>` (throws on any failure).
  - `submittedContent(p)`, `reviewedContent(p)` → `NotificationDraft = Omit<NewNotification, 'recipientId' | 'eventId'>`.
  - `class QcNotificationConsumer` — `constructor(notifications: NotificationService, iam: IamDirectoryClient, bus: EventBus)`; `onModuleInit()`, `register(consumer: DurableConsumer)`, `onSubmitted(envelope)`, `onReviewed(envelope)`; exported `NOTIFICATION_DURABLES`, `REVIEW_PERMISSION`.

- [ ] **Step 1: Write the failing IAM client tests**

`apps/notification/src/directory/iam-directory.client.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { IamDirectoryClient } from './iam-directory.client.js';

function client(response: Response | Error) {
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: new IamDirectoryClient('http://iam:3001', 'k-123', 3000, fetchImpl as never), fetchImpl };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('IamDirectoryClient.holders', () => {
  it('posts the permission and project with the service key and returns the ids', async () => {
    const { client: c, fetchImpl } = client(ok({ userIds: ['u-1', 'u-2'] }));
    expect(await c.holders('qc_review.approve', 'p-1')).toEqual(['u-1', 'u-2']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://iam:3001/api/v1/internal/authz/holders');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-internal-key': 'k-123', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ permission: 'qc_review.approve', projectId: 'p-1' });
  });

  it('throws on a non-2xx answer so the event is redelivered', async () => {
    await expect(client(new Response('', { status: 503 })).client.holders('x', 'p')).rejects.toThrow('503');
  });

  it('throws when iam cannot be reached', async () => {
    await expect(client(new Error('connect ECONNREFUSED')).client.holders('x', 'p')).rejects.toThrow('ECONNREFUSED');
  });

  it('throws on an answer that is not the agreed shape', async () => {
    await expect(client(ok({ users: [] })).client.holders('x', 'p')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `pnpm --filter notification exec vitest run src/directory`
Expected: FAIL — module not found.

`apps/notification/src/directory/iam-directory.client.ts`:

```ts
import { HoldersResultSchema } from '@ipms/contracts';

/**
 * What notification needs to know from iam: who may do a thing in a project.
 *
 * Authenticated with the shared service key, not a user token, because the
 * caller is an event consumer. Every failure throws: the consumer lets that
 * propagate so JetStream redelivers, and a lookup that quietly returned an
 * empty list would drop the notification instead.
 */
export class IamDirectoryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
    private readonly timeoutMs = 3000,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async holders(permission: string, projectId: string): Promise<string[]> {
    const response = await (this.fetchImpl ?? globalThis.fetch)(`${this.baseUrl}/api/v1/internal/authz/holders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': this.key },
      body: JSON.stringify({ permission, projectId }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`iam holders lookup failed with ${response.status}`);
    return HoldersResultSchema.parse(await response.json()).userIds;
  }
}
```

Run again: Expected PASS.

- [ ] **Step 3: Write the failing content tests**

`apps/notification/src/events/content.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { QcSubmissionReviewed, QcSubmissionSubmitted } from '@ipms/events';
import { reviewedContent, submittedContent } from './content.js';

const SUBMITTED: QcSubmissionSubmitted = {
  submissionId: 's-1', taskId: 'w-1', workOrderId: 'w-1', workOrderTitle: 'Tower foundation check',
  projectId: 'p-1', siteId: 'si-1', siteCode: 'KOS121', attemptNo: 2, submittedBy: 'u-1', submittedAt: '2026-10-02T08:00:00Z',
};
const REVIEWED: QcSubmissionReviewed = {
  submissionId: 's-1', taskId: 'w-1', workOrderId: 'w-1', workOrderTitle: 'Tower foundation check',
  projectId: 'p-1', siteId: 'si-1', siteCode: 'KOS121', attemptNo: 2, submittedBy: 'u-1',
  decision: 'APPROVE', reviewedBy: 'u-2', reviewedAt: '2026-10-02T09:00:00Z', comment: null,
};

describe('submittedContent', () => {
  it('names the work order, site and attempt and links to the work order', () => {
    expect(submittedContent(SUBMITTED)).toEqual({
      type: 'QC_SUBMISSION_SUBMITTED',
      title: 'Submission awaiting review',
      body: 'Work order "Tower foundation check" at KOS121 was submitted for review (attempt 2).',
      actionUrl: '/quality/work-orders/w-1',
      workOrderId: 'w-1',
    });
  });
});

describe('reviewedContent', () => {
  it('approves', () => {
    expect(reviewedContent(REVIEWED)).toMatchObject({
      type: 'QC_SUBMISSION_APPROVED',
      title: 'Submission approved',
      body: 'Work order "Tower foundation check" at KOS121 was approved.',
    });
  });

  it('puts the reviewer’s comment in a rework notice', () => {
    expect(reviewedContent({ ...REVIEWED, decision: 'REJECT_REWORK', comment: 'Photo is blurred' })).toMatchObject({
      type: 'QC_SUBMISSION_REJECTED',
      title: 'Rework required',
      body: 'Work order "Tower foundation check" at KOS121 needs rework: Photo is blurred',
    });
  });

  it('still reads sensibly with no comment', () => {
    expect(reviewedContent({ ...REVIEWED, decision: 'REJECT_REWORK' }).body)
      .toBe('Work order "Tower foundation check" at KOS121 needs rework.');
  });
});
```

- [ ] **Step 4: Run to verify it fails, then implement**

Run: `pnpm --filter notification exec vitest run src/events/content.spec.ts`
Expected: FAIL — module not found.

`apps/notification/src/events/content.ts`:

```ts
import type { QcSubmissionReviewed, QcSubmissionSubmitted } from '@ipms/events';
import type { NewNotification } from '../notifications/notification.service.js';

export type NotificationDraft = Omit<NewNotification, 'recipientId' | 'eventId'>;

const urlFor = (workOrderId: string): string => `/quality/work-orders/${workOrderId}`;

function label(p: { workOrderTitle: string; siteCode: string }): string {
  return `Work order "${p.workOrderTitle}" at ${p.siteCode}`;
}

export function submittedContent(p: QcSubmissionSubmitted): NotificationDraft {
  return {
    type: 'QC_SUBMISSION_SUBMITTED',
    title: 'Submission awaiting review',
    body: `${label(p)} was submitted for review (attempt ${p.attemptNo}).`,
    actionUrl: urlFor(p.workOrderId),
    workOrderId: p.workOrderId,
  };
}

export function reviewedContent(p: QcSubmissionReviewed): NotificationDraft {
  const approved = p.decision === 'APPROVE';
  const reason = p.comment ? `: ${p.comment}` : '.';
  return {
    type: approved ? 'QC_SUBMISSION_APPROVED' : 'QC_SUBMISSION_REJECTED',
    title: approved ? 'Submission approved' : 'Rework required',
    body: approved ? `${label(p)} was approved.` : `${label(p)} needs rework${reason}`,
    actionUrl: urlFor(p.workOrderId),
    workOrderId: p.workOrderId,
  };
}
```

Run again: Expected PASS.

- [ ] **Step 5: Write the failing consumer tests**

`apps/notification/src/events/qc-notification.consumer.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { SUBJECTS, type EventEnvelope, type QcSubmissionReviewed, type QcSubmissionSubmitted } from '@ipms/events';
import {
  NOTIFICATION_DURABLES, QcNotificationConsumer, REVIEW_PERMISSION,
} from './qc-notification.consumer.js';

const SUBMITTER = 'u-submitter';
const SUBMITTED: QcSubmissionSubmitted = {
  submissionId: 's-1', taskId: 'w-1', workOrderId: 'w-1', workOrderTitle: 'Tower check', projectId: 'p-1',
  siteId: 'si-1', siteCode: 'KOS121', attemptNo: 1, submittedBy: SUBMITTER, submittedAt: '2026-10-02T08:00:00Z',
};
const REVIEWED: QcSubmissionReviewed = {
  submissionId: 's-1', taskId: 'w-1', workOrderId: 'w-1', workOrderTitle: 'Tower check', projectId: 'p-1',
  siteId: 'si-1', siteCode: 'KOS121', attemptNo: 1, submittedBy: SUBMITTER, decision: 'APPROVE',
  reviewedBy: 'u-reviewer', reviewedAt: '2026-10-02T09:00:00Z', comment: null,
};

const envelope = <T>(payload: T): EventEnvelope<T> => ({
  eventId: 'evt-1', subject: 'x', occurredAt: '2026-10-02T08:00:00Z', version: 1, correlationId: 'c-1', actorId: null, payload,
});

function build(holders: string[] | Error = ['u-r1', 'u-r2', SUBMITTER]) {
  const notifications = { createMany: vi.fn().mockResolvedValue(1) };
  const iam = {
    holders: vi.fn(async () => {
      if (holders instanceof Error) throw holders;
      return holders;
    }),
  };
  const consumer = new QcNotificationConsumer(notifications as never, iam as never, {} as never);
  return { consumer, notifications, iam };
}

describe('QcNotificationConsumer.onSubmitted', () => {
  it('notifies every reviewer of the project except the submitter, once each', async () => {
    const { consumer, notifications, iam } = build(['u-r1', 'u-r2', 'u-r1', SUBMITTER]);
    await consumer.onSubmitted(envelope(SUBMITTED));
    expect(iam.holders).toHaveBeenCalledWith(REVIEW_PERMISSION, 'p-1');
    const rows = notifications.createMany.mock.calls[0][0];
    expect(rows.map((r: { recipientId: string }) => r.recipientId)).toEqual(['u-r1', 'u-r2']);
    expect(rows[0]).toMatchObject({ eventId: 'evt-1', type: 'QC_SUBMISSION_SUBMITTED', workOrderId: 'w-1' });
  });

  it('throws when iam fails, so the event is retried', async () => {
    const { consumer, notifications } = build(new Error('iam down'));
    await expect(consumer.onSubmitted(envelope(SUBMITTED))).rejects.toThrow('iam down');
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('acknowledges a project with no reviewers instead of retrying', async () => {
    const { consumer, notifications } = build([SUBMITTER]);
    await expect(consumer.onSubmitted(envelope(SUBMITTED))).resolves.toBeUndefined();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('skips, without calling iam, an event published before the payload was enriched', async () => {
    const { consumer, notifications, iam } = build();
    const legacy = { submissionId: 's-1', taskId: 'w-1', projectId: 'p-1', attemptNo: 1, submittedBy: SUBMITTER, submittedAt: 'x' };
    await expect(consumer.onSubmitted(envelope(legacy as never))).resolves.toBeUndefined();
    expect(iam.holders).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });
});

describe('QcNotificationConsumer.onReviewed', () => {
  it('tells the submitter their work was approved', async () => {
    const { consumer, notifications } = build();
    await consumer.onReviewed(envelope(REVIEWED));
    expect(notifications.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ recipientId: SUBMITTER, eventId: 'evt-1', type: 'QC_SUBMISSION_APPROVED' }),
    ]);
  });

  it('carries the reviewer’s comment on a rework decision', async () => {
    const { consumer, notifications } = build();
    await consumer.onReviewed(envelope({ ...REVIEWED, decision: 'REJECT_REWORK', comment: 'Photo is blurred' }));
    const [row] = notifications.createMany.mock.calls[0][0];
    expect(row).toMatchObject({ type: 'QC_SUBMISSION_REJECTED', recipientId: SUBMITTER });
    expect(row.body).toContain('Photo is blurred');
  });

  it('skips an event published before the payload was enriched', async () => {
    const { consumer, notifications } = build();
    const legacy = { submissionId: 's-1', taskId: 'w-1', projectId: 'p-1', attemptNo: 1, decision: 'APPROVE', reviewedBy: 'u', reviewedAt: 'x', comment: null };
    await expect(consumer.onReviewed(envelope(legacy as never))).resolves.toBeUndefined();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });
});

describe('QcNotificationConsumer.register', () => {
  it('subscribes one durable per subject', async () => {
    const { consumer } = build();
    const subscribe = vi.fn().mockResolvedValue(undefined);
    await consumer.register({ subscribe } as never);
    expect(subscribe.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [SUBJECTS.QC_SUBMISSION_SUBMITTED, NOTIFICATION_DURABLES.submitted],
      [SUBJECTS.QC_SUBMISSION_REVIEWED, NOTIFICATION_DURABLES.reviewed],
    ]);
    expect(NOTIFICATION_DURABLES).toEqual({
      submitted: 'notification-submission-submitted',
      reviewed: 'notification-submission-reviewed',
    });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter notification exec vitest run src/events/qc-notification.consumer.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the consumer**

`apps/notification/src/events/qc-notification.consumer.ts`:

```ts
import type { OnModuleInit } from '@nestjs/common';
import {
  DurableConsumer, InMemoryDedupeStore, SUBJECTS,
  type EventBus, type EventEnvelope, type QcSubmissionReviewed, type QcSubmissionSubmitted,
} from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { IamDirectoryClient } from '../directory/iam-directory.client.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { reviewedContent, submittedContent } from './content.js';

const log = createLogger('notification');

/** Must match `STREAMS.QC.durableConsumers`. One durable per subject: a durable carries a single filter_subject. */
export const NOTIFICATION_DURABLES = {
  submitted: 'notification-submission-submitted',
  reviewed: 'notification-submission-reviewed',
} as const;

export const REVIEW_PERMISSION = 'qc_review.approve';

/**
 * Events published before the payload carried labels and the submitter lack
 * these fields. Retrying cannot supply them, so such an event is acknowledged
 * rather than redelivered into the dead-letter queue.
 */
const hasLabels = (p: { workOrderId?: unknown; workOrderTitle?: unknown; siteCode?: unknown }): boolean =>
  typeof p.workOrderId === 'string' && typeof p.workOrderTitle === 'string' && typeof p.siteCode === 'string';

/**
 * Turns QC submission facts into in-app notifications.
 *
 * Idempotency lives in the database (unique `(recipientId, eventId)`), so the
 * in-memory dedupe store here only saves repeat work within one process; it
 * does not need to survive a restart or be shared between replicas.
 */
export class QcNotificationConsumer implements OnModuleInit {
  constructor(
    private readonly notifications: NotificationService,
    private readonly iam: IamDirectoryClient,
    private readonly bus: EventBus,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.register(new DurableConsumer(this.bus, new InMemoryDedupeStore()));
    log.info('qc notification consumers started');
  }

  async register(consumer: DurableConsumer): Promise<void> {
    await consumer.subscribe<QcSubmissionSubmitted>(
      SUBJECTS.QC_SUBMISSION_SUBMITTED, NOTIFICATION_DURABLES.submitted, (envelope) => this.onSubmitted(envelope),
    );
    await consumer.subscribe<QcSubmissionReviewed>(
      SUBJECTS.QC_SUBMISSION_REVIEWED, NOTIFICATION_DURABLES.reviewed, (envelope) => this.onReviewed(envelope),
    );
  }

  /** Reviewers of the project, minus the person who submitted (who may hold the permission too). */
  async onSubmitted(envelope: EventEnvelope<QcSubmissionSubmitted>): Promise<void> {
    const p = envelope.payload;
    if (!hasLabels(p)) {
      log.warn({ eventId: envelope.eventId, subject: envelope.subject }, 'event predates enriched payload, skipped');
      return;
    }
    // Throws when iam is unreachable: the consumer retries with backoff for about 30 s, then drops the event.
    const holders = await this.iam.holders(REVIEW_PERMISSION, p.projectId);
    const recipients = [...new Set(holders)].filter((id) => id !== p.submittedBy);
    if (recipients.length === 0) {
      log.warn({ eventId: envelope.eventId, projectId: p.projectId }, 'no reviewers to notify for submission');
      return;
    }
    const draft = submittedContent(p);
    await this.notifications.createMany(recipients.map((recipientId) => ({ recipientId, eventId: envelope.eventId, ...draft })));
  }

  /** The engineer who submitted the work. */
  async onReviewed(envelope: EventEnvelope<QcSubmissionReviewed>): Promise<void> {
    const p = envelope.payload;
    if (!hasLabels(p) || typeof p.submittedBy !== 'string') {
      log.warn({ eventId: envelope.eventId, subject: envelope.subject }, 'event predates enriched payload, skipped');
      return;
    }
    await this.notifications.createMany([{ recipientId: p.submittedBy, eventId: envelope.eventId, ...reviewedContent(p) }]);
  }
}
```

- [ ] **Step 8: Run to verify it passes, then typecheck**

Run: `pnpm --filter notification exec vitest run src/events src/directory && pnpm --filter notification typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/notification/src
git commit -m "feat(notification): consume QC submission events into in-app notifications" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Module wiring and environment

**Files:**
- Modify: `apps/notification/src/app.module.ts`, `apps/notification/src/app.module.spec.ts`
- Modify: `docker/env/notification.env`, `docker/env/iam.env`, `docker/docker-compose.yml`, `docker/env/README.md`, `.env.example`
- Modify: `libs/authz/src/permissions.ts` (comment at ~line 85)

**Interfaces:**
- Consumes: Tasks 5-7 classes.
- Produces: a runnable service that, at startup, connects NATS, creates both durables, and serves the four routes.

- [ ] **Step 1: Write the failing module tests**

In `apps/notification/src/app.module.spec.ts` add the imports

```ts
import { NotificationController } from './notifications/notification.controller.js';
import { NotificationService } from './notifications/notification.service.js';
import { QcNotificationConsumer } from './events/qc-notification.consumer.js';
```

and, inside the `describe('AppModule guard registration', ...)` block:

```ts
  it('serves the notification routes', () => {
    const controllers = reflectMetadata.getMetadata('controllers', AppModule) as unknown[];
    expect(controllers).toContain(NotificationController);
  });

  it('provides the service the controller injects', () => {
    expect(providers.filter(isClassProvider).some((p) => p.provide === NotificationService)).toBe(true);
  });

  // A provider that is never listed is never constructed, so its onModuleInit never runs
  // and the service would start without ever subscribing.
  it('provides the QC consumer so it subscribes at startup', () => {
    expect(providers.filter(isClassProvider).some((p) => p.provide === QcNotificationConsumer)).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter notification exec vitest run src/app.module.spec.ts`
Expected: FAIL — the three new tests.

- [ ] **Step 3: Rewrite `app.module.ts`**

Replace the whole file with:

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
import { IamDirectoryClient } from './directory/iam-directory.client.js';
import { QcNotificationConsumer } from './events/qc-notification.consumer.js';
import { NotificationController } from './notifications/notification.controller.js';
import { NotificationService } from './notifications/notification.service.js';
import { PrismaService } from './prisma.service.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * `notification`'s routes return only the caller's own rows, enforced by the
 * `recipientId` filter in `NotificationService`, and none passes a resource to
 * `check()`. An empty, non-global scope is therefore the *least* permissive value
 * available to it, not a stub. Do NOT "fix" this into `global: true` — that would
 * silently grant scope-based access to every project and site the moment a future
 * change passes a resource into `check()`.
 */
const notificationScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

/**
 * DEFERRED — push and email transport (spec 2026-09-20 §6.2).
 *
 * This service will deliver over FCM (Android, with iOS via the APNs bridge)
 * and an SMTP-compatible transactional provider — architecture spec §12,
 * assumption 1. Neither client, nor their credentials, nor a `DevicePushToken`
 * registration endpoint exists yet. In-app delivery is live (spec 2026-10-02);
 * add transport beside `QcNotificationConsumer`, as another sink for the same
 * decision, not as a second consumer of the same events.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MetricsController, NotificationController],
  providers: [
    // Registration order matters: APP_GUARD providers run in the order they are
    // listed. JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: notificationScopeProvider },
    /**
     * `AuthzGuard` passes overrides to `check()`, so every service must provide
     * this token or fail at bootstrap. notification returns none, which is the
     * *least* permissive option rather than a gap: global overrides are already
     * resolved into the JWT `permissions` claim at issuance, and this service
     * has no routes passing a `resource` for a scoped override to apply to.
     */
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
    {
      provide: EventBus,
      useFactory: async (): Promise<EventBus> => {
        const bus = new EventBus();
        await bus.connect(requireEnv('NATS_URL'));
        await bus.ensureStreams();
        registerReadinessCheck('nats', () => bus.isHealthy());
        return bus;
      },
    },
    {
      provide: NotificationService,
      useFactory: (prisma: PrismaService): NotificationService => new NotificationService(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: IamDirectoryClient,
      useFactory: (): IamDirectoryClient => new IamDirectoryClient(
        process.env['IAM_INTERNAL_URL'] ?? 'http://iam:3001',
        requireEnv('INTERNAL_SERVICE_KEY'),
      ),
    },
    {
      provide: QcNotificationConsumer,
      useFactory: (notifications: NotificationService, iam: IamDirectoryClient, bus: EventBus): QcNotificationConsumer =>
        new QcNotificationConsumer(notifications, iam, bus),
      inject: [NotificationService, IamDirectoryClient, EventBus],
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run to verify it passes, then typecheck**

Run: `pnpm --filter notification test && pnpm --filter notification typecheck`
Expected: PASS.

- [ ] **Step 5: Environment files**

`docker/env/notification.env` — append:

```
NATS_URL=nats://nats:4222
IAM_INTERNAL_URL=http://iam:3001
# Shared with iam. Authenticates the reviewer lookup, which has no user token.
INTERNAL_SERVICE_KEY=local_dev_internal_service_key
```

`docker/env/iam.env` — append:

```
# Shared with notification. Required in production; without it the internal holders lookup refuses every call.
INTERNAL_SERVICE_KEY=local_dev_internal_service_key
```

`.env.example` — append:

```
# Where notification reaches iam directly for the reviewer lookup. Under /internal/, so not via the gateway.
IAM_INTERNAL_URL=http://127.0.0.1:3001

# Shared secret for service-to-service calls that carry no user token (notification -> iam).
# Set the same value for both services. iam refuses to start in production without it.
INTERNAL_SERVICE_KEY=change-me-in-production
```

`docker/docker-compose.yml` — in the `notification` service replace the comment block above it and its `depends_on`:

```yaml
  # Postgres and NATS: notification consumes qc submission events. It needs no
  # Redis (idempotency is a unique key in its own database) and reaches iam
  # directly, but does not wait on it: a lookup that fails is retried by the
  # durable, so notification may start first.
  notification:
    <<: *service-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      args: { SERVICE: notification }
    env_file:
      - ./env/notification.env
    depends_on:
      postgres-notification: { condition: service_healthy }
      nats:                  { condition: service_healthy }
      notification-migrate:  { condition: service_completed_successfully }
```

(keep the existing `healthcheck:` block unchanged).

`docker/env/README.md` — change the Notification Service row description to `Notification service + migrations. Consumes qc submission events from NATS; calls iam (IAM_INTERNAL_URL) with INTERNAL_SERVICE_KEY.` and add below the media section:

```
## Internal service key

`INTERNAL_SERVICE_KEY` authenticates service-to-service calls that carry no user token. Today that is
notification asking iam which users may review a project (`POST /api/v1/internal/authz/holders`).
The value must be identical in `iam.env` and `notification.env`. iam refuses to start in
`NODE_ENV=production` without it. To rotate: change both files and redeploy iam and notification
together; until both are updated, reviewer notifications are retried by the event consumer, not lost.
```

- [ ] **Step 6: Update the deferred-permissions comment**

In `libs/authz/src/permissions.ts` find the line containing `DEFERRED — no \`notification.*\` or \`docs.*\` permissions (spec 2026-09-20 §6.4).` and, on the line above it, add:

```ts
  // notification needs none: its routes are authenticated and own-data-only, enforced by the
  // recipientId filter (spec 2026-10-02 §4.3). Only `docs.*` remains deferred.
```

- [ ] **Step 7: Verify the authz lib still passes, then commit**

Run: `pnpm --filter @ipms/authz test`
Expected: PASS.

```bash
git add apps/notification docker .env.example libs/authz
git commit -m "feat(notification): wire event bus, consumer and API into the service" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web server-side proxy for notifications

**Files:**
- Create: `apps/web/app/lib/notification-api.ts`, `apps/web/app/lib/notification-api.spec.ts`
- Create: `apps/web/app/api/notifications/respond.ts`, `apps/web/app/api/notifications/respond.spec.ts`
- Create: `apps/web/app/api/notifications/route.ts`, `apps/web/app/api/notifications/unread-count/route.ts`, `apps/web/app/api/notifications/read-all/route.ts`, `apps/web/app/api/notifications/[id]/read/route.ts`

**Interfaces:**
- Consumes: `authFetch`, `ApiResult` from `apps/web/app/lib/api-client.ts`; `NotificationPage`, `UnreadCount` (Task 1).
- Produces: `listNotifications(params)`, `unreadCount()`, `markRead(id)`, `markAllRead()` returning `ApiResult`; `respond(result): NextResponse`; browser-facing routes `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/read-all`, `POST /api/notifications/:id/read`.

- [ ] **Step 1: Write the failing API-lib tests**

`apps/web/app/lib/notification-api.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));
const api = await import('./notification-api');
beforeEach(() => { authFetch.mockClear(); });

describe('notification-api', () => {
  it('lists with only the parameters it was given', async () => {
    await api.listNotifications({ limit: '20', cursor: 'abc', unreadOnly: undefined });
    expect(authFetch).toHaveBeenCalledWith('/api/v1/notifications', { query: { limit: '20', cursor: 'abc', unreadOnly: undefined } });
  });

  it('reads the unread count', async () => {
    await api.unreadCount();
    expect(authFetch).toHaveBeenCalledWith('/api/v1/notifications/unread-count');
  });

  it('marks one read with a POST', async () => {
    await api.markRead('n-1');
    expect(authFetch).toHaveBeenCalledWith('/api/v1/notifications/n-1/read', { method: 'POST' });
  });

  it('marks all read with a POST', async () => {
    await api.markAllRead();
    expect(authFetch).toHaveBeenCalledWith('/api/v1/notifications/read-all', { method: 'POST' });
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `pnpm --filter web exec vitest run app/lib/notification-api.spec.ts`
Expected: FAIL — module not found.

`apps/web/app/lib/notification-api.ts`:

```ts
import 'server-only';
import type { NotificationPage, UnreadCount } from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * The notification service's surface, reached through the gateway's
 * `/api/v1/notifications` prefix. The browser cannot call it itself — the
 * session cookie is http-only — so the route handlers under `app/api/notifications`
 * call these on its behalf.
 */

export interface ListNotificationsParams {
  limit?: string | undefined;
  cursor?: string | undefined;
  unreadOnly?: string | undefined;
}

export function listNotifications(params: ListNotificationsParams): Promise<ApiResult<NotificationPage>> {
  return authFetch<NotificationPage>('/api/v1/notifications', { query: { ...params } });
}

export function unreadCount(): Promise<ApiResult<UnreadCount>> {
  return authFetch<UnreadCount>('/api/v1/notifications/unread-count');
}

export function markRead(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export function markAllRead(): Promise<ApiResult<{ updated: number }>> {
  return authFetch<{ updated: number }>('/api/v1/notifications/read-all', { method: 'POST' });
}
```

Run again: Expected PASS.

- [ ] **Step 3: Write the failing `respond` tests**

`apps/web/app/api/notifications/respond.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { respond } from './respond';

describe('respond', () => {
  it('passes data through, uncached', async () => {
    const res = respond({ state: 'ready', data: { count: 3 } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ count: 3 });
  });

  it('answers 204 for an empty success', () => {
    expect(respond({ state: 'ready', data: undefined }).status).toBe(204);
  });

  it('answers 401 when signed out and 403 when refused', () => {
    expect(respond({ state: 'unauthenticated' }).status).toBe(401);
    expect(respond({ state: 'forbidden', message: 'no' }).status).toBe(403);
  });

  it('keeps a client error status and turns an upstream failure into 503', () => {
    expect(respond({ state: 'unavailable', status: 404, message: 'gone' }).status).toBe(404);
    expect(respond({ state: 'unavailable', status: 500, message: 'boom' }).status).toBe(503);
    expect(respond({ state: 'unavailable', status: null, message: 'down' }).status).toBe(503);
  });
});
```

- [ ] **Step 4: Run to verify it fails, then implement**

Run: `pnpm --filter web exec vitest run app/api/notifications/respond.spec.ts`
Expected: FAIL — module not found.

`apps/web/app/api/notifications/respond.ts`:

```ts
import { NextResponse } from 'next/server';
import type { ApiResult } from '../../lib/api-client';

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (message: string, status: number) => NextResponse.json({ message }, { status, headers: NO_STORE });

/** Turns what `authFetch` found into the response the browser sees, never leaking an upstream body. */
export function respond<T>(result: ApiResult<T>): NextResponse {
  switch (result.state) {
    case 'ready':
      return result.data === undefined
        ? new NextResponse(null, { status: 204, headers: NO_STORE })
        : NextResponse.json(result.data, { headers: NO_STORE });
    case 'unauthenticated': return fail('Sign in to continue.', 401);
    case 'forbidden': return fail(result.message, 403);
    case 'unavailable': return fail(result.message, result.status !== null && result.status < 500 ? result.status : 503);
  }
}
```

Run again: Expected PASS.

- [ ] **Step 5: Create the four route handlers**

`apps/web/app/api/notifications/route.ts`:

```ts
import type { NextResponse } from 'next/server';
import { listNotifications } from '../../lib/notification-api';
import { respond } from './respond';

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  return respond(await listNotifications({
    limit: params.get('limit') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    unreadOnly: params.get('unreadOnly') ?? undefined,
  }));
}
```

`apps/web/app/api/notifications/unread-count/route.ts`:

```ts
import type { NextResponse } from 'next/server';
import { unreadCount } from '../../../lib/notification-api';
import { respond } from '../respond';

export async function GET(): Promise<NextResponse> {
  return respond(await unreadCount());
}
```

`apps/web/app/api/notifications/read-all/route.ts`:

```ts
import type { NextResponse } from 'next/server';
import { markAllRead } from '../../../lib/notification-api';
import { respond } from '../respond';

export async function POST(): Promise<NextResponse> {
  return respond(await markAllRead());
}
```

`apps/web/app/api/notifications/[id]/read/route.ts`:

```ts
import type { NextResponse } from 'next/server';
import { markRead } from '../../../../lib/notification-api';
import { respond } from '../../respond';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return respond(await markRead(id));
}
```

- [ ] **Step 6: Typecheck and run the web suite**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): notification proxy routes over the gateway" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The bell shows real notifications

**Files:**
- Create: `apps/web/app/components/notification-model.ts`, `apps/web/app/components/notification-model.spec.ts`
- Modify: `apps/web/app/components/notification-center.tsx`

**Interfaces:**
- Consumes: `NotificationDto`, `NotificationPage`, `UnreadCount` (Task 1); the four `/api/notifications` routes (Task 9).
- Produces: `NotificationItem`, `Category`, `categoryOf(type)`, `relativeTime(iso, now)`, `toItem(dto, now)`, `markOneRead(items, id)`, `markEveryRead(items)`.

- [ ] **Step 1: Write the failing model tests**

`apps/web/app/components/notification-model.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { NotificationDto } from '@ipms/contracts';
import { categoryOf, markEveryRead, markOneRead, relativeTime, toItem } from './notification-model';

const NOW = new Date('2026-10-02T12:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('categoryOf', () => {
  it('groups by the type prefix', () => {
    expect(categoryOf('QC_SUBMISSION_APPROVED')).toBe('qc');
    expect(categoryOf('WORK_ORDER_ASSIGNED')).toBe('work-order');
    expect(categoryOf('SOMETHING_ELSE')).toBe('system');
  });
});

describe('relativeTime', () => {
  it('reads naturally across the ranges', () => {
    expect(relativeTime(at(10_000), NOW)).toBe('just now');
    expect(relativeTime(at(5 * 60_000), NOW)).toBe('5m ago');
    expect(relativeTime(at(3 * 3_600_000), NOW)).toBe('3h ago');
    expect(relativeTime(at(2 * 86_400_000), NOW)).toBe('2d ago');
    expect(relativeTime(at(30 * 86_400_000), NOW)).toBe('2026-09-02');
  });

  it('never goes negative when the clocks disagree, and tolerates junk', () => {
    expect(relativeTime(at(-60_000), NOW)).toBe('just now');
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});

describe('toItem', () => {
  it('maps the wire shape to what the panel renders', () => {
    const dto: NotificationDto = {
      id: 'n-1', type: 'QC_SUBMISSION_REJECTED', title: 'Rework required', body: 'Fix it',
      actionUrl: '/quality/work-orders/w-1', workOrderId: 'w-1', isRead: false, createdAt: at(5 * 60_000),
    };
    expect(toItem(dto, NOW)).toEqual({
      id: 'n-1', category: 'qc', title: 'Rework required', description: 'Fix it',
      time: '5m ago', unread: true, href: '/quality/work-orders/w-1',
    });
  });

  it('omits href when there is no action url', () => {
    const item = toItem({ id: 'n', type: 'X', title: 't', body: 'b', actionUrl: null, workOrderId: null, isRead: true, createdAt: at(0) }, NOW);
    expect('href' in item).toBe(false);
    expect(item.unread).toBe(false);
  });
});

describe('read-state helpers', () => {
  const items = [
    { id: 'a', category: 'qc' as const, title: '', description: '', time: '', unread: true },
    { id: 'b', category: 'qc' as const, title: '', description: '', time: '', unread: true },
  ];

  it('marks one without touching the rest or mutating the input', () => {
    const next = markOneRead(items, 'a');
    expect(next.map((i) => i.unread)).toEqual([false, true]);
    expect(items[0]!.unread).toBe(true);
  });

  it('marks every one', () => {
    expect(markEveryRead(items).every((i) => !i.unread)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `pnpm --filter web exec vitest run app/components/notification-model.spec.ts`
Expected: FAIL — module not found.

`apps/web/app/components/notification-model.ts`:

```ts
import type { NotificationDto } from '@ipms/contracts';

export type Category = 'work-order' | 'qc' | 'system';

export interface NotificationItem {
  id: string;
  category: Category;
  title: string;
  description: string;
  time: string;
  unread: boolean;
  href?: string;
}

export function categoryOf(type: string): Category {
  if (type.startsWith('QC_')) return 'qc';
  if (type.startsWith('WORK_ORDER_')) return 'work-order';
  return 'system';
}

export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor(Math.max(0, now.getTime() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

export function toItem(dto: NotificationDto, now: Date): NotificationItem {
  return {
    id: dto.id,
    category: categoryOf(dto.type),
    title: dto.title,
    description: dto.body,
    time: relativeTime(dto.createdAt, now),
    unread: !dto.isRead,
    ...(dto.actionUrl === null ? {} : { href: dto.actionUrl }),
  };
}

export function markOneRead(items: NotificationItem[], id: string): NotificationItem[] {
  return items.map((item) => (item.id === id ? { ...item, unread: false } : item));
}

export function markEveryRead(items: NotificationItem[]): NotificationItem[] {
  return items.map((item) => ({ ...item, unread: false }));
}
```

Run again: Expected PASS.

- [ ] **Step 3: Rewrite `notification-center.tsx` against the API**

Replace the whole file with the following. The markup and class names are the existing ones; what changes is the data source (the mock list is removed), loading/error states, and optimistic mutation with rollback.

```tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { NotificationPage, UnreadCount } from '@ipms/contracts';
import {
  markEveryRead, markOneRead, toItem,
  type Category, type NotificationItem,
} from './notification-model';

/** How often the badge re-checks while the tab is visible. */
const POLL_MS = 30_000;
const NO_STORE: RequestInit = { cache: 'no-store' };

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * `keepalive` lets the request outlive the page: clicking a notification marks it
 * read and navigates away in the same gesture, and without it the browser may
 * cancel the request as the page unloads.
 */
async function post(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'POST', keepalive: true })).ok;
  } catch {
    return false;
  }
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | Category>('all');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [count, setCount] = useState(0);
  const [load, setLoad] = useState<LoadState>('idle');
  const [failure, setFailure] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/unread-count', NO_STORE);
      if (!response.ok) return;
      setCount(((await response.json()) as UnreadCount).count);
    } catch {
      // The badge keeps its last value; the next poll tries again.
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoad('loading');
    try {
      const response = await fetch('/api/notifications?limit=20', NO_STORE);
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as NotificationPage;
      const now = new Date();
      setItems(page.items.map((dto) => toItem(dto, now)));
      setLoad('ready');
    } catch {
      setLoad('error');
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCount();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    setFailure(null);
    void loadList();
    void refreshCount();
  }, [open, loadList, refreshCount]);

  /** Optimistic: update at once, put it back if the server refuses. */
  async function markAsRead(id: string) {
    if (!items.find((item) => item.id === id)?.unread) return;
    const before = { items, count };
    setItems(markOneRead(items, id));
    setCount(Math.max(0, count - 1));
    if (!(await post(`/api/notifications/${encodeURIComponent(id)}/read`))) {
      setItems(before.items);
      setCount(before.count);
      setFailure('Could not mark that notification as read.');
    }
  }

  async function markAllAsRead() {
    const before = { items, count };
    setItems(markEveryRead(items));
    setCount(0);
    if (await post('/api/notifications/read-all')) {
      // The panel lists the newest 20; older unread ones are still counted by the server.
      void refreshCount();
    } else {
      setItems(before.items);
      setCount(before.count);
      setFailure('Could not mark notifications as read.');
    }
  }

  const filtered = items.filter((item) => filter === 'all' || item.category === filter);

  return (
    <div className="notif-wrapper">
      <button
        type="button"
        className={`notif-bell-btn${open ? ' active' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label={`Notifications, ${count} unread`}
        title="Notifications"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>

        {count > 0 ? (
          <span className="notif-badge" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            className="notif-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="notif-dropdown" role="dialog" aria-label="Notifications panel">
            <div className="notif-header">
              <div className="notif-header-title">
                <h3>Notifications</h3>
                {count > 0 ? (
                  <span className="notif-count-pill">{count} new</span>
                ) : null}
              </div>
              {count > 0 ? (
                <button
                  type="button"
                  className="notif-mark-read-btn"
                  onClick={() => void markAllAsRead()}
                >
                  Mark all as read
                </button>
              ) : null}
            </div>

            <div className="notif-tabs" role="tablist">
              <button
                type="button"
                className={`notif-tab${filter === 'all' ? ' active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`notif-tab${filter === 'qc' ? ' active' : ''}`}
                onClick={() => setFilter('qc')}
              >
                Quality & QC
              </button>
              <button
                type="button"
                className={`notif-tab${filter === 'work-order' ? ' active' : ''}`}
                onClick={() => setFilter('work-order')}
              >
                Work Orders
              </button>
            </div>

            {failure ? (
              <div className="notif-empty" role="alert">
                <span>{failure}</span>
              </div>
            ) : null}

            <div className="notif-list">
              {load === 'loading' && items.length === 0 ? (
                <div className="notif-empty" role="status">
                  <span>Loading notifications…</span>
                </div>
              ) : load === 'error' ? (
                <div className="notif-empty" role="alert">
                  <p>Could not load notifications.</p>
                  <button type="button" className="notif-mark-read-btn" onClick={() => void loadList()}>
                    Try again
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="notif-empty">
                  <div className="notif-empty-icon" aria-hidden="true">✓</div>
                  <p>All caught up!</p>
                  <span>No notifications in this category.</span>
                </div>
              ) : (
                filtered.map((item) => (
                  <a
                    key={item.id}
                    href={item.href ?? '#'}
                    className={`notif-item${item.unread ? ' unread' : ''}`}
                    onClick={() => {
                      void markAsRead(item.id);
                      setOpen(false);
                    }}
                  >
                    <div className="notif-item-left">
                      <span className={`notif-dot ${item.category}`} aria-hidden="true" />
                    </div>
                    <div className="notif-item-content">
                      <div className="notif-item-row">
                        <span className="notif-item-title">{item.title}</span>
                        <span className="notif-item-time">{item.time}</span>
                      </div>
                      <p className="notif-item-desc">{item.description}</p>
                    </div>
                  </a>
                ))
              )}
            </div>

            <div className="notif-footer">
              <a href="/quality/work-orders" onClick={() => setOpen(false)}>
                View all work orders &rarr;
              </a>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Check nothing else imported the removed export**

Run: `grep -rn "NotificationItem\|INITIAL_NOTIFICATIONS" apps/web --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v .next`
Expected: only `notification-model.ts`, its spec, and `notification-center.tsx`. If `shell.tsx` or another file imported `NotificationItem` from the component, change that import to `./components/notification-model`.

- [ ] **Step 5: Run the web suite, typecheck and lint**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 6: Manual smoke test of the bell**

Bring the stack up (`docker compose -f docker/docker-compose.yml up --build -d`), run `pnpm --filter web dev`, sign in as the seeded engineer, and confirm: the badge shows the seeded unread count; opening the panel lists them with real relative times; clicking one decrements the badge and survives a reload; stopping the notification container (`docker compose -f docker/docker-compose.yml stop notification`) makes the panel show "Could not load notifications." with a working "Try again". If the stack cannot be run in this environment, say so in the handoff rather than claiming this was verified.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): notification bell reads the notification service" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end test

**Files:**
- Create: `e2e/notifications.e2e.spec.ts`

**Interfaces:**
- Consumes: the running stack through the gateway: `/api/v1/qc/submissions`, `/api/v1/qc/submissions/:id/review`, `/api/v1/notifications*`.

- [ ] **Step 1: Write the spec**

`e2e/notifications.e2e.spec.ts`:

```ts
import { randomBytes } from 'node:crypto';
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

interface Page { items: { id: string; type: string; title: string; body: string; actionUrl: string | null; workOrderId: string | null; isRead: boolean }[]; nextCursor: string | null }

/** The consumers run asynchronously after the outbox drains, so poll rather than assert once. */
async function waitForNotification(token: string, workOrderId: string, type: string): Promise<Page['items'][number]> {
  for (let i = 0; i < 30; i++) {
    const page = await api<Page>('/api/v1/notifications?limit=50', { token });
    const found = page.body.items.find((n) => n.workOrderId === workOrderId && n.type === type);
    if (found) return found;
    await sleep(500);
  }
  throw new Error(`no ${type} notification for ${workOrderId} within 15s`);
}

let admin: string;
let qc: string;
let engineer: string;
let engineerId: string;
let qcId: string;

beforeAll(async () => {
  await waitForReady();
  [admin, qc, engineer] = await Promise.all([login('admin'), login('qc'), login('engineer')]);
  engineerId = (await api<{ items: { id: string }[] }>('/api/v1/users?search=engineer', { token: admin })).body.items[0]!.id;
  qcId = (await api<{ items: { id: string; email: string }[] }>('/api/v1/users?search=qc@ipms.local', { token: admin })).body.items.find((u) => u.email === 'qc@ipms.local')!.id;
}, 90_000);

describe('QC notifications', () => {
  it('tells reviewers on submit and the engineer on a rework decision, to each recipient only', async () => {
    const stamp = Date.now();
    const templateId = (await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code: `NT-${stamp}`, name: 'E2E notifications', category: 'QUALITY' } })).body.templateId;
    // No photo or video minimums, so the submission needs no uploads.
    await api(`/api/v1/qc/templates/${templateId}/draft`, { method: 'PUT', token: qc, body: { revision: 1, document: { sections: [{ number: '1', title: 'Install', items: [{ number: '1.1', requirementText: 'Label fitted' }] }] } } });
    expect((await api(`/api/v1/qc/templates/${templateId}/publish`, { method: 'POST', token: qc })).status).toBe(201);
    const projectId = (await api<{ id: string }>('/api/v1/projects', { method: 'POST', token: admin, body: { code: `NT-${stamp}`, name: 'Notifications e2e' } })).body.id;
    const siteId = (await api<{ id: string }>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', token: admin, body: { siteCode: 'KOS131', name: 'KOS131' } })).body.id;
    const scope = { level: 'PROJECT', projectId };
    await api(`/api/v1/users/${engineerId}/projects`, { method: 'POST', token: admin, body: scope });
    await api(`/api/v1/users/${qcId}/projects`, { method: 'POST', token: admin, body: scope });
    try {
      await sleep(1500); // scope replicates to project over NATS
      const workOrderId = (await api<{ created: { id: string }[] }>('/api/v1/work-orders', { method: 'POST', token: admin, body: {
        projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: engineerId, plannedCompletionAt: '2026-12-31T18:14:59Z',
      } })).body.created[0]!.id;
      const checklist = await api<{ version: { id: string; sections: { items: { id: string }[] }[] } }>(`/api/v1/qc/tasks/${workOrderId}/checklist`, { token: engineer });
      const itemId = checklist.body.version.sections[0]!.items[0]!.id;

      const submitted = await api<{ id: string }>('/api/v1/qc/submissions', { method: 'POST', token: engineer, body: {
        taskId: workOrderId, siteId, projectId, templateVersionId: checklist.body.version.id, idempotencyKey: `e2e-${uuidv7()}`,
        responses: [{ itemId, selfCheckResult: 'PASS', mediaIds: [] }],
      } });
      expect(submitted.status).toBe(201);

      // The reviewer is told; the submitter is not told about their own submission.
      const forReviewer = await waitForNotification(qc, workOrderId, 'QC_SUBMISSION_SUBMITTED');
      expect(forReviewer.title).toBe('Submission awaiting review');
      expect(forReviewer.actionUrl).toBe(`/quality/work-orders/${workOrderId}`);
      expect(forReviewer.isRead).toBe(false);
      const engineerSeesSubmitted = await api<Page>('/api/v1/notifications?limit=50', { token: engineer });
      expect(engineerSeesSubmitted.body.items.some((n) => n.workOrderId === workOrderId && n.type === 'QC_SUBMISSION_SUBMITTED')).toBe(false);

      // Reject: the engineer is told, with the reviewer's comment.
      const review = await api(`/api/v1/qc/submissions/${submitted.body.id}/review`, { method: 'POST', token: qc, body: { decision: 'REJECT_REWORK', comment: 'Label is crooked', itemReviews: [{ itemId, result: 'REJECTED' }] } });
      expect(review.status).toBe(201);
      const rework = await waitForNotification(engineer, workOrderId, 'QC_SUBMISSION_REJECTED');
      expect(rework.title).toBe('Rework required');
      expect(rework.body).toContain('Label is crooked');

      // Recipient isolation: the reviewer cannot read or mark the engineer's notification.
      expect((await api(`/api/v1/notifications/${rework.id}/read`, { method: 'POST', token: qc })).status).toBe(404);
      const reviewerPage = await api<Page>('/api/v1/notifications?limit=50', { token: qc });
      expect(reviewerPage.body.items.some((n) => n.id === rework.id)).toBe(false);

      // Read state: unread count drops by one and the row reads as read.
      const before = (await api<{ count: number }>('/api/v1/notifications/unread-count', { token: engineer })).body.count;
      expect((await api(`/api/v1/notifications/${rework.id}/read`, { method: 'POST', token: engineer })).status).toBe(204);
      expect((await api<{ count: number }>('/api/v1/notifications/unread-count', { token: engineer })).body.count).toBe(before - 1);
      expect((await api(`/api/v1/notifications/${rework.id}/read`, { method: 'POST', token: engineer })).status).toBe(204); // idempotent
      const unreadOnly = await api<Page>('/api/v1/notifications?unreadOnly=true&limit=50', { token: engineer });
      expect(unreadOnly.body.items.some((n) => n.id === rework.id)).toBe(false);
    } finally {
      await api(`/api/v1/users/${engineerId}/projects`, { method: 'DELETE', token: admin, body: scope });
      await api(`/api/v1/users/${qcId}/projects`, { method: 'DELETE', token: admin, body: scope });
    }
  }, 120_000);

  it('refuses a notification request with no token', async () => {
    expect((await api('/api/v1/notifications/unread-count')).status).toBe(401);
  });

  it('refuses the internal holders lookup from outside, even with the right shape', async () => {
    const res = await api('/api/v1/internal/authz/holders', { method: 'POST', body: { permission: 'qc_review.approve', projectId: uuidv7() } });
    expect([401, 403, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Typecheck the spec**

Run: `pnpm --filter e2e exec tsc --noEmit --module nodenext --moduleResolution nodenext --target es2023 --strict --skipLibCheck e2e/notifications.e2e.spec.ts` — if the e2e package has no tsconfig and this fails for tooling reasons, skip to the next step; vitest compiles it.

- [ ] **Step 3: Run it against the stack**

```bash
docker compose -f docker/docker-compose.yml up --build -d
pnpm --filter e2e exec vitest run notifications.e2e.spec.ts
```

Expected: 3 tests PASS. If the stack cannot be started here, do not claim this passed; hand it to the user with these two commands.

- [ ] **Step 4: Run the whole existing e2e suite for regressions**

Run: `pnpm --filter e2e exec vitest run`
Expected: PASS — in particular `qc-evidence.e2e.spec.ts`, which exercises the submit/review paths changed in Task 2.

- [ ] **Step 5: Run the repository-wide checks**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (testcontainers-based integration specs need Docker; list any that were skipped for that reason).

- [ ] **Step 6: Commit**

```bash
git add e2e
git commit -m "test(e2e): QC submit and review notify the right people" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** (spec section → task):

| Spec | Task |
|---|---|
| §3 payload changes | 1 (types), 2 (qc fills them) |
| §4.1 data model | 4 |
| §4.2 consumers, durables, failure behaviour | 1 (names), 7 |
| §4.3 API, own-data-only, no new permissions | 5, 6, 8 (permissions.ts comment) |
| §5.1-5.2 holders endpoint reusing `check()` | 3 |
| §5.3 service key | 3 (guard), 7 (client), 8 (env, compose, README) |
| §6 web | 9, 10 |
| §7 testing | each task; e2e in 11 |
| §8 risks | README rotation note (8) |

**Placeholder scan:** none; every step shows code or an exact command. Steps that depend on the Docker stack say what to report if it cannot be run.

**Type consistency:** `NewNotification` (Task 5) is what `content.ts` omits from and the consumer builds (Task 7). `QcSubmissionSubmitted`/`Reviewed` fields (Task 1) match the qc fact (Task 2), `content.ts` and the consumer's `hasLabels` (Task 7). `HoldersRequestSchema`/`HoldersResultSchema` (Task 1) are used by the IAM controller (Task 3) and the client (Task 7). `NOTIFICATION_DURABLES` strings equal `STREAMS.QC.durableConsumers` entries (Task 1). `NotificationPage`/`UnreadCount`/`NotificationDto` (Task 1) are produced by the service/controller (5, 6) and consumed by web (9, 10).

**Known risks to watch during execution:**
- Task 3's `check()` call passes `resource` with no `siteId`; a user holding only site scopes is excluded by design (spec §5.2).
- Task 2 reads `title`/`siteCode` from the `task` row `submit` already loads, and adds one `workOrder.findUnique` inside the review transaction (it replaces, not adds to, the existing one).
- Prisma's compound-unique accessor is not used, so `skipDuplicates` relies on the DB index created in Task 4's migration; confirm the migration is applied before the e2e run (`notification-migrate` does this in compose).
