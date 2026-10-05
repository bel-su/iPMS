# Finance Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the right people, in-app, at every step of a finance request: the next approver when something needs approval, Finance when payment is due, the requester on every outcome, and everyone involved when an advance or reimbursement is paid or a settlement is settled.

**Architecture:** A new `FinanceNotificationConsumer` in `apps/notification`, structured exactly like the existing `QcNotificationConsumer`: nine `DurableConsumer` subscriptions (one per `finance.*` subject, durables already declared in `STREAMS.FINANCE`), recipient lookup through the existing `IamDirectoryClient.holders(permission, projectId)`, rows written with `NotificationService.createMany` (idempotent on `(recipientId, eventId)`). Pure content builders live in their own file. No schema change: a finance notification sets `workOrderId` to `null` and deep-links through `actionUrl`.

**Tech Stack:** TypeScript, NestJS 12, Prisma 7 (notification DB, untouched), `@ipms/events` `DurableConsumer`, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-05-finance-service-design.md` §9 (Notifications). This is part 2 of 3; part 1 (backend) is merged on `kedar/finance-service`, part 3 (web UI) follows and must serve the route `/finance/requests/:id` that `actionUrl` points to.

## Global Constraints

- Subjects and payloads are exactly those in `libs/events/src/payloads/finance.ts` and `libs/events/src/subjects.ts` (9 subjects: submitted, approved_by_pm, approved, returned, rejected, cancelled, paid, `finance.settlement.settled`, `finance.advance.cash_returned`).
- Durable names (already in `STREAMS.FINANCE.durableConsumers`, one per subject): `notification-finance-submitted`, `-approved-by-pm`, `-approved`, `-returned`, `-rejected`, `-cancelled`, `-paid`, `-settled`, `-cash-returned`.
- Recipient rules (spec §9, plus decisions made during the backend build):

| Event | Recipients |
|---|---|
| `submitted` | holders of `finance_approval.pm` on the project if `nextStep === 'PM'`, else holders of `finance_approval.director`; never the requester or actor |
| `approved_by_pm` | holders of `finance_approval.director` |
| `approved` (Director) | holders of `finance_payment.record` ("payment due") and the requester ("approved, awaiting payment") |
| `returned`, `rejected` | the requester; wording names the acting `step` (`PM`, `DIRECTOR`, `FINANCE`) |
| `cancelled` | holders of the permission of the `heldBy` step, never the requester |
| `paid`, `settled` | the requester, `approvers.pmId` (when not null), `approvers.directorId`, and holders of `finance_payment.record`; never the acting payer |
| `cash_returned` | the requester |

- Idempotency lives in the database unique key `(recipientId, eventId)`; a redelivered event adds only what is missing. An IAM lookup failure must **throw** so JetStream redelivers; a lookup that finds nobody is logged and acknowledged.
- A payload missing `requestId`, `number` or `projectId` is skipped with a warning (not retried).
- Amounts are shown as `NPR` with two decimals and Indian digit grouping (`NPR 1,50,000.00`).
- `actionUrl` is `/finance/requests/<requestId>` for every finance notification.

## File Structure

```
libs/contracts/src/notification/notification.ts            modify: finance types in NOTIFICATION_TYPES
libs/contracts/src/notification/finance-types.spec.ts      create
apps/notification/src/events/finance-content.ts            create: pure content builders
apps/notification/src/events/finance-content.spec.ts       create
apps/notification/src/events/finance-notification.consumer.ts       create
apps/notification/src/events/finance-notification.consumer.spec.ts  create
apps/notification/src/app.module.ts                        modify: provider
apps/notification/src/app.module.spec.ts                   modify
docker/env/README.md                                       modify: one sentence
```

Conventions: run notification tests with `pnpm --filter notification exec vitest run <file>`; contracts with `pnpm --filter @ipms/contracts exec vitest run <file>`. Services consume libs from `dist`, so run `pnpm -r --filter "./libs/*" build` after Task 1. Stage files by explicit path only; never `git add -A`.

---

### Task 1: Notification types for finance

**Files:**
- Modify: `libs/contracts/src/notification/notification.ts:3-7` (the `NOTIFICATION_TYPES` tuple)
- Create: `libs/contracts/src/notification/finance-types.spec.ts`

**Interfaces:**
- Produces (added to `NOTIFICATION_TYPES`, so also to `NotificationType`): `FINANCE_APPROVAL_NEEDED`, `FINANCE_PAYMENT_DUE`, `FINANCE_REQUEST_APPROVED`, `FINANCE_REQUEST_RETURNED`, `FINANCE_REQUEST_REJECTED`, `FINANCE_REQUEST_CANCELLED`, `FINANCE_REQUEST_PAID`, `FINANCE_SETTLEMENT_SETTLED`, `FINANCE_CASH_RETURNED`.

- [ ] **Step 1: Write the failing test**

`libs/contracts/src/notification/finance-types.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from './notification.js';

const FINANCE_TYPES = [
  'FINANCE_APPROVAL_NEEDED', 'FINANCE_PAYMENT_DUE', 'FINANCE_REQUEST_APPROVED', 'FINANCE_REQUEST_RETURNED',
  'FINANCE_REQUEST_REJECTED', 'FINANCE_REQUEST_CANCELLED', 'FINANCE_REQUEST_PAID', 'FINANCE_SETTLEMENT_SETTLED',
  'FINANCE_CASH_RETURNED',
];

describe('finance notification types', () => {
  it('lists every type the finance consumer emits', () => {
    for (const type of FINANCE_TYPES) expect(NOTIFICATION_TYPES, type).toContain(type);
  });

  it('keeps the QC types and has no duplicates', () => {
    expect(NOTIFICATION_TYPES).toEqual(expect.arrayContaining(['QC_SUBMISSION_SUBMITTED', 'QC_SUBMISSION_APPROVED', 'QC_SUBMISSION_REJECTED']));
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @ipms/contracts exec vitest run src/notification/finance-types.spec.ts`
Expected: FAIL (`lists every type…` – types missing).

- [ ] **Step 3: Add the types**

Replace the `NOTIFICATION_TYPES` tuple in `libs/contracts/src/notification/notification.ts`:

```ts
export const NOTIFICATION_TYPES = [
  'QC_SUBMISSION_SUBMITTED',
  'QC_SUBMISSION_APPROVED',
  'QC_SUBMISSION_REJECTED',
  'FINANCE_APPROVAL_NEEDED',
  'FINANCE_PAYMENT_DUE',
  'FINANCE_REQUEST_APPROVED',
  'FINANCE_REQUEST_RETURNED',
  'FINANCE_REQUEST_REJECTED',
  'FINANCE_REQUEST_CANCELLED',
  'FINANCE_REQUEST_PAID',
  'FINANCE_SETTLEMENT_SETTLED',
  'FINANCE_CASH_RETURNED',
] as const;
```

- [ ] **Step 4: Run, rebuild libs, commit**

Run: `pnpm --filter @ipms/contracts exec vitest run && pnpm -r --filter "./libs/*" build`
Expected: PASS and a clean build.

```bash
git add libs/contracts/src/notification/notification.ts libs/contracts/src/notification/finance-types.spec.ts
git commit -m "feat(contracts): add finance notification types

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Finance notification content (pure)

**Files:**
- Create: `apps/notification/src/events/finance-content.ts`
- Create: `apps/notification/src/events/finance-content.spec.ts`

**Interfaces:**
- Consumes: `NotificationDraft` from `./content.js` (`Omit<NewNotification, 'recipientId' | 'eventId'>`), the payload types from `@ipms/events`.
- Produces (each returns a `NotificationDraft`):
  `approvalNeededContent(p: FinanceRequestSubmitted | FinanceRequestApprovedByPm)`,
  `paymentDueContent(p: FinanceRequestApproved)`,
  `approvedContent(p: FinanceRequestApproved)`,
  `returnedContent(p: FinanceRequestReturned)`,
  `rejectedContent(p: FinanceRequestRejected)`,
  `cancelledContent(p: FinanceRequestCancelled)`,
  `paidContent(p: FinanceRequestPaid)`,
  `settledContent(p: FinanceSettlementSettled)`,
  `cashReturnedContent(p: FinanceAdvanceCashReturned)`, and `formatNpr(amount: string): string`.

- [ ] **Step 1: Write the failing test**

`apps/notification/src/events/finance-content.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type {
  FinanceAdvanceCashReturned, FinanceRequestApproved, FinanceRequestCancelled, FinanceRequestPaid,
  FinanceRequestRejected, FinanceRequestReturned, FinanceRequestSubmitted, FinanceSettlementSettled,
} from '@ipms/events';
import {
  approvalNeededContent, approvedContent, cancelledContent, cashReturnedContent, formatNpr, paidContent,
  paymentDueContent, rejectedContent, returnedContent, settledContent,
} from './finance-content.js';

const base = {
  requestId: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE' as const, projectId: 'p-1', projectName: 'Koshi Rollout',
  requesterId: 'u-eng', requestedAmount: '50000.00', approvedAmount: '40000.00', actorId: 'u-actor',
  at: '2026-10-05T08:00:00Z', comment: null,
};
const URL = '/finance/requests/r-1';

describe('formatNpr', () => {
  it('uses two decimals and Indian digit grouping', () => {
    expect(formatNpr('150000')).toBe('NPR 1,50,000.00');
    expect(formatNpr('40000.5')).toBe('NPR 40,000.50');
    expect(formatNpr('0.05')).toBe('NPR 0.05');
  });
});

describe('finance notification content', () => {
  it('asks the next approver to act, naming the request and project', () => {
    const p: FinanceRequestSubmitted = { ...base, approvedAmount: null, nextStep: 'PM' };
    expect(approvalNeededContent(p)).toEqual({
      type: 'FINANCE_APPROVAL_NEEDED', title: 'Approval needed',
      body: 'Advance ADV-2026-0007 for Koshi Rollout (NPR 50,000.00) is waiting for your approval.',
      actionUrl: URL, workOrderId: null,
    });
  });

  it('tells Finance a request is ready to pay, with the approved amount', () => {
    const p: FinanceRequestApproved = { ...base };
    expect(paymentDueContent(p)).toMatchObject({
      type: 'FINANCE_PAYMENT_DUE', title: 'Payment due',
      body: 'Advance ADV-2026-0007 for Koshi Rollout is approved for NPR 40,000.00 and ready to pay.', actionUrl: URL,
    });
  });

  it('tells the requester it was approved, noting a reduced amount', () => {
    expect(approvedContent({ ...base })).toMatchObject({
      type: 'FINANCE_REQUEST_APPROVED',
      body: 'Your advance ADV-2026-0007 was approved for NPR 40,000.00 (you asked for NPR 50,000.00). It is waiting for payment.',
    });
    expect(approvedContent({ ...base, approvedAmount: '50000.00' }).body)
      .toBe('Your advance ADV-2026-0007 was approved for NPR 50,000.00. It is waiting for payment.');
  });

  it('names who returned or rejected it, with the reason', () => {
    const returned: FinanceRequestReturned = { ...base, approvedAmount: null, step: 'DIRECTOR', comment: 'Reduce the amount' };
    expect(returnedContent(returned)).toMatchObject({
      type: 'FINANCE_REQUEST_RETURNED', title: 'Request returned',
      body: 'Your advance ADV-2026-0007 was returned by the project director: Reduce the amount. Edit it and submit again.',
    });
    const rejected: FinanceRequestRejected = { ...base, approvedAmount: null, step: 'FINANCE', comment: 'Duplicate invoice' };
    expect(rejectedContent(rejected)).toMatchObject({
      type: 'FINANCE_REQUEST_REJECTED', body: 'Your advance ADV-2026-0007 was rejected by finance: Duplicate invoice.',
    });
  });

  it('says who was holding a cancelled request', () => {
    const p: FinanceRequestCancelled = { ...base, heldBy: 'PM', comment: 'No longer needed' };
    expect(cancelledContent(p)).toMatchObject({
      type: 'FINANCE_REQUEST_CANCELLED', title: 'Request cancelled',
      body: 'Advance ADV-2026-0007 for Koshi Rollout was cancelled by its requester while waiting for the project manager: No longer needed.',
    });
  });

  it('announces payment and settlement to everyone involved', () => {
    const paid: FinanceRequestPaid = { ...base, approvers: { pmId: 'u-pm', directorId: 'u-dir' }, paidAmount: '40000.00' };
    expect(paidContent(paid)).toMatchObject({
      type: 'FINANCE_REQUEST_PAID', title: 'Payment made',
      body: 'Advance ADV-2026-0007 for Koshi Rollout was paid: NPR 40,000.00.',
    });
    const settled: FinanceSettlementSettled = {
      ...base, kind: 'SETTLEMENT', number: 'SET-2026-0003', approvers: { pmId: null, directorId: 'u-dir' },
      advanceId: 'a-1', appliedAmount: '5000.00', payoutAmount: '2000.00',
    };
    expect(settledContent(settled)).toMatchObject({
      type: 'FINANCE_SETTLEMENT_SETTLED', title: 'Settlement completed',
      body: 'Settlement SET-2026-0003 for Koshi Rollout was settled: NPR 5,000.00 applied to the advance, NPR 2,000.00 paid out.',
    });
    expect(settledContent({ ...settled, payoutAmount: '0.00' }).body)
      .toBe('Settlement SET-2026-0003 for Koshi Rollout was settled: NPR 5,000.00 applied to the advance.');
  });

  it('tells the requester about returned cash and what is still outstanding', () => {
    const p: FinanceAdvanceCashReturned = { ...base, returnedAmount: '3000.00', outstandingAfter: '35000.00' };
    expect(cashReturnedContent(p)).toMatchObject({
      type: 'FINANCE_CASH_RETURNED', title: 'Cash return recorded',
      body: 'Finance recorded NPR 3,000.00 returned against advance ADV-2026-0007. NPR 35,000.00 is still outstanding.',
    });
    expect(cashReturnedContent({ ...p, outstandingAfter: '0.00' }).body)
      .toBe('Finance recorded NPR 3,000.00 returned against advance ADV-2026-0007. The advance is now fully settled.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter notification exec vitest run src/events/finance-content.spec.ts`
Expected: FAIL (cannot resolve `./finance-content.js`).

- [ ] **Step 3: Implement the builders**

`apps/notification/src/events/finance-content.ts`:

```ts
import type {
  FinanceAdvanceCashReturned, FinanceEventBase, FinanceRequestApproved, FinanceRequestApprovedByPm,
  FinanceRequestCancelled, FinanceRequestPaid, FinanceRequestRejected, FinanceRequestReturned,
  FinanceRequestSubmitted, FinanceSettlementSettled, FinanceStep,
} from '@ipms/events';
import type { NotificationDraft } from './content.js';

const KIND: Record<FinanceEventBase['kind'], string> = { ADVANCE: 'Advance', SETTLEMENT: 'Settlement', REIMBURSEMENT: 'Reimbursement' };
const STEP: Record<FinanceStep, string> = { PM: 'the project manager', DIRECTOR: 'the project director', FINANCE: 'finance' };

/** "NPR 1,50,000.00": two decimals, Indian digit grouping, as the company writes it. */
export function formatNpr(amount: string): string {
  return `NPR ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const urlFor = (p: FinanceEventBase): string => `/finance/requests/${p.requestId}`;
const subject = (p: FinanceEventBase): string => `${KIND[p.kind]} ${p.number}`;
const lowerSubject = (p: FinanceEventBase): string => `${KIND[p.kind].toLowerCase()} ${p.number}`;
const onProject = (p: FinanceEventBase): string => `${subject(p)} for ${p.projectName}`;
/** `: <comment>` when there is one; each template adds its own closing full stop. */
const reason = (comment: string | null): string => (comment ? `: ${comment}` : '');

function draft(p: FinanceEventBase, type: string, title: string, body: string): NotificationDraft {
  return { type, title, body, actionUrl: urlFor(p), workOrderId: null };
}

export function approvalNeededContent(p: FinanceRequestSubmitted | FinanceRequestApprovedByPm): NotificationDraft {
  return draft(p, 'FINANCE_APPROVAL_NEEDED', 'Approval needed',
    `${onProject(p)} (${formatNpr(p.requestedAmount)}) is waiting for your approval.`);
}

export function paymentDueContent(p: FinanceRequestApproved): NotificationDraft {
  return draft(p, 'FINANCE_PAYMENT_DUE', 'Payment due',
    `${onProject(p)} is approved for ${formatNpr(p.approvedAmount ?? p.requestedAmount)} and ready to pay.`);
}

export function approvedContent(p: FinanceRequestApproved): NotificationDraft {
  const approved = p.approvedAmount ?? p.requestedAmount;
  const reduced = approved !== p.requestedAmount;
  const amount = reduced ? `${formatNpr(approved)} (you asked for ${formatNpr(p.requestedAmount)})` : formatNpr(approved);
  return draft(p, 'FINANCE_REQUEST_APPROVED', 'Request approved',
    `Your ${lowerSubject(p)} was approved for ${amount}. It is waiting for payment.`);
}

export function returnedContent(p: FinanceRequestReturned): NotificationDraft {
  return draft(p, 'FINANCE_REQUEST_RETURNED', 'Request returned',
    `Your ${lowerSubject(p)} was returned by ${STEP[p.step]}${reason(p.comment)}. Edit it and submit again.`);
}

export function rejectedContent(p: FinanceRequestRejected): NotificationDraft {
  return draft(p, 'FINANCE_REQUEST_REJECTED', 'Request rejected',
    `Your ${lowerSubject(p)} was rejected by ${STEP[p.step]}${reason(p.comment)}.`);
}

export function cancelledContent(p: FinanceRequestCancelled): NotificationDraft {
  return draft(p, 'FINANCE_REQUEST_CANCELLED', 'Request cancelled',
    `${onProject(p)} was cancelled by its requester while waiting for ${STEP[p.heldBy]}${reason(p.comment)}.`);
}

export function paidContent(p: FinanceRequestPaid): NotificationDraft {
  return draft(p, 'FINANCE_REQUEST_PAID', 'Payment made', `${onProject(p)} was paid: ${formatNpr(p.paidAmount)}.`);
}

export function settledContent(p: FinanceSettlementSettled): NotificationDraft {
  const payout = Number(p.payoutAmount) > 0 ? `, ${formatNpr(p.payoutAmount)} paid out` : '';
  return draft(p, 'FINANCE_SETTLEMENT_SETTLED', 'Settlement completed',
    `${onProject(p)} was settled: ${formatNpr(p.appliedAmount)} applied to the advance${payout}.`);
}

export function cashReturnedContent(p: FinanceAdvanceCashReturned): NotificationDraft {
  const rest = Number(p.outstandingAfter) > 0
    ? `${formatNpr(p.outstandingAfter)} is still outstanding.`
    : 'The advance is now fully settled.';
  return draft(p, 'FINANCE_CASH_RETURNED', 'Cash return recorded',
    `Finance recorded ${formatNpr(p.returnedAmount)} returned against ${lowerSubject(p)}. ${rest}`);
}
```

- [ ] **Step 4: Run to verify it passes, commit**

Run: `pnpm --filter notification exec vitest run src/events/finance-content.spec.ts && pnpm --filter notification typecheck`
Expected: PASS, no type errors.

```bash
git add apps/notification/src/events/finance-content.ts apps/notification/src/events/finance-content.spec.ts
git commit -m "feat(notification): content for finance notifications

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: FinanceNotificationConsumer

**Files:**
- Create: `apps/notification/src/events/finance-notification.consumer.ts`
- Create: `apps/notification/src/events/finance-notification.consumer.spec.ts`

**Interfaces:**
- Consumes: `NotificationService.createMany(items: NewNotification[])`, `IamDirectoryClient.holders(permission, projectId, siteId?) → string[]`, `EventBus`, `DurableConsumer`, `InMemoryDedupeStore`, `SUBJECTS`, the content builders (Task 2).
- Produces: `class FinanceNotificationConsumer implements OnModuleInit { constructor(notifications, iam, bus); onModuleInit(); register(consumer); onSubmitted/onApprovedByPm/onApproved/onReturned/onRejected/onCancelled/onPaid/onSettled/onCashReturned(envelope) }`, `FINANCE_DURABLES`.

- [ ] **Step 1: Verify the one precondition (do not skip)**

Finance users are scoped globally, so the IAM `holders` lookup must return holders of a permission who have **global** scope, not only project-scoped ones. Run: `grep -n "holders" -A40 apps/iam/src/effective/effective.service.ts | head -80`.
Expected: the query includes users with a `userGlobalScope` row (or otherwise treats global scope as reaching every project). If it does **not**, stop and report BLOCKED: Finance would never be told a payment is due, and `EffectiveService.holders` must be fixed first (that is a change in `apps/iam`, outside this plan).

- [ ] **Step 2: Write the failing test**

`apps/notification/src/events/finance-notification.consumer.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@ipms/events';
import { FINANCE_DURABLES, FinanceNotificationConsumer } from './finance-notification.consumer.js';

const base = {
  requestId: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE' as const, projectId: 'p-1', projectName: 'Koshi Rollout',
  requesterId: 'u-eng', requestedAmount: '50000.00', approvedAmount: '40000.00', actorId: 'u-actor',
  at: '2026-10-05T08:00:00Z', comment: null,
};
const envelope = <T>(payload: T): EventEnvelope<T> => ({
  eventId: 'evt-1', subject: 'x', occurredAt: '2026-10-05T08:00:00Z', version: 1, correlationId: 'c-1', actorId: null, payload,
});

/** `holders` answers per permission, so a test can give each role its own people. */
function build(byPermission: Record<string, string[] | Error> = {}) {
  const notifications = { createMany: vi.fn().mockResolvedValue(1) };
  const iam = {
    holders: vi.fn(async (permission: string) => {
      const answer = byPermission[permission] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
  const consumer = new FinanceNotificationConsumer(notifications as never, iam as never, {} as never);
  const sent = () => notifications.createMany.mock.calls.flatMap((c) => c[0] as Array<{ recipientId: string; type: string; eventId: string }>);
  return { consumer, notifications, iam, sent };
}

describe('durables', () => {
  it('uses the durable names the FINANCE stream declares', () => {
    expect(Object.values(FINANCE_DURABLES).sort()).toEqual([
      'notification-finance-approved', 'notification-finance-approved-by-pm', 'notification-finance-cancelled',
      'notification-finance-cash-returned', 'notification-finance-paid', 'notification-finance-rejected',
      'notification-finance-returned', 'notification-finance-settled', 'notification-finance-submitted',
    ]);
  });
});

describe('onSubmitted', () => {
  it('asks the project managers when the next step is PM, never the requester or actor', async () => {
    const { consumer, iam, sent } = build({ 'finance_approval.pm': ['u-pm1', 'u-pm2', 'u-eng', 'u-actor', 'u-pm1'] });
    await consumer.onSubmitted(envelope({ ...base, approvedAmount: null, nextStep: 'PM' as const }));
    expect(iam.holders).toHaveBeenCalledWith('finance_approval.pm', 'p-1');
    expect(sent().map((r) => r.recipientId)).toEqual(['u-pm1', 'u-pm2']);
    expect(sent()[0]).toMatchObject({ type: 'FINANCE_APPROVAL_NEEDED', eventId: 'evt-1' });
  });

  it('asks the directors when a PM raised it', async () => {
    const { consumer, iam, sent } = build({ 'finance_approval.director': ['u-dir'] });
    await consumer.onSubmitted(envelope({ ...base, approvedAmount: null, nextStep: 'DIRECTOR' as const }));
    expect(iam.holders).toHaveBeenCalledWith('finance_approval.director', 'p-1');
    expect(sent().map((r) => r.recipientId)).toEqual(['u-dir']);
  });

  it('throws when iam is down, so the event is redelivered', async () => {
    const { consumer, notifications } = build({ 'finance_approval.pm': new Error('iam down') });
    await expect(consumer.onSubmitted(envelope({ ...base, approvedAmount: null, nextStep: 'PM' as const }))).rejects.toThrow('iam down');
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('acknowledges a project with nobody to ask instead of retrying', async () => {
    const { consumer, notifications } = build({ 'finance_approval.pm': ['u-eng'] });
    await expect(consumer.onSubmitted(envelope({ ...base, approvedAmount: null, nextStep: 'PM' as const }))).resolves.toBeUndefined();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('skips a malformed payload without calling iam', async () => {
    const { consumer, iam, notifications } = build();
    await expect(consumer.onSubmitted(envelope({ nextStep: 'PM' } as never))).resolves.toBeUndefined();
    expect(iam.holders).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });
});

describe('onApprovedByPm', () => {
  it('asks the directors', async () => {
    const { consumer, sent } = build({ 'finance_approval.director': ['u-dir1', 'u-dir2'] });
    await consumer.onApprovedByPm(envelope({ ...base, approvedAmount: null }));
    expect(sent().map((r) => r.recipientId)).toEqual(['u-dir1', 'u-dir2']);
    expect(sent()[0]?.type).toBe('FINANCE_APPROVAL_NEEDED');
  });
});

describe('onApproved', () => {
  it('tells Finance payment is due and the requester it was approved', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': ['u-fin1', 'u-fin2'] });
    await consumer.onApproved(envelope({ ...base }));
    const rows = sent();
    expect(rows.filter((r) => r.type === 'FINANCE_PAYMENT_DUE').map((r) => r.recipientId)).toEqual(['u-fin1', 'u-fin2']);
    expect(rows.filter((r) => r.type === 'FINANCE_REQUEST_APPROVED').map((r) => r.recipientId)).toEqual(['u-eng']);
  });

  it('still tells the requester when Finance has no holders', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': [] });
    await consumer.onApproved(envelope({ ...base }));
    expect(sent().map((r) => r.type)).toEqual(['FINANCE_REQUEST_APPROVED']);
  });

  it('writes nothing when the lookup fails, so a retry cannot half-notify', async () => {
    const { consumer, notifications } = build({ 'finance_payment.record': new Error('iam down') });
    await expect(consumer.onApproved(envelope({ ...base }))).rejects.toThrow('iam down');
    expect(notifications.createMany).not.toHaveBeenCalled();
  });
});

describe('onReturned and onRejected', () => {
  it('tells only the requester, without calling iam', async () => {
    const { consumer, iam, sent } = build();
    await consumer.onReturned(envelope({ ...base, approvedAmount: null, step: 'PM' as const, comment: 'Add the quotation' }));
    await consumer.onRejected(envelope({ ...base, approvedAmount: null, step: 'FINANCE' as const, comment: 'Duplicate' }));
    expect(sent().map((r) => [r.recipientId, r.type])).toEqual([['u-eng', 'FINANCE_REQUEST_RETURNED'], ['u-eng', 'FINANCE_REQUEST_REJECTED']]);
    expect(iam.holders).not.toHaveBeenCalled();
  });
});

describe('onCancelled', () => {
  it.each([
    ['PM', 'finance_approval.pm'],
    ['DIRECTOR', 'finance_approval.director'],
    ['FINANCE', 'finance_payment.record'],
  ] as const)('tells the holders of the %s step', async (heldBy, permission) => {
    const { consumer, iam, sent } = build({ [permission]: ['u-holder', 'u-eng'] });
    await consumer.onCancelled(envelope({ ...base, heldBy }));
    expect(iam.holders).toHaveBeenCalledWith(permission, 'p-1');
    expect(sent().map((r) => r.recipientId)).toEqual(['u-holder']);
  });
});

describe('onPaid and onSettled', () => {
  const paid = { ...base, approvers: { pmId: 'u-pm', directorId: 'u-dir' }, paidAmount: '40000.00' };

  it('tells the requester, both approvers and Finance, once each, but not the payer', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': ['u-fin1', 'u-actor', 'u-dir'] });
    await consumer.onPaid(envelope(paid));
    expect(sent().map((r) => r.recipientId).sort()).toEqual(['u-dir', 'u-eng', 'u-fin1', 'u-pm']);
    expect(sent().every((r) => r.type === 'FINANCE_REQUEST_PAID')).toBe(true);
  });

  it('skips the PM when a PM raised the request', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': [] });
    await consumer.onPaid(envelope({ ...paid, approvers: { pmId: null, directorId: 'u-dir' } }));
    expect(sent().map((r) => r.recipientId).sort()).toEqual(['u-dir', 'u-eng']);
  });

  it('announces a settlement the same way', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': ['u-fin1'] });
    await consumer.onSettled(envelope({
      ...base, kind: 'SETTLEMENT' as const, number: 'SET-2026-0003', approvers: { pmId: 'u-pm', directorId: 'u-dir' },
      advanceId: 'a-1', appliedAmount: '5000.00', payoutAmount: '0.00',
    }));
    expect(sent().map((r) => r.recipientId).sort()).toEqual(['u-dir', 'u-eng', 'u-fin1', 'u-pm']);
    expect(sent()[0]?.type).toBe('FINANCE_SETTLEMENT_SETTLED');
  });
});

describe('onCashReturned', () => {
  it('tells the requester', async () => {
    const { consumer, sent } = build();
    await consumer.onCashReturned(envelope({ ...base, returnedAmount: '3000.00', outstandingAfter: '35000.00' }));
    expect(sent().map((r) => [r.recipientId, r.type])).toEqual([['u-eng', 'FINANCE_CASH_RETURNED']]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter notification exec vitest run src/events/finance-notification.consumer.spec.ts`
Expected: FAIL (cannot resolve `./finance-notification.consumer.js`).

- [ ] **Step 4: Implement the consumer**

`apps/notification/src/events/finance-notification.consumer.ts`:

```ts
import type { OnModuleInit } from '@nestjs/common';
import {
  DurableConsumer, InMemoryDedupeStore, SUBJECTS,
  type EventBus, type EventEnvelope, type FinanceAdvanceCashReturned, type FinanceEventBase,
  type FinanceRequestApproved, type FinanceRequestApprovedByPm, type FinanceRequestCancelled, type FinanceRequestPaid,
  type FinanceRequestRejected, type FinanceRequestReturned, type FinanceRequestSubmitted, type FinanceSettlementSettled,
  type FinanceStep,
} from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { IamDirectoryClient } from '../directory/iam-directory.client.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { NotificationDraft } from './content.js';
import {
  approvalNeededContent, approvedContent, cancelledContent, cashReturnedContent, paidContent, paymentDueContent,
  rejectedContent, returnedContent, settledContent,
} from './finance-content.js';

const log = createLogger('notification');

/** Must match `STREAMS.FINANCE.durableConsumers`. One durable per subject: a durable carries a single filter_subject. */
export const FINANCE_DURABLES = {
  submitted: 'notification-finance-submitted',
  approvedByPm: 'notification-finance-approved-by-pm',
  approved: 'notification-finance-approved',
  returned: 'notification-finance-returned',
  rejected: 'notification-finance-rejected',
  cancelled: 'notification-finance-cancelled',
  paid: 'notification-finance-paid',
  settled: 'notification-finance-settled',
  cashReturned: 'notification-finance-cash-returned',
} as const;

/** The permission whose holders act at each step; the same table finance itself uses. */
const STEP_PERMISSION: Record<FinanceStep, string> = {
  PM: 'finance_approval.pm',
  DIRECTOR: 'finance_approval.director',
  FINANCE: 'finance_payment.record',
};

const unique = (ids: Array<string | null | undefined>): string[] => [...new Set(ids.filter((id): id is string => typeof id === 'string'))];

/** An event missing what every finance notification needs cannot be fixed by retrying, so it is skipped. */
const hasFacts = (p: Partial<FinanceEventBase>): p is FinanceEventBase =>
  typeof p.requestId === 'string' && typeof p.number === 'string' && typeof p.projectId === 'string';

/**
 * Turns finance request facts into in-app notifications.
 *
 * Every handler resolves all of its recipients first, then writes: an IAM
 * failure throws before anything is stored, so JetStream redelivers the whole
 * event. Idempotency lives in the database (unique `(recipientId, eventId)`).
 */
export class FinanceNotificationConsumer implements OnModuleInit {
  constructor(
    private readonly notifications: NotificationService,
    private readonly iam: IamDirectoryClient,
    private readonly bus: EventBus,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.register(new DurableConsumer(this.bus, new InMemoryDedupeStore()));
    log.info('finance notification consumers started');
  }

  async register(consumer: DurableConsumer): Promise<void> {
    const subscribe = <T>(subject: string, durable: string, handler: (e: EventEnvelope<T>) => Promise<void>) =>
      consumer.subscribe<T>(subject, durable, handler);
    await subscribe<FinanceRequestSubmitted>(SUBJECTS.FINANCE_REQUEST_SUBMITTED, FINANCE_DURABLES.submitted, (e) => this.onSubmitted(e));
    await subscribe<FinanceRequestApprovedByPm>(SUBJECTS.FINANCE_REQUEST_APPROVED_BY_PM, FINANCE_DURABLES.approvedByPm, (e) => this.onApprovedByPm(e));
    await subscribe<FinanceRequestApproved>(SUBJECTS.FINANCE_REQUEST_APPROVED, FINANCE_DURABLES.approved, (e) => this.onApproved(e));
    await subscribe<FinanceRequestReturned>(SUBJECTS.FINANCE_REQUEST_RETURNED, FINANCE_DURABLES.returned, (e) => this.onReturned(e));
    await subscribe<FinanceRequestRejected>(SUBJECTS.FINANCE_REQUEST_REJECTED, FINANCE_DURABLES.rejected, (e) => this.onRejected(e));
    await subscribe<FinanceRequestCancelled>(SUBJECTS.FINANCE_REQUEST_CANCELLED, FINANCE_DURABLES.cancelled, (e) => this.onCancelled(e));
    await subscribe<FinanceRequestPaid>(SUBJECTS.FINANCE_REQUEST_PAID, FINANCE_DURABLES.paid, (e) => this.onPaid(e));
    await subscribe<FinanceSettlementSettled>(SUBJECTS.FINANCE_SETTLEMENT_SETTLED, FINANCE_DURABLES.settled, (e) => this.onSettled(e));
    await subscribe<FinanceAdvanceCashReturned>(SUBJECTS.FINANCE_ADVANCE_CASH_RETURNED, FINANCE_DURABLES.cashReturned, (e) => this.onCashReturned(e));
  }

  /** The next approver: PMs normally, directors when a PM raised the request. */
  async onSubmitted(envelope: EventEnvelope<FinanceRequestSubmitted>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    const step: FinanceStep = p.nextStep === 'DIRECTOR' ? 'DIRECTOR' : 'PM';
    await this.send(envelope, await this.holders(step, p, [p.requesterId, p.actorId]), approvalNeededContent(p));
  }

  async onApprovedByPm(envelope: EventEnvelope<FinanceRequestApprovedByPm>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    await this.send(envelope, await this.holders('DIRECTOR', p, [p.requesterId, p.actorId]), approvalNeededContent(p));
  }

  /** The director approved: Finance has a payment to make, and the requester has an answer. */
  async onApproved(envelope: EventEnvelope<FinanceRequestApproved>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    const finance = await this.holders('FINANCE', p, [p.requesterId, p.actorId]);
    await this.send(envelope, finance, paymentDueContent(p));
    await this.send(envelope, [p.requesterId], approvedContent(p));
  }

  async onReturned(envelope: EventEnvelope<FinanceRequestReturned>): Promise<void> {
    const p = envelope.payload;
    if (this.accept(envelope, p)) await this.send(envelope, [p.requesterId], returnedContent(p));
  }

  async onRejected(envelope: EventEnvelope<FinanceRequestRejected>): Promise<void> {
    const p = envelope.payload;
    if (this.accept(envelope, p)) await this.send(envelope, [p.requesterId], rejectedContent(p));
  }

  /** Whoever was holding the request, so they can take it off their list. */
  async onCancelled(envelope: EventEnvelope<FinanceRequestCancelled>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    await this.send(envelope, await this.holders(p.heldBy, p, [p.requesterId, p.actorId]), cancelledContent(p));
  }

  async onPaid(envelope: EventEnvelope<FinanceRequestPaid>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    await this.send(envelope, await this.involved(p, p.approvers), paidContent(p));
  }

  async onSettled(envelope: EventEnvelope<FinanceSettlementSettled>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    await this.send(envelope, await this.involved(p, p.approvers), settledContent(p));
  }

  async onCashReturned(envelope: EventEnvelope<FinanceAdvanceCashReturned>): Promise<void> {
    const p = envelope.payload;
    if (this.accept(envelope, p)) await this.send(envelope, [p.requesterId], cashReturnedContent(p));
  }

  private accept(envelope: EventEnvelope<unknown>, payload: Partial<FinanceEventBase>): payload is FinanceEventBase {
    if (hasFacts(payload)) return true;
    log.warn({ eventId: envelope.eventId, subject: envelope.subject }, 'finance event missing request facts, skipped');
    return false;
  }

  /** People holding the step's permission on the project, minus anyone excluded. Throws if iam is unreachable. */
  private async holders(step: FinanceStep, p: FinanceEventBase, exclude: string[]): Promise<string[]> {
    const ids = await this.iam.holders(STEP_PERMISSION[step], p.projectId);
    return unique(ids).filter((id) => !exclude.includes(id));
  }

  /** Everyone involved in a completed payment: requester, approvers and Finance, never the person who paid. */
  private async involved(p: FinanceEventBase, approvers: { pmId: string | null; directorId: string }): Promise<string[]> {
    const finance = await this.holders('FINANCE', p, []);
    return unique([p.requesterId, approvers.pmId, approvers.directorId, ...finance]).filter((id) => id !== p.actorId);
  }

  private async send(envelope: EventEnvelope<unknown>, recipients: string[], content: NotificationDraft): Promise<void> {
    if (recipients.length === 0) {
      log.warn({ eventId: envelope.eventId, subject: envelope.subject }, 'no recipients for finance notification');
      return;
    }
    await this.notifications.createMany(recipients.map((recipientId) => ({ recipientId, eventId: envelope.eventId, ...content })));
  }
}
```

- [ ] **Step 5: Run to verify it passes, commit**

Run: `pnpm --filter notification exec vitest run src/events/finance-notification.consumer.spec.ts && pnpm --filter notification typecheck`
Expected: PASS, no type errors.

```bash
git add apps/notification/src/events/finance-notification.consumer.ts apps/notification/src/events/finance-notification.consumer.spec.ts
git commit -m "feat(notification): consume finance events into in-app notifications

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the consumer in and document it

**Files:**
- Modify: `apps/notification/src/app.module.ts` (imports + a provider after `QcNotificationConsumer`)
- Modify: `apps/notification/src/app.module.spec.ts`
- Modify: `docker/env/README.md` (the Notification Service row)

**Interfaces:**
- Consumes: `FinanceNotificationConsumer` (Task 3), the existing `NotificationService`, `IamDirectoryClient`, `EventBus` providers.

- [ ] **Step 1: Write the failing test**

In `apps/notification/src/app.module.spec.ts` add an import `import { FinanceNotificationConsumer } from './events/finance-notification.consumer.js';` and, inside the existing top-level `describe` (where the other provider assertions live), a test that mirrors the one the file already has for `QcNotificationConsumer` (open the file and copy its exact shape; it asserts the module's `providers` include a provider whose `provide` is the consumer class, with the same `inject` list). For reference the assertion is:

```ts
  it('registers the finance notification consumer with the services it needs', () => {
    const provider = providers.filter(isClassProvider).find((p) => p.provide === FinanceNotificationConsumer) as
      { inject?: unknown[] } | undefined;
    expect(provider).toBeDefined();
    expect(provider?.inject).toEqual([NotificationService, IamDirectoryClient, EventBus]);
  });
```

(Import `IamDirectoryClient` from `./directory/iam-directory.client.js` and `EventBus` from `@ipms/events` if the file does not already.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter notification exec vitest run src/app.module.spec.ts`
Expected: FAIL (`registers the finance notification consumer…`).

- [ ] **Step 3: Register the provider**

In `apps/notification/src/app.module.ts` add the import next to the `QcNotificationConsumer` import:

```ts
import { FinanceNotificationConsumer } from './events/finance-notification.consumer.js';
```

and add this provider right after the `QcNotificationConsumer` provider:

```ts
    {
      provide: FinanceNotificationConsumer,
      useFactory: (notifications: NotificationService, iam: IamDirectoryClient, bus: EventBus): FinanceNotificationConsumer =>
        new FinanceNotificationConsumer(notifications, iam, bus),
      inject: [NotificationService, IamDirectoryClient, EventBus],
    },
```

- [ ] **Step 4: Update the README row**

In `docker/env/README.md`, in the **Notification Service** row replace `Consumes qc submission events from NATS` with `Consumes qc submission and finance request events from NATS`.

- [ ] **Step 5: Run the whole notification suite, typecheck, build, commit**

Run: `pnpm --filter notification exec vitest run && pnpm --filter notification typecheck && pnpm --filter notification build`
Expected: all PASS, no type errors, build succeeds.

```bash
git add apps/notification/src/app.module.ts apps/notification/src/app.module.spec.ts docker/env/README.md
git commit -m "feat(notification): run the finance notification consumer

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Smoke test against the running stack (best effort)**

The notification container needs the new code, so rebuild only that service: `docker compose -f docker/docker-compose.yml up -d --build --no-deps notification` (never `down`, never recreate other services). Then, with the finance backend also running (`docker compose -f docker/docker-compose.yml up -d --build --no-deps postgres-finance finance-migrate finance`), submit a request as the demo engineer through the gateway (rebuild/restart `gateway` the same way first so it serves `/api/v1/finance`) and confirm a notification row appears for the demo manager: `curl` the notifications list with the manager's token, or query `notification` rows in the notification database. Report whether it ran and what was seen; if the stack cannot be brought up, say so rather than skipping silently.

---

## Self-Review

**Spec coverage (spec §9):** submitted → next approver (Task 3 `onSubmitted`, PM vs Director via `nextStep`); approved_by_pm → directors (`onApprovedByPm`); approved → Finance + requester (`onApproved`); returned/rejected → requester with the acting step (`onReturned`/`onRejected`, wording in Task 2); cancelled → holders of the `heldBy` step (`onCancelled`); paid and settled → requester, approving PM and Director, Finance, never the payer (`involved`); cash returned → requester (`onCashReturned`). One durable per subject, idempotent by `(recipientId, eventId)`, IAM failure throws.

**Placeholder scan:** none. Task 4 Step 1 tells the engineer to mirror the existing `QcNotificationConsumer` provider assertion and shows the exact assertion to add.

**Type consistency:** payload types and field names (`nextStep`, `step`, `heldBy`, `approvers`, `paidAmount`, `appliedAmount`, `payoutAmount`, `returnedAmount`, `outstandingAfter`) match `libs/events/src/payloads/finance.ts`; durable names match `STREAMS.FINANCE`; builder and handler names are used identically across Tasks 2-4.

**Known assumption to verify at execution:** `EffectiveService.holders` returns holders with global scope (Task 3 Step 1 checks it and blocks if not).
