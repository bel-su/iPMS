# Finance Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The finance workflow in the Axiom web app: engineers and PMs raise advances, reimbursements and settlements; PMs, Directors and Finance act on what is waiting for them; everyone sees status and history; Finance maintains categories and reads the spend report. Directors and Finance land on a finance workspace.

**Architecture:** Server-rendered Next.js pages under `apps/web/app/finance/**` that read through a new server-only `lib/finance-api.ts` (a thin wrapper over `authFetch`, like `work-order-api.ts`), and Server Actions that turn form posts into API calls and report back through `settle()` / `FormState`. Rules about which buttons to show live in a pure, tested `finance/model.ts`; the service remains the only enforcement. No new design system: reuse `Sidebar`, `TopActions`, `StatePage`, the `panel`/`toolbar`/`form-grid`/`field` classes and `SubmitButton`/`FormError`/`RowAction`.

**Tech Stack:** Next.js 16 (App Router, React 19 Server Components + Server Actions), TypeScript, vitest (node env), the gateway at `/api/v1/finance/*`.

**Spec:** `docs/superpowers/specs/2026-10-05-finance-service-design.md` §8. Parts 1 (backend) and 2 (notifications) are done on branch `kedar/finance-service`. Notifications deep-link to `/finance/requests/<id>`, so that route must exist (Task 7).

## Global Constraints

- Money is NPR. Amounts are two-decimal **strings** end to end; the UI displays `NPR 1,50,000.00` (Indian grouping) and never does float arithmetic on balances. Form input like `1,50,000.5` is normalised to `150000.50` before sending; more than two decimals is rejected in the UI.
- Routes: `/finance` (workspace), `/finance/new`, `/finance/requests/[id]`, `/finance/requests/[id]/edit`, `/finance/categories`, `/finance/reports`; plus `GET /api/finance/report` (xlsx download). All server-rendered behind the existing session.
- API paths used (all through the gateway): `GET/POST /api/v1/finance/requests`, `GET/PATCH /api/v1/finance/requests/:id`, `POST …/submit|cancel|approve|return|reject|pay`, `GET /api/v1/finance/advances/:id`, `POST /api/v1/finance/advances/:id/cash-return`, `GET/POST /api/v1/finance/categories`, `PATCH …/categories/:id`, `GET /api/v1/finance/reports/project-spend`.
- Visibility and actions follow the service rules; the UI only **hides** buttons (`hasPermission` is "for hiding controls, never for enforcement"): requester edits/submits drafts and returned requests and cancels pending ones; PM acts at `PENDING_PM` (`finance_approval.pm`), Director at `PENDING_DIRECTOR` (`finance_approval.director`, may lower the amount), Finance at `PENDING_FINANCE` (`finance_payment.record`: pay, return, reject) and records cash returns on a paid advance. Nobody acts on their own request, and nobody who already approved an earlier step of the current revision acts on a later one. Return and reject need a comment.
- A request raised by a PM enters at the Director step; Directors and Finance never raise requests (no "New request" for them).
- Invoice file and payment proof are **optional in this release** (Task 1 makes `mediaId` optional in the backend); real file upload is a follow-up that needs a finance-document category in the media service. Do not build an upload control; show attachments only if a `mediaId` is present (as "File attached").
- Who-is-who: names come from `listUserDirectory()` (needs `task.view`, which Directors and Finance hold); an unknown id is shown as the short id.
- Home pages: `PROJECT_DIRECTOR` and `FINANCE` land on `/finance?view=awaiting`. The sample "cash advances"/"request advance" panels and the `/#cash-advances` / `/#request-advance` links are removed for everyone and replaced by real finance links.
- Web conventions: `import 'server-only'` in API modules; Server Actions in `'use server'` files; client forms use `useActionStateWithToast(action, EMPTY, 'Toast text')`; tests are vitest `*.spec.ts(x)` next to the code; run with `pnpm --filter web exec vitest run <file>`; typecheck with `pnpm --filter web typecheck`; lint with `pnpm --filter web lint`.

## File Structure

```
libs/contracts/src/finance/finance.ts, finance.spec.ts      modify (Task 1): mediaId optional
apps/finance/prisma/schema.prisma + new migration            modify/create (Task 1)
apps/finance/src/requests/request.service.ts (+ spec)        modify (Task 1)
apps/web/app/lib/finance-api.ts, finance-api.spec.ts         create (Task 2)
apps/web/app/finance/model.ts, model.spec.ts                 create (Task 3): pure view rules
apps/web/app/finance/form.ts, form.spec.ts                   create (Task 4): money + invoice-row parsing
apps/web/app/finance/actions.ts, actions.spec.ts             create (Task 4): Server Actions
apps/web/app/finance/layout.tsx, finance.css                 create (Task 5)
apps/web/app/finance/page.tsx, requests-table.tsx            create (Task 5)
apps/web/app/finance/new/page.tsx, request-form.tsx          create (Task 6)
apps/web/app/finance/requests/[id]/page.tsx, panels.tsx      create (Task 7)
apps/web/app/finance/requests/[id]/edit/page.tsx             create (Task 6)
apps/web/app/finance/categories/page.tsx, forms.tsx          create (Task 8)
apps/web/app/finance/reports/page.tsx                        create (Task 8)
apps/web/app/api/finance/report/route.ts                     create (Task 8)
apps/web/app/shell.tsx, overview/*, page.tsx                 modify (Task 9): nav, homes, remove placeholders
```

Conventions for every task: stage files by explicit path, never `git add -A`; commit messages end with a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Make the invoice file and payment proof optional (backend)

**Files:**
- Modify: `libs/contracts/src/finance/finance.ts` (`InvoiceInputSchema`), `libs/contracts/src/finance/finance.spec.ts`
- Modify: `apps/finance/prisma/schema.prisma` (`RequestInvoice.mediaId`)
- Create: `apps/finance/prisma/migrations/20261007000100_invoice_media_optional/migration.sql`
- Modify: `apps/finance/src/requests/request.service.ts` (`writeInvoices`), `apps/finance/src/requests/request.service.integration.spec.ts`

**Interfaces:** `InvoiceInput.mediaId` becomes `string | undefined`; stored `mediaId` is `string | null`. `PaymentDetailsDto.proofMediaId` is already optional.

- [ ] **Step 1: Write the failing tests**

In `libs/contracts/src/finance/finance.spec.ts` add (inside the `CreateRequestSchema` describe):

```ts
  it('takes an invoice with no file attached yet', () => {
    const { mediaId: _omitted, ...withoutFile } = invoice;
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'REIMBURSEMENT', projectId: uuidv7(), invoices: [withoutFile] }).success).toBe(true);
  });
```

In `apps/finance/src/requests/request.service.integration.spec.ts` add inside `describe('create')`:

```ts
  it('stores an invoice that has no file attached', async () => {
    const { mediaId: _omitted, ...bare } = invoice('120');
    const r = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [bare] }, ACTORS.engineer, scopes.project, PROJECT);
    expect(r.invoices?.[0]).toMatchObject({ vendor: 'Himal Fuel', mediaId: null });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @ipms/contracts exec vitest run src/finance/finance.spec.ts` (FAIL: the schema still demands `mediaId`).

- [ ] **Step 3: Implement**

`libs/contracts/src/finance/finance.ts`, in `InvoiceInputSchema` replace the `mediaId` field and its comment:

```ts
  /** The uploaded invoice scan or photo, held by the media service. Optional until finance documents can be uploaded. */
  mediaId: UuidSchema.optional(),
```

`apps/finance/prisma/schema.prisma`, `RequestInvoice`: change `mediaId String @db.Uuid` to `mediaId String? @db.Uuid`.

Create `apps/finance/prisma/migrations/20261007000100_invoice_media_optional/migration.sql`:

```sql
-- Invoice files are optional until finance documents can be uploaded through the media service.
ALTER TABLE "request_invoice" ALTER COLUMN "mediaId" DROP NOT NULL;
```

`apps/finance/src/requests/request.service.ts`, in `writeInvoices` change `mediaId: i.mediaId` to `mediaId: i.mediaId ?? null`.

- [ ] **Step 4: Regenerate, run, commit**

Run:
```bash
DATABASE_URL=postgresql://x:x@localhost:5432/x pnpm --filter finance exec prisma generate
pnpm --filter @ipms/contracts exec vitest run && pnpm -r --filter "./libs/*" build
pnpm --filter finance exec vitest run src/requests/request.service.integration.spec.ts prisma/schema.integration.spec.ts
pnpm --filter finance typecheck
```
Expected: all PASS, no type errors (fix any place that assumed a non-null `mediaId`).

```bash
git add libs/contracts/src/finance apps/finance/prisma/schema.prisma apps/finance/prisma/migrations/20261007000100_invoice_media_optional apps/finance/src/requests
git commit -m "feat(finance): make invoice files optional until finance documents exist

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Finance API module for the web

**Files:**
- Create: `apps/web/app/lib/finance-api.ts`
- Create: `apps/web/app/lib/finance-api.spec.ts`

**Interfaces:** all functions return `Promise<ApiResult<…>>`. Wire types are written as the wire sees them (money and dates are strings).

- [ ] **Step 1: Write the failing test**

`apps/web/app/lib/finance-api.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));

const api = await import('./finance-api');

beforeEach(() => { authFetch.mockClear(); });

const INVOICE = { vendor: 'Himal Fuel', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '1500.50' };
const PAY = { mode: 'BANK_TRANSFER' as const, reference: 'TXN-1', paidOn: '2026-10-05' };

/** Finance is its own service, reached through the gateway's `/api/v1/finance` prefix and nothing else. */
const CALLS: { name: string; call: () => Promise<unknown>; path: string; method?: string; json?: unknown; query?: Record<string, string | undefined> }[] = [
  { name: 'listRequests', call: () => api.listRequests({ view: 'awaiting', page: 2 }), path: '/api/v1/finance/requests', query: { view: 'awaiting', status: undefined, kind: undefined, projectId: undefined, page: '2', limit: undefined } },
  { name: 'getRequest', call: () => api.getRequest('r-1'), path: '/api/v1/finance/requests/r-1' },
  { name: 'getAdvance', call: () => api.getAdvance('a-1'), path: '/api/v1/finance/advances/a-1' },
  { name: 'createRequest', call: () => api.createRequest({ kind: 'REIMBURSEMENT', projectId: 'p-1', categoryId: 'c-1', purpose: 'Fuel', invoices: [INVOICE] }), path: '/api/v1/finance/requests', method: 'POST', json: { kind: 'REIMBURSEMENT', projectId: 'p-1', categoryId: 'c-1', purpose: 'Fuel', invoices: [INVOICE] } },
  { name: 'updateRequest', call: () => api.updateRequest('r-1', { purpose: 'More fuel' }), path: '/api/v1/finance/requests/r-1', method: 'PATCH', json: { purpose: 'More fuel' } },
  { name: 'submitRequest', call: () => api.submitRequest('r-1'), path: '/api/v1/finance/requests/r-1/submit', method: 'POST' },
  { name: 'cancelRequest', call: () => api.cancelRequest('r-1', 'No longer needed'), path: '/api/v1/finance/requests/r-1/cancel', method: 'POST', json: { comment: 'No longer needed' } },
  { name: 'cancelRequest without a reason', call: () => api.cancelRequest('r-1'), path: '/api/v1/finance/requests/r-1/cancel', method: 'POST', json: {} },
  { name: 'approveRequest', call: () => api.approveRequest('r-1', { amount: '40000.00' }), path: '/api/v1/finance/requests/r-1/approve', method: 'POST', json: { amount: '40000.00' } },
  { name: 'returnRequest', call: () => api.returnRequest('r-1', 'Add the quotation'), path: '/api/v1/finance/requests/r-1/return', method: 'POST', json: { comment: 'Add the quotation' } },
  { name: 'rejectRequest', call: () => api.rejectRequest('r-1', 'Not in budget'), path: '/api/v1/finance/requests/r-1/reject', method: 'POST', json: { comment: 'Not in budget' } },
  { name: 'payRequest', call: () => api.payRequest('r-1', PAY), path: '/api/v1/finance/requests/r-1/pay', method: 'POST', json: PAY },
  { name: 'returnCash', call: () => api.returnCash('a-1', { ...PAY, amount: '3000.00' }), path: '/api/v1/finance/advances/a-1/cash-return', method: 'POST', json: { ...PAY, amount: '3000.00' } },
  { name: 'listCategories', call: () => api.listCategories(), path: '/api/v1/finance/categories' },
  { name: 'createCategory', call: () => api.createCategory({ code: 'PERMITS', name: 'Permits' }), path: '/api/v1/finance/categories', method: 'POST', json: { code: 'PERMITS', name: 'Permits' } },
  { name: 'updateCategory', call: () => api.updateCategory('c-1', { disabled: true }), path: '/api/v1/finance/categories/c-1', method: 'PATCH', json: { disabled: true } },
  { name: 'spendReport', call: () => api.spendReport({ groupBy: 'category', from: '2026-10-01' }), path: '/api/v1/finance/reports/project-spend', query: { groupBy: 'category', projectId: undefined, from: '2026-10-01', to: undefined, format: 'json' } },
];

describe('finance-api: every call maps to a finance route', () => {
  for (const { name, call, path, method, json, query } of CALLS) {
    it(`${name} calls ${method ?? 'GET'} ${path}`, async () => {
      await call();
      const [actualPath, request] = authFetch.mock.calls[0]!;
      expect(actualPath).toBe(path);
      expect(request?.method).toBe(method);
      expect(request?.json).toEqual(json);
      if (query) expect(request?.query).toEqual(query);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run app/lib/finance-api.spec.ts`
Expected: FAIL (cannot resolve `./finance-api`).

- [ ] **Step 3: Implement**

`apps/web/app/lib/finance-api.ts`:

```ts
import 'server-only';
import type { RequestKind, RequestStatus } from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * Finance: advances, settlements and reimbursements with a PM → Director →
 * Finance approval. The finance service owns them; the gateway's
 * `/api/v1/finance` prefix reaches it. Wire shapes: money is a two-decimal
 * string, dates are ISO strings. The service decides what the caller may see
 * and do; these functions only carry the request.
 */

export type { RequestKind, RequestStatus };
export type PaymentMode = 'BANK_TRANSFER' | 'CASH' | 'CHEQUE' | 'MOBILE_WALLET';
export type FinanceStep = 'REQUESTER' | 'PM' | 'DIRECTOR' | 'FINANCE';

export interface FinanceRequest {
  id: string; number: string; kind: RequestKind; status: RequestStatus; revision: number; entryStatus: string | null;
  projectId: string; projectCode: string; projectName: string; workOrderId: string | null;
  categoryId: string; requesterId: string; advanceId: string | null; purpose: string;
  requestedAmount: string; approvedAmount: string | null; appliedAmount: string | null;
  submittedAt: string | null; createdAt: string; updatedAt: string;
  category?: { code: string; name: string };
}

export interface RequestInvoice {
  id: string; requestId: string; vendor: string; invoiceNumber: string; invoiceDate: string; amount: string; mediaId: string | null;
}
export interface ApprovalAction {
  id: string; requestId: string; revision: number; step: FinanceStep; action: string; actorId: string;
  amount: string | null; comment: string | null; at: string;
}
export interface Payment {
  id: string; requestId: string; kind: 'PAYOUT' | 'CASH_RETURN'; mode: PaymentMode; reference: string; paidOn: string;
  amount: string; note: string | null; proofMediaId: string | null; recordedBy: string; createdAt: string;
}
export interface AdvanceBalance {
  paid: string; applied: string; cashReturned: string; outstanding: string; status: 'PAID' | 'PARTIALLY_SETTLED' | 'CLOSED';
}
export type FinanceRequestDetail = FinanceRequest & {
  invoices: RequestInvoice[]; actions: ApprovalAction[]; payments: Payment[]; balance?: AdvanceBalance;
};
export interface AdvanceView { advance: FinanceRequest; balance: AdvanceBalance | null; settlements: FinanceRequest[] }
export interface RequestPage { items: FinanceRequest[]; total: number; page: number; limit: number }
export interface ExpenseCategory { id: string; code: string; name: string; disabledAt: string | null; createdAt: string }
export interface SpendRow {
  key: string; label: string; advancesPaid: string; applied: string; cashReturned: string; outstanding: string;
  reimbursed: string; settled: string; expense: string;
}

export type RequestView = 'mine' | 'awaiting' | 'all';
export interface RequestFilter {
  view?: RequestView | undefined; status?: RequestStatus | undefined; kind?: RequestKind | undefined;
  projectId?: string | undefined; page?: number | undefined; limit?: number | undefined;
}

/** Invoice rows as a form sends them: the date is a `YYYY-MM-DD` string, the amount a two-decimal string. */
export interface InvoiceInput { vendor: string; invoiceNumber: string; invoiceDate: string; amount: string; mediaId?: string }

export type CreateRequestInput =
  | { kind: 'ADVANCE'; projectId: string; categoryId: string; purpose: string; amount: string; workOrderId?: string }
  | { kind: 'REIMBURSEMENT'; projectId: string; categoryId: string; purpose: string; invoices: InvoiceInput[]; workOrderId?: string }
  | { kind: 'SETTLEMENT'; advanceId: string; categoryId: string; purpose: string; invoices: InvoiceInput[]; workOrderId?: string };

export interface UpdateRequestInput {
  categoryId?: string; purpose?: string; workOrderId?: string | null; amount?: string; invoices?: InvoiceInput[];
}
export interface PaymentInput { mode: PaymentMode; reference: string; paidOn: string; note?: string }
export interface SpendQuery { groupBy?: 'project' | 'category' | 'requester'; projectId?: string; from?: string; to?: string }

const BASE = '/api/v1/finance';

export function listRequests(filter: RequestFilter = {}): Promise<ApiResult<RequestPage>> {
  return authFetch<RequestPage>(`${BASE}/requests`, {
    query: {
      view: filter.view, status: filter.status, kind: filter.kind, projectId: filter.projectId,
      page: filter.page === undefined ? undefined : String(filter.page),
      limit: filter.limit === undefined ? undefined : String(filter.limit),
    },
  });
}

export const getRequest = (id: string): Promise<ApiResult<FinanceRequestDetail>> => authFetch(`${BASE}/requests/${id}`);
export const getAdvance = (id: string): Promise<ApiResult<AdvanceView>> => authFetch(`${BASE}/advances/${id}`);

export const createRequest = (input: CreateRequestInput): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests`, { method: 'POST', json: input });
export const updateRequest = (id: string, input: UpdateRequestInput): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}`, { method: 'PATCH', json: input });
export const submitRequest = (id: string): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/submit`, { method: 'POST' });
export const cancelRequest = (id: string, comment?: string): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/cancel`, { method: 'POST', json: comment ? { comment } : {} });

export const approveRequest = (id: string, body: { amount?: string; comment?: string }): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/approve`, { method: 'POST', json: body });
export const returnRequest = (id: string, comment: string): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/return`, { method: 'POST', json: { comment } });
export const rejectRequest = (id: string, comment: string): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/reject`, { method: 'POST', json: { comment } });

export const payRequest = (id: string, body: Partial<PaymentInput>): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/pay`, { method: 'POST', json: body });
export const returnCash = (advanceId: string, body: PaymentInput & { amount: string }): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/advances/${advanceId}/cash-return`, { method: 'POST', json: body });

export const listCategories = (): Promise<ApiResult<ExpenseCategory[]>> => authFetch(`${BASE}/categories`);
export const createCategory = (input: { code: string; name: string }): Promise<ApiResult<ExpenseCategory>> =>
  authFetch(`${BASE}/categories`, { method: 'POST', json: input });
export const updateCategory = (id: string, input: { name?: string; disabled?: boolean }): Promise<ApiResult<ExpenseCategory>> =>
  authFetch(`${BASE}/categories/${id}`, { method: 'PATCH', json: input });

export function spendReport(query: SpendQuery = {}): Promise<ApiResult<SpendRow[]>> {
  return authFetch<SpendRow[]>(`${BASE}/reports/project-spend`, {
    query: { groupBy: query.groupBy, projectId: query.projectId, from: query.from, to: query.to, format: 'json' },
  });
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `pnpm --filter web exec vitest run app/lib/finance-api.spec.ts && pnpm --filter web typecheck`
Expected: PASS, no type errors.

```bash
git add apps/web/app/lib/finance-api.ts apps/web/app/lib/finance-api.spec.ts
git commit -m "feat(web): finance API module

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: View rules (pure model)

**Files:**
- Create: `apps/web/app/finance/model.ts`, `apps/web/app/finance/model.spec.ts`

**Interfaces (produces):** `KIND_LABEL`, `STATUS_LABEL`, `STATUS_TONE`, `STEP_LABEL`, `ACTION_LABEL`, `formatMoney(amount: string | null): string`, `personName(id, names): string`, `waitingOn(status): string | null`, `Viewer`, `RequestAction`, `availableActions(request, viewer, approvedEarlier): RequestAction[]`, `describeEntry(entry): string`, `isSettleable(request): boolean`.

- [ ] **Step 1: Write the failing test**

`apps/web/app/finance/model.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { availableActions, describeEntry, formatMoney, personName, waitingOn, type Viewer } from './model';

const ENG: Viewer = { id: 'u-eng', permissions: ['finance_request.view', 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit'] };
const PM: Viewer = { id: 'u-pm', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit', 'finance_approval.pm'] };
const DIR: Viewer = { id: 'u-dir', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_approval.director'] };
const FIN: Viewer = { id: 'u-fin', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_payment.record', 'finance_category.manage'] };

const req = (over: Partial<{ status: string; kind: string; requesterId: string }> = {}) =>
  ({ status: 'DRAFT', kind: 'ADVANCE', requesterId: 'u-eng', ...over }) as never;

describe('formatMoney', () => {
  it('uses NPR with two decimals and Indian grouping', () => {
    expect(formatMoney('150000')).toBe('NPR 1,50,000.00');
    expect(formatMoney('40000.5')).toBe('NPR 40,000.50');
    expect(formatMoney(null)).toBe('—');
  });
});

describe('personName', () => {
  it('prefers a known name and otherwise shows a short id', () => {
    expect(personName('u-1', new Map([['u-1', 'Sita Rai']]))).toBe('Sita Rai');
    expect(personName('0193a8c2-1111-7222-8333-444455556666', new Map())).toBe('0193a8c2…');
  });
});

describe('waitingOn', () => {
  it('names who is holding a pending request', () => {
    expect(waitingOn('PENDING_PM')).toBe('Waiting for the project manager');
    expect(waitingOn('PENDING_DIRECTOR')).toBe('Waiting for the project director');
    expect(waitingOn('PENDING_FINANCE')).toBe('Waiting for finance to pay');
    expect(waitingOn('PAID')).toBeNull();
  });
});

describe('availableActions: the requester', () => {
  it('edits and submits a draft or returned request, and cancels a pending one', () => {
    expect(availableActions(req({ status: 'DRAFT' }), ENG, [])).toEqual(['edit', 'submit']);
    expect(availableActions(req({ status: 'RETURNED' }), ENG, [])).toEqual(['edit', 'submit']);
    expect(availableActions(req({ status: 'PENDING_PM' }), ENG, [])).toEqual(['cancel']);
    expect(availableActions(req({ status: 'PENDING_FINANCE' }), ENG, [])).toEqual(['cancel']);
    expect(availableActions(req({ status: 'REJECTED' }), ENG, [])).toEqual([]);
  });

  it('settles a paid advance, but only with the settlement permission', () => {
    expect(availableActions(req({ status: 'PAID' }), ENG, [])).toEqual(['settle']);
    expect(availableActions(req({ status: 'PAID' }), { id: 'u-eng', permissions: ['finance_request.view'] }, [])).toEqual([]);
    expect(availableActions(req({ status: 'PAID', kind: 'REIMBURSEMENT' }), ENG, [])).toEqual([]);
  });

  it('does not let the owner of someone else\'s request edit it', () => {
    expect(availableActions(req({ status: 'DRAFT', requesterId: 'u-other' }), ENG, [])).toEqual([]);
  });
});

describe('availableActions: approvers and Finance', () => {
  it('lets the PM act at PENDING_PM only, never on their own request', () => {
    expect(availableActions(req({ status: 'PENDING_PM' }), PM, [])).toEqual(['approve', 'return', 'reject']);
    expect(availableActions(req({ status: 'PENDING_DIRECTOR' }), PM, [])).toEqual([]);
    expect(availableActions(req({ status: 'PENDING_PM', requesterId: 'u-pm' }), PM, [])).toEqual(['cancel']);
  });

  it('lets the Director act at PENDING_DIRECTOR', () => {
    expect(availableActions(req({ status: 'PENDING_DIRECTOR' }), DIR, [])).toEqual(['approve', 'return', 'reject']);
    expect(availableActions(req({ status: 'PENDING_PM' }), DIR, [])).toEqual([]);
  });

  it('lets Finance pay, return or reject at PENDING_FINANCE, and record cash returns on a paid advance', () => {
    expect(availableActions(req({ status: 'PENDING_FINANCE' }), FIN, [])).toEqual(['pay', 'return', 'reject']);
    expect(availableActions(req({ status: 'PAID' }), FIN, [])).toEqual(['cashReturn']);
    expect(availableActions(req({ status: 'PAID', kind: 'REIMBURSEMENT' }), FIN, [])).toEqual([]);
  });

  it('hides a later step from someone who already approved an earlier one in this revision', () => {
    const both: Viewer = { id: 'u-both', permissions: [...PM.permissions, 'finance_approval.director'] };
    expect(availableActions(req({ status: 'PENDING_DIRECTOR' }), both, ['u-both'])).toEqual([]);
    expect(availableActions(req({ status: 'PENDING_DIRECTOR' }), both, [])).toEqual(['approve', 'return', 'reject']);
  });
});

describe('describeEntry', () => {
  it('turns a history row into a sentence fragment', () => {
    expect(describeEntry({ step: 'REQUESTER', action: 'SUBMITTED' })).toBe('Submitted');
    expect(describeEntry({ step: 'PM', action: 'APPROVED' })).toBe('Approved by the project manager');
    expect(describeEntry({ step: 'DIRECTOR', action: 'RETURNED' })).toBe('Returned by the project director');
    expect(describeEntry({ step: 'FINANCE', action: 'REJECTED' })).toBe('Rejected by finance');
    expect(describeEntry({ step: 'FINANCE', action: 'PAID' })).toBe('Paid by finance');
    expect(describeEntry({ step: 'FINANCE', action: 'CASH_RETURNED' })).toBe('Cash return recorded by finance');
    expect(describeEntry({ step: 'REQUESTER', action: 'CANCELLED' })).toBe('Cancelled');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run app/finance/model.spec.ts`
Expected: FAIL (cannot resolve `./model`).

- [ ] **Step 3: Implement**

`apps/web/app/finance/model.ts`:

```ts
import type { FinanceRequest, FinanceStep } from '../lib/finance-api';

/** What the finance screens show and which buttons they offer. Pure, so it is testable; the service enforces every rule again. */

export const KIND_LABEL: Record<FinanceRequest['kind'], string> = { ADVANCE: 'Advance', SETTLEMENT: 'Settlement', REIMBURSEMENT: 'Reimbursement' };

export const STATUS_LABEL: Record<FinanceRequest['status'], string> = {
  DRAFT: 'Draft', PENDING_PM: 'With project manager', PENDING_DIRECTOR: 'With project director', PENDING_FINANCE: 'Ready to pay',
  PAID: 'Paid', SETTLED: 'Settled', RETURNED: 'Returned', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'slate';
export const STATUS_TONE: Record<FinanceRequest['status'], Tone> = {
  DRAFT: 'slate', PENDING_PM: 'amber', PENDING_DIRECTOR: 'amber', PENDING_FINANCE: 'blue',
  PAID: 'green', SETTLED: 'green', RETURNED: 'red', REJECTED: 'red', CANCELLED: 'slate',
};

const STEP_NAME: Record<FinanceStep, string> = {
  REQUESTER: '', PM: 'the project manager', DIRECTOR: 'the project director', FINANCE: 'finance',
};
export const STEP_LABEL = STEP_NAME;

/** "NPR 1,50,000.00": two decimals, Indian grouping. A missing amount is a dash. */
export function formatMoney(amount: string | null): string {
  if (amount === null) return '—';
  return `NPR ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A known person's name, otherwise the front of their id. */
export function personName(id: string, names: ReadonlyMap<string, string>): string {
  return names.get(id) ?? `${id.slice(0, 8)}…`;
}

export function waitingOn(status: FinanceRequest['status']): string | null {
  switch (status) {
    case 'PENDING_PM': return 'Waiting for the project manager';
    case 'PENDING_DIRECTOR': return 'Waiting for the project director';
    case 'PENDING_FINANCE': return 'Waiting for finance to pay';
    default: return null;
  }
}

export interface Viewer { id: string; permissions: readonly string[] }
export type RequestAction = 'edit' | 'submit' | 'cancel' | 'approve' | 'return' | 'reject' | 'pay' | 'settle' | 'cashReturn';

const PENDING = new Set(['PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE']);

/** An advance that has been paid can be settled and can take returned cash. */
export const isSettleable = (request: Pick<FinanceRequest, 'kind' | 'status'>): boolean => request.kind === 'ADVANCE' && request.status === 'PAID';

/**
 * The buttons to offer, in display order.
 *
 * `approvedEarlier` is the ids of everyone who approved an earlier step of the
 * request's current revision: the service refuses them a later step, so the
 * button is not offered. Hiding is a courtesy; the service is the gate.
 */
export function availableActions(
  request: Pick<FinanceRequest, 'status' | 'kind' | 'requesterId'>,
  viewer: Viewer,
  approvedEarlier: readonly string[],
): RequestAction[] {
  const can = (permission: string): boolean => viewer.permissions.includes(permission);

  if (request.requesterId === viewer.id) {
    if (request.status === 'DRAFT' || request.status === 'RETURNED') return ['edit', 'submit'];
    if (PENDING.has(request.status)) return ['cancel'];
    if (isSettleable(request) && can('finance_settlement.submit')) return ['settle'];
    return [];
  }

  if (approvedEarlier.includes(viewer.id)) return [];
  if (request.status === 'PENDING_PM' && can('finance_approval.pm')) return ['approve', 'return', 'reject'];
  if (request.status === 'PENDING_DIRECTOR' && can('finance_approval.director')) return ['approve', 'return', 'reject'];
  if (request.status === 'PENDING_FINANCE' && can('finance_payment.record')) return ['pay', 'return', 'reject'];
  if (isSettleable(request) && can('finance_payment.record')) return ['cashReturn'];
  return [];
}

const VERB: Record<string, string> = { APPROVED: 'Approved', RETURNED: 'Returned', REJECTED: 'Rejected', PAID: 'Paid' };

/** One row of the history as a phrase: "Approved by the project manager". */
export function describeEntry(entry: { step: FinanceStep; action: string }): string {
  if (entry.action === 'SUBMITTED') return 'Submitted';
  if (entry.action === 'CANCELLED') return 'Cancelled';
  if (entry.action === 'CASH_RETURNED') return 'Cash return recorded by finance';
  return `${VERB[entry.action] ?? entry.action} by ${STEP_NAME[entry.step]}`;
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `pnpm --filter web exec vitest run app/finance/model.spec.ts && pnpm --filter web typecheck`
Expected: PASS, no type errors.

```bash
git add apps/web/app/finance/model.ts apps/web/app/finance/model.spec.ts
git commit -m "feat(web): finance view rules

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Form parsing and Server Actions

**Files:**
- Create: `apps/web/app/finance/form.ts`, `apps/web/app/finance/form.spec.ts`
- Create: `apps/web/app/finance/actions.ts`, `apps/web/app/finance/actions.spec.ts`

**Interfaces (produces):**
- `form.ts`: `parseMoney(text: string | undefined): string | null`, `parseInvoices(form: FormData): { invoices: InvoiceInput[] } | { error: string }`.
- `actions.ts` (all `(previous: FormState, form: FormData) => Promise<FormState>`): `saveRequestAction`, `submitAction`, `cancelAction`, `approveAction`, `returnAction`, `rejectAction`, `payAction`, `cashReturnAction`, `createCategoryAction`, `updateCategoryAction`.

- [ ] **Step 1: Write the failing tests for the parsers**

`apps/web/app/finance/form.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseInvoices, parseMoney } from './form';

const form = (rows: Array<[string, string, string, string]>) => {
  const data = new FormData();
  for (const [vendor, number, date, amount] of rows) {
    data.append('invoiceVendor', vendor); data.append('invoiceNumber', number);
    data.append('invoiceDate', date); data.append('invoiceAmount', amount);
  }
  return data;
};

describe('parseMoney', () => {
  it.each([
    ['1500', '1500.00'], ['1,50,000.5', '150000.50'], [' 40000.25 ', '40000.25'], ['0.5', '0.50'], ['7.', '7.00'],
  ])('reads %s as %s', (input, expected) => expect(parseMoney(input)).toBe(expected));

  it.each(['', '  ', 'abc', '-5', '0', '0.00', '1.234', '12e3', undefined])('refuses %s', (input) => expect(parseMoney(input as never)).toBeNull());
});

describe('parseInvoices', () => {
  it('reads aligned rows into invoices with normalised amounts', () => {
    expect(parseInvoices(form([['Himal Fuel', 'I-1', '2026-10-01', '1,500.5'], ['Sajha Hardware', 'I-2', '2026-10-02', '250']]))).toEqual({
      invoices: [
        { vendor: 'Himal Fuel', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '1500.50' },
        { vendor: 'Sajha Hardware', invoiceNumber: 'I-2', invoiceDate: '2026-10-02', amount: '250.00' },
      ],
    });
  });

  it('ignores a completely empty row and trims fields', () => {
    expect(parseInvoices(form([['  Himal Fuel ', ' I-1 ', '2026-10-01', '100'], ['', '', '', '']]))).toEqual({
      invoices: [{ vendor: 'Himal Fuel', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '100.00' }],
    });
  });

  it('asks for at least one invoice', () => {
    expect(parseInvoices(form([['', '', '', '']]))).toEqual({ error: 'Add at least one invoice.' });
  });

  it('names the row and the problem when an invoice is incomplete or its amount is wrong', () => {
    expect(parseInvoices(form([['Himal Fuel', '', '2026-10-01', '100']]))).toEqual({ error: 'Invoice 1: enter the vendor, invoice number, date and amount.' });
    expect(parseInvoices(form([['A', '1', '2026-10-01', '100'], ['B', '2', '2026-10-01', '1.234']]))).toEqual({ error: 'Invoice 2: enter an amount in NPR with at most two decimals.' });
    expect(parseInvoices(form([['A', '1', 'not-a-date', '100']]))).toEqual({ error: 'Invoice 1: enter a valid date.' });
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement `form.ts`**

Run: `pnpm --filter web exec vitest run app/finance/form.spec.ts` — Expected: FAIL (cannot resolve `./form`).

`apps/web/app/finance/form.ts`:

```ts
import type { InvoiceInput } from '../lib/finance-api';

/** "1,50,000.5" -> "150000.50". Null for anything that is not a positive amount with at most two decimals. */
export function parseMoney(text: string | undefined): string | null {
  if (text === undefined) return null;
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const normalised = `${whole.replace(/^0+(?=\d)/, '')}.${(fraction + '00').slice(0, 2)}`;
  return Number(normalised) > 0 ? normalised : null;
}

const field = (form: FormData, name: string): string[] => form.getAll(name).map((value) => String(value).trim());
const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());

/**
 * Invoice rows arrive as four aligned lists (one entry per row). A row left
 * entirely blank is ignored, so the empty spare row a form shows is harmless.
 */
export function parseInvoices(form: FormData): { invoices: InvoiceInput[] } | { error: string } {
  const vendors = field(form, 'invoiceVendor');
  const numbers = field(form, 'invoiceNumber');
  const dates = field(form, 'invoiceDate');
  const amounts = field(form, 'invoiceAmount');
  const invoices: InvoiceInput[] = [];

  for (let i = 0; i < vendors.length; i += 1) {
    const [vendor = '', invoiceNumber = '', invoiceDate = '', rawAmount = ''] = [vendors[i], numbers[i], dates[i], amounts[i]];
    if (!vendor && !invoiceNumber && !invoiceDate && !rawAmount) continue;
    const row = `Invoice ${i + 1}`;
    if (!vendor || !invoiceNumber || !invoiceDate || !rawAmount) return { error: `${row}: enter the vendor, invoice number, date and amount.` };
    if (!validDate(invoiceDate)) return { error: `${row}: enter a valid date.` };
    const amount = parseMoney(rawAmount);
    if (amount === null) return { error: `${row}: enter an amount in NPR with at most two decimals.` };
    invoices.push({ vendor, invoiceNumber, invoiceDate, amount });
  }
  return invoices.length === 0 ? { error: 'Add at least one invoice.' } : { invoices };
}
```

Run again — Expected: PASS.

- [ ] **Step 3: Write the failing tests for the actions**

`apps/web/app/finance/actions.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const ready = (data: unknown = {}) => ({ state: 'ready' as const, data });
const api = {
  createRequest: vi.fn(), updateRequest: vi.fn(), submitRequest: vi.fn(), cancelRequest: vi.fn(),
  approveRequest: vi.fn(), returnRequest: vi.fn(), rejectRequest: vi.fn(), payRequest: vi.fn(), returnCash: vi.fn(),
  createCategory: vi.fn(), updateCategory: vi.fn(),
};
vi.mock('../lib/finance-api', () => api);

const actions = await import('./actions');
const EMPTY = {};
const form = (entries: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) for (const one of Array.isArray(value) ? value : [value]) data.append(key, one);
  return data;
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue(ready({ id: 'r-1' }));
  revalidatePath.mockClear(); redirect.mockClear();
});

describe('saveRequestAction', () => {
  const advance = { kind: 'ADVANCE', projectId: 'p-1', categoryId: 'c-1', purpose: 'Site travel', amount: '50,000' };

  it('creates an advance as a draft and opens it', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, intent: 'draft' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-1');
    expect(api.createRequest).toHaveBeenCalledWith({ kind: 'ADVANCE', projectId: 'p-1', categoryId: 'c-1', purpose: 'Site travel', amount: '50000.00' });
    expect(api.submitRequest).not.toHaveBeenCalled();
  });

  it('submits straight away when asked to', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, intent: 'submit' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-1');
    expect(api.submitRequest).toHaveBeenCalledWith('r-1');
  });

  it('creates a settlement against an advance from its invoice rows', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({
      kind: 'SETTLEMENT', advanceId: 'a-1', categoryId: 'c-1', purpose: 'Bills', intent: 'draft',
      invoiceVendor: ['V'], invoiceNumber: ['I-1'], invoiceDate: ['2026-10-01'], invoiceAmount: ['1,200'],
    }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.createRequest).toHaveBeenCalledWith({
      kind: 'SETTLEMENT', advanceId: 'a-1', categoryId: 'c-1', purpose: 'Bills',
      invoices: [{ vendor: 'V', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '1200.00' }],
    });
  });

  it('updates an existing request instead of creating one', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, id: 'r-9', intent: 'draft' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-9');
    expect(api.updateRequest).toHaveBeenCalledWith('r-9', { categoryId: 'c-1', purpose: 'Site travel', amount: '50000.00' });
    expect(api.createRequest).not.toHaveBeenCalled();
  });

  it('explains what is missing instead of calling the API', async () => {
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, amount: 'abc', intent: 'draft' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, purpose: '  ', intent: 'draft' }))).toEqual({ error: 'Say what the money is for.' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, categoryId: '', intent: 'draft' }))).toEqual({ error: 'Choose a category.' });
    expect(await actions.saveRequestAction(EMPTY, form({ kind: 'REIMBURSEMENT', projectId: 'p-1', categoryId: 'c-1', purpose: 'Fuel', intent: 'draft' }))).toEqual({ error: 'Add at least one invoice.' });
    expect(api.createRequest).not.toHaveBeenCalled();
  });

  it('shows the service message when it refuses', async () => {
    api.createRequest.mockResolvedValue({ state: 'forbidden', message: 'You do not have access to this project' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, intent: 'draft' }))).toEqual({ error: 'You do not have access to this project' });
  });
});

describe('request actions', () => {
  it('submits and cancels, refreshing the workspace and the request page', async () => {
    expect(await actions.submitAction(EMPTY, form({ id: 'r-1' }))).toEqual(EMPTY);
    expect(api.submitRequest).toHaveBeenCalledWith('r-1');
    expect(revalidatePath).toHaveBeenCalledWith('/finance');
    expect(revalidatePath).toHaveBeenCalledWith('/finance/requests/r-1');
    await actions.cancelAction(EMPTY, form({ id: 'r-1', comment: 'Not needed' }));
    expect(api.cancelRequest).toHaveBeenCalledWith('r-1', 'Not needed');
  });

  it('approves, with an amount only when one was typed', async () => {
    await actions.approveAction(EMPTY, form({ id: 'r-1', amount: '40,000', comment: 'Cut travel days' }));
    expect(api.approveRequest).toHaveBeenCalledWith('r-1', { amount: '40000.00', comment: 'Cut travel days' });
    await actions.approveAction(EMPTY, form({ id: 'r-1', amount: '', comment: '' }));
    expect(api.approveRequest).toHaveBeenLastCalledWith('r-1', {});
    expect(await actions.approveAction(EMPTY, form({ id: 'r-1', amount: '1.234' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
  });

  it('requires a reason to return or reject', async () => {
    expect(await actions.returnAction(EMPTY, form({ id: 'r-1', comment: '  ' }))).toEqual({ error: 'Say why.' });
    expect(await actions.rejectAction(EMPTY, form({ id: 'r-1', comment: '' }))).toEqual({ error: 'Say why.' });
    expect(api.returnRequest).not.toHaveBeenCalled();
    await actions.returnAction(EMPTY, form({ id: 'r-1', comment: 'Add the quotation' }));
    expect(api.returnRequest).toHaveBeenCalledWith('r-1', 'Add the quotation');
    await actions.rejectAction(EMPTY, form({ id: 'r-1', comment: 'Not in budget' }));
    expect(api.rejectRequest).toHaveBeenCalledWith('r-1', 'Not in budget');
  });
});

describe('payment actions', () => {
  it('pays with the payment details', async () => {
    await actions.payAction(EMPTY, form({ id: 'r-1', mode: 'BANK_TRANSFER', reference: 'TXN-1', paidOn: '2026-10-05', note: 'NIC Asia' }));
    expect(api.payRequest).toHaveBeenCalledWith('r-1', { mode: 'BANK_TRANSFER', reference: 'TXN-1', paidOn: '2026-10-05', note: 'NIC Asia' });
  });

  it('sends nothing for blank details so a settlement without a payout can be confirmed', async () => {
    await actions.payAction(EMPTY, form({ id: 's-1', mode: '', reference: '', paidOn: '', note: '' }));
    expect(api.payRequest).toHaveBeenCalledWith('s-1', {});
  });

  it('refuses a payment mode it does not know', async () => {
    expect(await actions.payAction(EMPTY, form({ id: 'r-1', mode: 'BITCOIN', reference: 'x', paidOn: '2026-10-05' }))).toEqual({ error: 'Choose how it was paid.' });
  });

  it('records returned cash against an advance', async () => {
    await actions.cashReturnAction(EMPTY, form({ id: 'a-1', amount: '3,000', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' }));
    expect(api.returnCash).toHaveBeenCalledWith('a-1', { amount: '3000.00', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' });
    expect(await actions.cashReturnAction(EMPTY, form({ id: 'a-1', amount: '', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
  });
});

describe('category actions', () => {
  it('creates a category from an upper-cased code and renames or disables one', async () => {
    await actions.createCategoryAction(EMPTY, form({ code: 'permits', name: 'Permits' }));
    expect(api.createCategory).toHaveBeenCalledWith({ code: 'PERMITS', name: 'Permits' });
    expect(revalidatePath).toHaveBeenCalledWith('/finance/categories');
    await actions.updateCategoryAction(EMPTY, form({ id: 'c-1', disabled: 'true' }));
    expect(api.updateCategory).toHaveBeenCalledWith('c-1', { disabled: true });
    await actions.updateCategoryAction(EMPTY, form({ id: 'c-1', name: 'Permits and fees' }));
    expect(api.updateCategory).toHaveBeenLastCalledWith('c-1', { name: 'Permits and fees' });
  });
});
```

- [ ] **Step 4: Run to verify it fails, then implement `actions.ts`**

Run: `pnpm --filter web exec vitest run app/finance/actions.spec.ts` — Expected: FAIL (cannot resolve `./actions`).

`apps/web/app/finance/actions.ts`:

```ts
'use server';
import { redirect } from 'next/navigation';
import {
  approveRequest, cancelRequest, createCategory, createRequest, payRequest, rejectRequest, returnCash, returnRequest,
  submitRequest, updateCategory, updateRequest,
  type CreateRequestInput, type PaymentInput, type PaymentMode, type UpdateRequestInput,
} from '../lib/finance-api';
import type { FormState } from '../lib/form-state';
import { optional, settle } from '../lib/settle';
import { parseInvoices, parseMoney } from './form';

const MONEY_ERROR = 'Enter an amount in NPR with at most two decimals.';
const MODES: readonly PaymentMode[] = ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'MOBILE_WALLET'];
const isMode = (value: string | undefined): value is PaymentMode => value !== undefined && (MODES as readonly string[]).includes(value);

/** Every page a change to one request shows on: the workspace and the request itself. */
const pages = (id: string): string[] => ['/finance', `/finance/requests/${id}`];

/**
 * Creates or edits a request and, when asked, submits it. `id` present means
 * edit. The kind and project of an existing request never change, so an edit
 * sends only what the service allows to change.
 */
export async function saveRequestAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = optional(form, 'id');
  const kind = optional(form, 'kind');
  const categoryId = optional(form, 'categoryId');
  const purpose = optional(form, 'purpose');
  const workOrderId = optional(form, 'workOrderId');
  const submit = optional(form, 'intent') === 'submit';

  if (!categoryId) return { error: 'Choose a category.' };
  if (!purpose) return { error: 'Say what the money is for.' };
  if (kind !== 'ADVANCE' && kind !== 'REIMBURSEMENT' && kind !== 'SETTLEMENT') return { error: 'Choose what you are asking for.' };

  let create: CreateRequestInput | undefined;
  let change: UpdateRequestInput | undefined;

  if (kind === 'ADVANCE') {
    const amount = parseMoney(optional(form, 'amount'));
    if (amount === null) return { error: MONEY_ERROR };
    const projectId = optional(form, 'projectId');
    if (!id && !projectId) return { error: 'Choose a project.' };
    if (id) change = { categoryId, purpose, amount };
    else create = { kind, projectId: projectId!, categoryId, purpose, amount, ...(workOrderId ? { workOrderId } : {}) };
  } else {
    const parsed = parseInvoices(form);
    if ('error' in parsed) return { error: parsed.error };
    if (id) {
      change = { categoryId, purpose, invoices: parsed.invoices };
    } else if (kind === 'REIMBURSEMENT') {
      const projectId = optional(form, 'projectId');
      if (!projectId) return { error: 'Choose a project.' };
      create = { kind, projectId, categoryId, purpose, invoices: parsed.invoices, ...(workOrderId ? { workOrderId } : {}) };
    } else {
      const advanceId = optional(form, 'advanceId');
      if (!advanceId) return { error: 'Choose the advance to settle.' };
      create = { kind, advanceId, categoryId, purpose, invoices: parsed.invoices, ...(workOrderId ? { workOrderId } : {}) };
    }
  }

  const saved = id ? await updateRequest(id, change!) : await createRequest(create!);
  const state = await settle(saved, '/finance');
  if (state.error || saved.state !== 'ready') return state;
  const requestId = id ?? saved.data.id;

  if (submit) {
    const submitted = await settle(await submitRequest(requestId), pages(requestId));
    if (submitted.error) return submitted;
  }
  redirect(`/finance/requests/${requestId}`);
}

export async function submitAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  return settle(await submitRequest(id), pages(id));
}

export async function cancelAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  return settle(await cancelRequest(id, optional(form, 'comment')), pages(id));
}

export async function approveAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  const typed = optional(form, 'amount');
  const amount = typed === undefined ? undefined : parseMoney(typed);
  if (amount === null) return { error: MONEY_ERROR };
  const comment = optional(form, 'comment');
  return settle(await approveRequest(id, { ...(amount === undefined ? {} : { amount }), ...(comment ? { comment } : {}) }), pages(id));
}

export async function returnAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  const comment = optional(form, 'comment');
  if (!comment) return { error: 'Say why.' };
  return settle(await returnRequest(id, comment), pages(id));
}

export async function rejectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  const comment = optional(form, 'comment');
  if (!comment) return { error: 'Say why.' };
  return settle(await rejectRequest(id, comment), pages(id));
}

/** Blank details are sent as nothing: the service wants them only when money actually moves. */
export async function payAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  const mode = optional(form, 'mode');
  if (mode !== undefined && !isMode(mode)) return { error: 'Choose how it was paid.' };
  const reference = optional(form, 'reference');
  const paidOn = optional(form, 'paidOn');
  const note = optional(form, 'note');
  const body: Partial<PaymentInput> = {
    ...(mode ? { mode } : {}), ...(reference ? { reference } : {}), ...(paidOn ? { paidOn } : {}), ...(note ? { note } : {}),
  };
  return settle(await payRequest(id, body), pages(id));
}

export async function cashReturnAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  const amount = parseMoney(optional(form, 'amount'));
  if (amount === null) return { error: MONEY_ERROR };
  const mode = optional(form, 'mode');
  const reference = optional(form, 'reference');
  const paidOn = optional(form, 'paidOn');
  if (!isMode(mode)) return { error: 'Choose how it was returned.' };
  if (!reference || !paidOn) return { error: 'Enter the reference and the date.' };
  const note = optional(form, 'note');
  return settle(await returnCash(id, { amount, mode, reference, paidOn, ...(note ? { note } : {}) }), pages(id));
}

export async function createCategoryAction(_previous: FormState, form: FormData): Promise<FormState> {
  const code = optional(form, 'code')?.toUpperCase();
  const name = optional(form, 'name');
  if (!code || !name) return { error: 'Enter a code and a name.' };
  return settle(await createCategory({ code, name }), '/finance/categories');
}

export async function updateCategoryAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  const name = optional(form, 'name');
  const disabled = optional(form, 'disabled');
  return settle(
    await updateCategory(id, { ...(name ? { name } : {}), ...(disabled === undefined ? {} : { disabled: disabled === 'true' }) }),
    '/finance/categories',
  );
}
```

- [ ] **Step 5: Run, typecheck, lint, commit**

Run: `pnpm --filter web exec vitest run app/finance && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS; no type or lint errors (if lint flags the `_previous` parameter name, mirror how `app/projects/actions.ts` names its unused first argument).

```bash
git add apps/web/app/finance/form.ts apps/web/app/finance/form.spec.ts apps/web/app/finance/actions.ts apps/web/app/finance/actions.spec.ts
git commit -m "feat(web): finance form parsing and server actions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Workspace page and request table

**Files:**
- Create: `apps/web/app/finance/layout.tsx`, `apps/web/app/finance/finance.css`
- Create: `apps/web/app/finance/page.tsx`, `apps/web/app/finance/requests-table.tsx`
- Create: `apps/web/app/finance/requests-table.spec.tsx`

**Interfaces:**
- `RequestsTable({ page, names, basePath, params })` (server component) renders rows linking to `/finance/requests/<id>`.
- The page reads `?view=mine|awaiting|all`, `status`, `kind`, `page`; defaults: `awaiting` when the user can act on any step, else `mine`.

- [ ] **Step 1: Write the failing test for the table**

`apps/web/app/finance/requests-table.spec.tsx` — render with `react-dom/server`'s `renderToStaticMarkup` (the repo's `.spec.tsx` pattern; `oxc.jsx.runtime: 'automatic'` is already configured):

```tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequestsTable } from './requests-table';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE', status: 'PENDING_PM', revision: 1, entryStatus: 'PENDING_PM',
  projectId: 'p-1', projectCode: 'KOS', projectName: 'Koshi Rollout', workOrderId: null, categoryId: 'c-1',
  requesterId: 'u-eng', advanceId: null, purpose: 'Site travel', requestedAmount: '50000.00', approvedAmount: null,
  appliedAmount: null, submittedAt: '2026-10-05T08:00:00Z', createdAt: '2026-10-05T07:00:00Z', updatedAt: '2026-10-05T08:00:00Z',
  category: { code: 'TRAVEL', name: 'Travel' }, ...over,
});
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, total: items.length, page: 1, limit: 20, ...extra }) as never;
const names = new Map([['u-eng', 'Sita Rai']]);
const html = (items: unknown[], extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<RequestsTable page={page(items, extra)} names={names} view="awaiting" />);

describe('RequestsTable', () => {
  it('links each request to its page and shows who, what and how much', () => {
    const out = html([row()]);
    expect(out).toContain('href="/finance/requests/r-1"');
    expect(out).toContain('ADV-2026-0007');
    expect(out).toContain('Koshi Rollout');
    expect(out).toContain('Sita Rai');
    expect(out).toContain('NPR 50,000.00');
    expect(out).toContain('With project manager');
  });

  it('shows the approved amount beside the requested one once there is one', () => {
    expect(html([row({ status: 'PENDING_FINANCE', approvedAmount: '40000.00' })])).toContain('NPR 40,000.00');
  });

  it('says so when nothing is waiting', () => {
    expect(html([])).toContain('Nothing here yet.');
  });

  it('offers the next page when there is one', () => {
    expect(html([row()], { total: 45 })).toContain('page=2');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run app/finance/requests-table.spec.tsx`
Expected: FAIL (cannot resolve `./requests-table`).

- [ ] **Step 3: Implement the table, layout, CSS and page**

`apps/web/app/finance/requests-table.tsx`:

```tsx
import type { FinanceRequest, RequestPage, RequestView } from '../lib/finance-api';
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, formatMoney, personName } from './model';

const DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });

function pageHref(view: RequestView, page: number): string {
  return `/finance?view=${view}&page=${page}`;
}

/** The finance workspace's list: one row per request, newest first, linking to the request. */
export function RequestsTable({ page, names, view }: { page: RequestPage; names: ReadonlyMap<string, string>; view: RequestView }) {
  if (page.items.length === 0) return <p className="finance-empty">Nothing here yet.</p>;
  const last = Math.max(1, Math.ceil(page.total / page.limit));
  return (
    <>
      <table className="finance-table">
        <thead>
          <tr><th>Request</th><th>Project</th><th>For</th><th>Requested by</th><th className="num">Amount</th><th>Status</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {page.items.map((request: FinanceRequest) => (
            <tr key={request.id}>
              <td><a href={`/finance/requests/${request.id}`}><strong>{request.number}</strong></a><span className="subtle">{KIND_LABEL[request.kind]}</span></td>
              <td>{request.projectName}<span className="subtle">{request.projectCode}</span></td>
              <td>{request.purpose}<span className="subtle">{request.category?.name ?? ''}</span></td>
              <td>{personName(request.requesterId, names)}</td>
              <td className="num">
                {formatMoney(request.approvedAmount ?? request.requestedAmount)}
                {request.approvedAmount !== null && request.approvedAmount !== request.requestedAmount
                  ? <span className="subtle">asked {formatMoney(request.requestedAmount)}</span> : null}
              </td>
              <td><span className={`pill ${STATUS_TONE[request.status]}`}>{STATUS_LABEL[request.status]}</span></td>
              <td>{DATE.format(new Date(request.updatedAt))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {last > 1 ? (
        <nav className="pager" aria-label="Pages">
          {page.page > 1 ? <a className="ghost-button" href={pageHref(view, page.page - 1)}>Previous</a> : <span />}
          <span className="subtle">Page {page.page} of {last}</span>
          {page.page < last ? <a className="ghost-button" href={pageHref(view, page.page + 1)}>Next</a> : <span />}
        </nav>
      ) : null}
    </>
  );
}
```

`apps/web/app/finance/layout.tsx`:

```tsx
import './finance.css';

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

`apps/web/app/finance/finance.css` — open `apps/web/app/styles.css` and `apps/web/app/overview/overview.css` first to find the colour and spacing tokens (CSS variables) and the existing `.pill`/`.pills` styles; reuse them. Write rules for exactly the classes used by the finance pages (`finance-table`, `finance-empty`, `finance-tabs`, `finance-grid`, `finance-facts`, `finance-timeline`, `finance-actions`, `invoice-rows`, `pill.green|amber|red|blue|slate` only if not already defined) using those tokens, a table that scrolls horizontally inside `.panel` at phone width (no page-level horizontal scroll at 375 px), `.num { text-align: right; font-variant-numeric: tabular-nums }`, and `.subtle` stacked under the main text in table cells (`display: block`). Keep the file under ~120 lines.

`apps/web/app/finance/page.tsx`:

```tsx
import type { RequestKind, RequestStatus, RequestView } from '../lib/finance-api';
import { listRequests } from '../lib/finance-api';
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listUserDirectory } from '../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../shell';
import { RequestsTable } from './requests-table';

interface Search { view?: string; status?: string; kind?: string; page?: string }

const VIEWS: Array<{ view: RequestView; label: string }> = [
  { view: 'awaiting', label: 'Waiting for me' }, { view: 'mine', label: 'My requests' }, { view: 'all', label: 'All requests' },
];

const asView = (value: string | undefined): RequestView | undefined => (value === 'awaiting' || value === 'mine' || value === 'all' ? value : undefined);

export default async function FinancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to see finance"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view')) {
    return <StatePage title="Finance is not available"><p>Your role does not include finance requests.</p></StatePage>;
  }

  const user = viewer.data;
  const mayAct = ['finance_approval.pm', 'finance_approval.director', 'finance_payment.record'].some((p) => hasPermission(user, p));
  const mayRaise = hasPermission(user, 'finance_request.create');
  const seeAll = hasPermission(user, 'finance_request.view_all');
  const tabs = VIEWS.filter(({ view }) => (view === 'awaiting' ? mayAct : view === 'all' ? seeAll : true));
  const view = asView(search.view) ?? (mayAct ? 'awaiting' : 'mine');
  const page = Math.max(1, Number(search.page) || 1);

  const [result, directory] = await Promise.all([
    listRequests({ view, page, ...(search.status ? { status: search.status as RequestStatus } : {}), ...(search.kind ? { kind: search.kind as RequestKind } : {}) }),
    listUserDirectory(),
  ]);
  if (result.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{result.state === 'unauthenticated' ? 'Sign in again to continue.' : result.message}</p></StatePage>;
  }
  const names = new Map(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);

  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Finance</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">FINANCE</p><h1>Advances &amp; settlements</h1>
              <p className="subtle">Requests for money, their approvals, and where each one stands.</p>
            </div>
            {mayRaise ? <a className="primary-button" href="/finance/new">+ New request</a> : null}
          </div>
          <section className="panel">
            <nav className="finance-tabs" aria-label="Views">
              {tabs.map((tab) => (
                <a key={tab.view} href={`/finance?view=${tab.view}`} aria-current={tab.view === view ? 'page' : undefined}>{tab.label}</a>
              ))}
            </nav>
            <RequestsTable page={result.data} names={names} view={view} />
          </section>
        </div>
      </section>
    </main>
  );
}
```

The page imports `Sidebar active="finance"`: this needs `'finance'` in `shell.tsx`'s `Section` union, added in Task 9. To let this task typecheck on its own, add `| 'finance'` to that union now (one-token change at `apps/web/app/shell.tsx:108`).

- [ ] **Step 4: Run, typecheck, lint, commit**

Run: `pnpm --filter web exec vitest run app/finance && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS, clean.

```bash
git add apps/web/app/finance/layout.tsx apps/web/app/finance/finance.css apps/web/app/finance/page.tsx apps/web/app/finance/requests-table.tsx apps/web/app/finance/requests-table.spec.tsx apps/web/app/shell.tsx
git commit -m "feat(web): finance workspace and request table

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: New and edit request form

**Files:**
- Create: `apps/web/app/finance/new/page.tsx`, `apps/web/app/finance/request-form.tsx`, `apps/web/app/finance/request-form.spec.tsx`
- Create: `apps/web/app/finance/requests/[id]/edit/page.tsx`

**Interfaces:**
- `RequestForm({ kind, projects, categories, advance?, initial? })` (client). `kind` is fixed once chosen; `initial` (an existing request, for edit) carries `{ id, kind, categoryId, purpose, requestedAmount, invoices }`.
- `/finance/new?kind=ADVANCE|REIMBURSEMENT|SETTLEMENT&advanceId=<id>`: with no `kind`, show a chooser with the three options (Settlement only when `advanceId` is given); settlements show the advance's number, project and outstanding balance.

- [ ] **Step 1: Write the failing test for the form markup**

`apps/web/app/finance/request-form.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../components/toast', () => ({
  useActionStateWithToast: (_action: unknown, initial: unknown) => [initial, () => undefined],
}));
vi.mock('./actions', () => ({ saveRequestAction: vi.fn() }));
vi.mock('react-dom', async (original) => ({ ...(await original<typeof import('react-dom')>()), useFormStatus: () => ({ pending: false }) }));

const { RequestForm } = await import('./request-form');

const projects = [{ id: 'p-1', code: 'KOS', name: 'Koshi Rollout' }];
const categories = [{ id: 'c-1', code: 'TRAVEL', name: 'Travel' }];

describe('RequestForm', () => {
  it('asks an advance for a project, category, purpose and amount, and no invoices', () => {
    const out = renderToStaticMarkup(<RequestForm kind="ADVANCE" projects={projects} categories={categories} />);
    expect(out).toContain('name="projectId"');
    expect(out).toContain('name="categoryId"');
    expect(out).toContain('name="purpose"');
    expect(out).toContain('name="amount"');
    expect(out).not.toContain('name="invoiceVendor"');
    expect(out).toContain('value="ADVANCE"');
    expect(out).toContain('Save draft');
    expect(out).toContain('Submit for approval');
  });

  it('asks a reimbursement for invoice rows instead of an amount', () => {
    const out = renderToStaticMarkup(<RequestForm kind="REIMBURSEMENT" projects={projects} categories={categories} />);
    expect(out).toContain('name="invoiceVendor"');
    expect(out).toContain('name="invoiceAmount"');
    expect(out).not.toContain('name="amount"');
  });

  it('settles a given advance without choosing a project, and says what is outstanding', () => {
    const out = renderToStaticMarkup(
      <RequestForm kind="SETTLEMENT" projects={projects} categories={categories} advance={{ id: 'a-1', number: 'ADV-2026-0007', projectName: 'Koshi Rollout', outstanding: '38000.00' }} />,
    );
    expect(out).toContain('name="advanceId"');
    expect(out).toContain('value="a-1"');
    expect(out).toContain('ADV-2026-0007');
    expect(out).toContain('NPR 38,000.00');
    expect(out).not.toContain('name="projectId"');
  });

  it('edits an existing request: carries its id, keeps the kind and cannot change the project', () => {
    const out = renderToStaticMarkup(
      <RequestForm kind="ADVANCE" projects={projects} categories={categories}
        initial={{ id: 'r-9', categoryId: 'c-1', purpose: 'Site travel', requestedAmount: '50000.00', invoices: [] }} />,
    );
    expect(out).toContain('name="id"');
    expect(out).toContain('value="r-9"');
    expect(out).toContain('Site travel');
    expect(out).toContain('50000.00');
    expect(out).not.toContain('name="projectId"');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run app/finance/request-form.spec.tsx`
Expected: FAIL (cannot resolve `./request-form`).

- [ ] **Step 3: Implement the form and the two pages**

`apps/web/app/finance/request-form.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { FormError, SubmitButton } from '../components/forms';
import { useActionStateWithToast } from '../components/toast';
import { EMPTY } from '../lib/form-state';
import type { InvoiceInput, RequestKind } from '../lib/finance-api';
import { saveRequestAction } from './actions';
import { formatMoney } from './model';

export interface ProjectChoice { id: string; code: string; name: string }
export interface CategoryChoice { id: string; code: string; name: string }
export interface AdvanceContext { id: string; number: string; projectName: string; outstanding: string }
export interface RequestInitial {
  id: string; categoryId: string; purpose: string; requestedAmount: string;
  invoices: Array<Pick<InvoiceInput, 'vendor' | 'invoiceNumber' | 'invoiceDate' | 'amount'>>;
}

const BLANK = { vendor: '', invoiceNumber: '', invoiceDate: '', amount: '' };

/**
 * One form for all three kinds. An advance asks for an amount; a reimbursement
 * or a settlement lists invoices, and the total is their sum. The kind is fixed
 * once the request exists, and so is its project, so an edit offers neither.
 */
export function RequestForm({
  kind, projects, categories, advance, initial,
}: {
  kind: RequestKind; projects: ProjectChoice[]; categories: CategoryChoice[]; advance?: AdvanceContext; initial?: RequestInitial;
}) {
  const [state, action] = useActionStateWithToast(saveRequestAction, EMPTY, 'Saved');
  const [rows, setRows] = useState(initial && initial.invoices.length > 0 ? initial.invoices : [BLANK]);
  const editing = initial !== undefined;

  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="kind" value={kind} />
      {editing ? <input type="hidden" name="id" value={initial.id} /> : null}
      {kind === 'SETTLEMENT' && advance ? <input type="hidden" name="advanceId" value={advance.id} /> : null}

      {kind === 'SETTLEMENT' && advance ? (
        <p className="form-note">
          Settling <strong>{advance.number}</strong> ({advance.projectName}). <strong>{formatMoney(advance.outstanding)}</strong> is still outstanding.
          Anything above that is paid back to you.
        </p>
      ) : null}

      <div className="form-grid">
        {kind !== 'SETTLEMENT' && !editing ? (
          <label className="field">Project
            <select name="projectId" required defaultValue="">
              <option value="" disabled>Choose a project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="field">Category
          <select name="categoryId" required defaultValue={initial?.categoryId ?? ''}>
            <option value="" disabled>Choose a category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">What is it for?
          <input name="purpose" required maxLength={500} defaultValue={initial?.purpose ?? ''} />
        </label>
        {kind === 'ADVANCE' ? (
          <label className="field">Amount (NPR)
            <input name="amount" inputMode="decimal" required defaultValue={initial?.requestedAmount ?? ''} placeholder="50,000.00" />
          </label>
        ) : null}
      </div>

      {kind !== 'ADVANCE' ? (
        <fieldset className="invoice-rows">
          <legend>Invoices</legend>
          {rows.map((row, index) => (
            <div className="form-grid" key={index}>
              <label className="field">Vendor<input name="invoiceVendor" defaultValue={row.vendor} maxLength={200} /></label>
              <label className="field">Invoice no.<input name="invoiceNumber" defaultValue={row.invoiceNumber} maxLength={100} /></label>
              <label className="field">Date<input name="invoiceDate" type="date" defaultValue={row.invoiceDate.slice(0, 10)} /></label>
              <label className="field">Amount (NPR)<input name="invoiceAmount" inputMode="decimal" defaultValue={row.amount} /></label>
              {rows.length > 1 ? (
                <button type="button" className="ghost-button" onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove</button>
              ) : null}
            </div>
          ))}
          <button type="button" className="ghost-button" onClick={() => setRows([...rows, BLANK])}>+ Add invoice</button>
          <p className="hint">Attach the invoice files to your records for now; uploads are coming.</p>
        </fieldset>
      ) : null}

      <FormError state={state} />
      <div className="form-actions">
        <button className="ghost-button" type="submit" name="intent" value="draft">Save draft</button>
        <SubmitButton>Submit for approval</SubmitButton>
      </div>
    </form>
  );
}
```

Two submit buttons need different `intent` values: give the primary button the `name="intent" value="submit"` attributes by rendering it as a plain `<button className="primary-button" type="submit" name="intent" value="submit">Submit for approval</button>` instead of `SubmitButton` if `SubmitButton` cannot take `name`/`value` props, and keep `useFormStatus`-based pending styling out of this form (the toast and redirect already give feedback). Adjust the spec's mock of `react-dom` accordingly if it is no longer needed.

`apps/web/app/finance/new/page.tsx`:

```tsx
import { getAdvance, listCategories } from '../../lib/finance-api';
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { listProjects } from '../../lib/project-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { RequestForm } from '../request-form';

interface Search { kind?: string; advanceId?: string }
const KINDS = ['ADVANCE', 'REIMBURSEMENT', 'SETTLEMENT'] as const;
type Kind = (typeof KINDS)[number];
const asKind = (value: string | undefined): Kind | undefined => KINDS.find((kind) => kind === value);

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { kind: rawKind, advanceId } = await searchParams;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') return <StatePage title="Sign in to raise a request"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.create')) {
    return <StatePage title="You cannot raise requests"><p>Only field engineers and project managers raise advances and reimbursements.</p></StatePage>;
  }

  const kind = asKind(rawKind);
  const [projects, categories, advance] = await Promise.all([
    listProjects(), listCategories(), kind === 'SETTLEMENT' && advanceId ? getAdvance(advanceId) : Promise.resolve(null),
  ]);
  const shell = (content: React.ReactNode, title: string) => (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>New request</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar"><div><p className="eyebrow">FINANCE</p><h1>{title}</h1></div></div>
          <section className="panel">{content}</section>
        </div>
      </section>
    </main>
  );

  if (!kind) {
    return shell(
      <div className="finance-grid">
        <a className="panel" href="/finance/new?kind=ADVANCE"><h2>Advance</h2><p className="subtle">Ask for money before you spend it.</p></a>
        <a className="panel" href="/finance/new?kind=REIMBURSEMENT"><h2>Reimbursement</h2><p className="subtle">Claim back money you already spent, with the invoices.</p></a>
      </div>,
      'What do you need?',
    );
  }
  if (categories.state !== 'ready' || projects.state !== 'ready') {
    return <StatePage title="The form is not available"><p>{categories.state === 'ready' ? 'Projects could not be loaded.' : 'Categories could not be loaded.'}</p></StatePage>;
  }
  if (kind === 'SETTLEMENT') {
    if (!advance || advance.state !== 'ready' || !advance.data.balance) {
      return <StatePage title="That advance cannot be settled"><p>Only a paid advance with money outstanding can be settled.</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
    }
    const { advance: adv, balance } = advance.data;
    return shell(
      <RequestForm kind="SETTLEMENT" projects={[]} categories={categories.data.filter((c) => !c.disabledAt)}
        advance={{ id: adv.id, number: adv.number, projectName: adv.projectName, outstanding: balance.outstanding }} />,
      'Settle an advance',
    );
  }
  return shell(
    <RequestForm kind={kind} projects={projects.data.filter((p) => p.status !== 'CANCELLED').map((p) => ({ id: p.id, code: p.code, name: p.name }))}
      categories={categories.data.filter((c) => !c.disabledAt)} />,
    kind === 'ADVANCE' ? 'Request an advance' : 'Claim a reimbursement',
  );
}
```

`apps/web/app/finance/requests/[id]/edit/page.tsx` — loads `getRequest(id)` and `listCategories()`, shows `StatePage` if the request is not `DRAFT`/`RETURNED` or not the viewer's own (compare `request.requesterId` with `viewer.data.id`), otherwise renders the same shell as `new/page.tsx` (crumbs: Finance / `<number>` / Edit) around `<RequestForm kind={request.kind} projects={[]} categories={…} initial={{ id: request.id, categoryId: request.categoryId, purpose: request.purpose, requestedAmount: request.requestedAmount, invoices: request.invoices.map(({ vendor, invoiceNumber, invoiceDate, amount }) => ({ vendor, invoiceNumber, invoiceDate, amount })) }} />` (for a settlement also pass `advance` from `getAdvance(request.advanceId)` so the outstanding note shows). Use `params: Promise<{ id: string }>`.

- [ ] **Step 4: Run, typecheck, lint, commit**

Run: `pnpm --filter web exec vitest run app/finance && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS, clean.

```bash
git add apps/web/app/finance/new apps/web/app/finance/request-form.tsx apps/web/app/finance/request-form.spec.tsx "apps/web/app/finance/requests/[id]/edit"
git commit -m "feat(web): finance request form and pages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Request detail with history and action panels

**Files:**
- Create: `apps/web/app/finance/requests/[id]/page.tsx`, `apps/web/app/finance/requests/[id]/panels.tsx`, `apps/web/app/finance/requests/[id]/panels.spec.tsx`

**Interfaces:**
- `ActionPanels({ request, actions, outstanding? })` (client): given the `RequestAction[]` from `availableActions`, renders only the matching forms/buttons: Submit (`RowAction` → `submitAction`), Edit (link), Cancel (`RowAction` with confirm → `cancelAction`), Settle (link to `/finance/new?kind=SETTLEMENT&advanceId=<id>`), Approve (amount field for the Director step only, comment optional → `approveAction`), Return/Reject (comment required → `returnAction` / `rejectAction`), Pay (mode select, reference, date, note → `payAction`; for a settlement label it "Settle" and say details are only needed if money is paid out), Cash return (→ `cashReturnAction`).

- [ ] **Step 1: Write the failing test**

`apps/web/app/finance/requests/[id]/panels.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../components/toast', () => ({
  useActionStateWithToast: (_action: unknown, initial: unknown) => [initial, () => undefined],
}));
vi.mock('../../actions', () => ({
  submitAction: vi.fn(), cancelAction: vi.fn(), approveAction: vi.fn(), returnAction: vi.fn(),
  rejectAction: vi.fn(), payAction: vi.fn(), cashReturnAction: vi.fn(),
}));
vi.mock('react-dom', async (original) => ({ ...(await original<typeof import('react-dom')>()), useFormStatus: () => ({ pending: false }) }));

const { ActionPanels } = await import('./panels');

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE', status: 'PENDING_DIRECTOR', requestedAmount: '50000.00', approvedAmount: null, ...over,
}) as never;
const html = (actions: string[], over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<ActionPanels request={request(over)} actions={actions as never} />);

describe('ActionPanels', () => {
  it('renders nothing when there is nothing to do', () => {
    expect(html([])).toBe('');
  });

  it('lets a draft be edited and submitted', () => {
    const out = html(['edit', 'submit'], { status: 'DRAFT' });
    expect(out).toContain('href="/finance/requests/r-1/edit"');
    expect(out).toContain('Submit for approval');
  });

  it('offers an amount only at the Director step', () => {
    expect(html(['approve', 'return', 'reject'])).toContain('name="amount"');
    expect(html(['approve', 'return', 'reject'], { status: 'PENDING_PM' })).not.toContain('name="amount"');
  });

  it('asks for a reason on return and reject', () => {
    const out = html(['approve', 'return', 'reject']);
    expect(out).toContain('Return to requester');
    expect(out).toContain('Reject');
    expect(out).toMatch(/name="comment"[^>]*required/);
  });

  it('shows the payment form to Finance with the approved amount', () => {
    const out = html(['pay', 'return', 'reject'], { status: 'PENDING_FINANCE', approvedAmount: '40000.00' });
    expect(out).toContain('NPR 40,000.00');
    expect(out).toContain('name="mode"');
    expect(out).toContain('name="reference"');
    expect(out).toContain('name="paidOn"');
  });

  it('explains that a settlement only needs payment details when money is paid out', () => {
    expect(html(['pay'], { status: 'PENDING_FINANCE', kind: 'SETTLEMENT', approvedAmount: '5000.00' })).toContain('only if money is paid out');
  });

  it('links a paid advance to settlement and lets Finance record returned cash', () => {
    expect(html(['settle'], { status: 'PAID' })).toContain('href="/finance/new?kind=SETTLEMENT&amp;advanceId=r-1"');
    expect(html(['cashReturn'], { status: 'PAID' })).toContain('name="amount"');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run "app/finance/requests/[[]id]/panels.spec.tsx"` (quote the bracket path; if the shell or vitest filter mishandles it, run `pnpm --filter web exec vitest run panels.spec`).
Expected: FAIL (cannot resolve `./panels`).

- [ ] **Step 3: Implement the panels**

`apps/web/app/finance/requests/[id]/panels.tsx`:

```tsx
'use client';
import { FormError, RowAction, SubmitButton } from '../../../components/forms';
import { useActionStateWithToast } from '../../../components/toast';
import { EMPTY, type FormState } from '../../../lib/form-state';
import type { FinanceRequest } from '../../../lib/finance-api';
import { approveAction, cancelAction, cashReturnAction, payAction, rejectAction, returnAction, submitAction } from '../../actions';
import { formatMoney, type RequestAction } from '../../model';

type Act = (state: FormState, form: FormData) => Promise<FormState>;
type Subject = Pick<FinanceRequest, 'id' | 'number' | 'kind' | 'status' | 'requestedAmount' | 'approvedAmount'>;

const today = (): string => new Date().toISOString().slice(0, 10);

function PaymentFields({ required }: { required: boolean }) {
  return (
    <div className="form-grid">
      <label className="field">How was it paid?
        <select name="mode" required={required} defaultValue="">
          <option value="" disabled={required}>{required ? 'Choose' : '—'}</option>
          <option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option>
          <option value="CHEQUE">Cheque</option><option value="MOBILE_WALLET">Mobile wallet (eSewa, Khalti)</option>
        </select>
      </label>
      <label className="field">Reference<input name="reference" required={required} maxLength={100} placeholder="Transaction or voucher number" /></label>
      <label className="field">Date<input name="paidOn" type="date" required={required} defaultValue={today()} /></label>
      <label className="field">Note<input name="note" maxLength={500} /></label>
    </div>
  );
}

/** One small form: hidden id, its fields, an error line and a button. */
function ActionForm({ action, id, success, title, children, button, tone = 'primary-button' }: {
  action: Act; id: string; success: string; title: string; children?: React.ReactNode; button: string; tone?: string;
}) {
  const [state, run] = useActionStateWithToast(action, EMPTY, success);
  return (
    <form action={run} className="panel-form finance-action">
      <h3>{title}</h3>
      <input type="hidden" name="id" value={id} />
      {children}
      <FormError state={state} />
      <SubmitButton className={tone}>{button}</SubmitButton>
    </form>
  );
}

const reason = (label: string) => (
  <label className="field">{label}<textarea name="comment" required maxLength={1000} rows={2} /></label>
);

/** Only the forms the viewer may use for this request right now; the service re-checks every one. */
export function ActionPanels({ request, actions }: { request: Subject; actions: readonly RequestAction[] }) {
  if (actions.length === 0) return null;
  const has = (action: RequestAction): boolean => actions.includes(action);
  const director = request.status === 'PENDING_DIRECTOR';
  const settlement = request.kind === 'SETTLEMENT';

  return (
    <section className="panel finance-actions" aria-label="Actions">
      {has('edit') ? <a className="ghost-button" href={`/finance/requests/${request.id}/edit`}>Edit</a> : null}
      {has('submit') ? (
        <RowAction action={submitAction} hidden={{ id: request.id }} label="Submit for approval" success="Submitted" className="primary-button" />
      ) : null}
      {has('settle') ? <a className="primary-button" href={`/finance/new?kind=SETTLEMENT&advanceId=${request.id}`}>Settle this advance</a> : null}

      {has('approve') ? (
        <ActionForm action={approveAction} id={request.id} success="Approved" title="Approve" button="Approve">
          {director ? (
            <label className="field">Approved amount (NPR)
              <input name="amount" inputMode="decimal" placeholder={request.requestedAmount} />
              <span className="hint">Leave empty to approve {formatMoney(request.requestedAmount)}, or enter a lower amount.</span>
            </label>
          ) : null}
          <label className="field">Note (optional)<input name="comment" maxLength={1000} /></label>
        </ActionForm>
      ) : null}

      {has('pay') ? (
        <ActionForm action={payAction} id={request.id} success={settlement ? 'Settled' : 'Payment recorded'} title={settlement ? 'Settle' : 'Record payment'} button={settlement ? 'Confirm settlement' : 'Record payment'}>
          <p className="form-note">Approved amount: <strong>{formatMoney(request.approvedAmount)}</strong>.{settlement ? ' Payment details are needed only if money is paid out.' : ''}</p>
          <PaymentFields required={!settlement} />
        </ActionForm>
      ) : null}

      {has('cashReturn') ? (
        <ActionForm action={cashReturnAction} id={request.id} success="Cash return recorded" title="Record returned cash" button="Record cash return">
          <label className="field">Amount returned (NPR)<input name="amount" inputMode="decimal" required /></label>
          <PaymentFields required />
        </ActionForm>
      ) : null}

      {has('return') ? (
        <ActionForm action={returnAction} id={request.id} success="Returned" title="Return to requester" button="Return to requester" tone="ghost-button">
          {reason('Why? The requester will see this.')}
        </ActionForm>
      ) : null}
      {has('reject') ? (
        <ActionForm action={rejectAction} id={request.id} success="Rejected" title="Reject" button="Reject" tone="danger-button">
          {reason('Why? This ends the request.')}
        </ActionForm>
      ) : null}

      {has('cancel') ? (
        <RowAction action={cancelAction} hidden={{ id: request.id }} label="Cancel request" confirm="Cancel this request? It will be withdrawn from approval." success="Cancelled" />
      ) : null}
    </section>
  );
}
```

`apps/web/app/finance/requests/[id]/page.tsx`:

```tsx
import { getAdvance, getRequest } from '../../../lib/finance-api';
import { getCurrentUser } from '../../../lib/iam-api';
import { listUserDirectory } from '../../../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../../../shell';
import { ActionPanels } from './panels';
import {
  KIND_LABEL, STATUS_LABEL, STATUS_TONE, availableActions, describeEntry, formatMoney, personName, waitingOn,
} from '../../model';

const WHEN = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const MODE: Record<string, string> = { BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CHEQUE: 'Cheque', MOBILE_WALLET: 'Mobile wallet' };

export default async function FinanceRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [viewer, result, directory] = await Promise.all([getCurrentUser(), getRequest(id), listUserDirectory()]);
  if (result.state === 'unauthenticated' || viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to see this request"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (result.state !== 'ready' || viewer.state !== 'ready') {
    return <StatePage title="This request is not available"><p>It may not exist, or it belongs to someone you cannot see.</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }

  const request = result.data;
  const names = new Map(directory.state === 'ready' ? directory.data.map((p) => [p.id, p.fullName]) : []);
  const who = (userId: string) => personName(userId, names);
  const approvedEarlier = request.actions.filter((a) => a.revision === request.revision && a.action === 'APPROVED').map((a) => a.actorId);
  const actions = availableActions(request, viewer.data, approvedEarlier);
  const advance = request.kind === 'SETTLEMENT' && request.advanceId ? await getAdvance(request.advanceId) : null;
  const waiting = waitingOn(request.status);

  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>{request.number}</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">{KIND_LABEL[request.kind].toUpperCase()}</p>
              <h1>{request.number} <span className={`pill ${STATUS_TONE[request.status]}`}>{STATUS_LABEL[request.status]}</span></h1>
              <p className="subtle">{request.projectCode} — {request.projectName}{waiting ? ` · ${waiting}` : ''}</p>
            </div>
          </div>

          <ActionPanels request={request} actions={actions} />

          <section className="panel finance-facts">
            <dl>
              <dt>For</dt><dd>{request.purpose}</dd>
              <dt>Category</dt><dd>{request.category?.name ?? '—'}</dd>
              <dt>Requested by</dt><dd>{who(request.requesterId)}</dd>
              <dt>Requested</dt><dd>{formatMoney(request.requestedAmount)}</dd>
              <dt>Approved</dt><dd>{formatMoney(request.approvedAmount)}</dd>
              {request.kind === 'SETTLEMENT' ? <><dt>Applied to advance</dt><dd>{formatMoney(request.appliedAmount)}</dd></> : null}
              {request.advanceId ? <><dt>Advance</dt><dd><a href={`/finance/requests/${request.advanceId}`}>{advance?.state === 'ready' ? advance.data.advance.number : 'View advance'}</a></dd></> : null}
            </dl>
          </section>

          {request.balance ? (
            <section className="panel finance-facts">
              <h2>Advance balance</h2>
              <dl>
                <dt>Paid</dt><dd>{formatMoney(request.balance.paid)}</dd>
                <dt>Settled</dt><dd>{formatMoney(request.balance.applied)}</dd>
                <dt>Cash returned</dt><dd>{formatMoney(request.balance.cashReturned)}</dd>
                <dt>Outstanding</dt><dd><strong>{formatMoney(request.balance.outstanding)}</strong></dd>
              </dl>
            </section>
          ) : null}

          {request.invoices.length > 0 ? (
            <section className="panel">
              <h2>Invoices</h2>
              <table className="finance-table">
                <thead><tr><th>Vendor</th><th>Invoice no.</th><th>Date</th><th className="num">Amount</th><th>File</th></tr></thead>
                <tbody>
                  {request.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.vendor}</td><td>{invoice.invoiceNumber}</td>
                      <td>{DAY.format(new Date(invoice.invoiceDate))}</td><td className="num">{formatMoney(invoice.amount)}</td>
                      <td>{invoice.mediaId ? 'File attached' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {request.payments.length > 0 ? (
            <section className="panel">
              <h2>Payments</h2>
              <table className="finance-table">
                <thead><tr><th>Type</th><th>How</th><th>Reference</th><th>Date</th><th className="num">Amount</th><th>Recorded by</th></tr></thead>
                <tbody>
                  {request.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.kind === 'PAYOUT' ? 'Paid out' : 'Cash returned'}</td><td>{MODE[p.mode] ?? p.mode}</td><td>{p.reference}</td>
                      <td>{DAY.format(new Date(p.paidOn))}</td><td className="num">{formatMoney(p.amount)}</td><td>{who(p.recordedBy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="panel">
            <h2>History</h2>
            <ol className="finance-timeline">
              {request.actions.map((entry) => (
                <li key={entry.id}>
                  <strong>{describeEntry(entry)}</strong> <span className="subtle">by {who(entry.actorId)} · {WHEN.format(new Date(entry.at))}</span>
                  {entry.amount ? <span> · {formatMoney(entry.amount)}</span> : null}
                  {entry.comment ? <p className="subtle">“{entry.comment}”</p> : null}
                </li>
              ))}
              {request.actions.length === 0 ? <li className="subtle">Nothing has happened yet.</li> : null}
            </ol>
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run, typecheck, lint, commit**

Run: `pnpm --filter web exec vitest run app/finance && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS, clean.

```bash
git add "apps/web/app/finance/requests/[id]/page.tsx" "apps/web/app/finance/requests/[id]/panels.tsx" "apps/web/app/finance/requests/[id]/panels.spec.tsx"
git commit -m "feat(web): finance request page with history and actions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Categories, spend report and Excel download

**Files:**
- Create: `apps/web/app/finance/categories/page.tsx`, `apps/web/app/finance/categories/forms.tsx`
- Create: `apps/web/app/finance/reports/page.tsx`
- Create: `apps/web/app/api/finance/report/route.ts`, `apps/web/app/api/finance/report/route.spec.ts`

**Interfaces:** the report page lists `spendReport()` rows grouped by `?groupBy=project|category|requester` with `from`/`to` date inputs and an "Export to Excel" link to `/api/finance/report?groupBy=…&from=…&to=…`; the route streams the service's xlsx through `proxyDownload` (from `lib/download.ts`) exactly like the site-import template route.

- [ ] **Step 1: Write the failing test for the download route**

`apps/web/app/api/finance/report/route.spec.ts` (mirror how `app/api/media/route.spec.ts` or `lib/download.spec.ts` test a download proxy; open `lib/download.ts` and `lib/download.spec.ts` first and follow the same mocking of `proxyDownload`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyDownload = vi.fn().mockResolvedValue(new Response('xlsx'));
vi.mock('../../../lib/download', () => ({ proxyDownload }));

const { GET } = await import('./route');
beforeEach(() => proxyDownload.mockClear());

describe('GET /api/finance/report', () => {
  it('asks the finance service for the workbook with the chosen grouping and dates', async () => {
    await GET(new Request('http://web/api/finance/report?groupBy=category&from=2026-10-01&to=2026-10-31'));
    expect(proxyDownload).toHaveBeenCalledWith(
      '/api/v1/finance/reports/project-spend?groupBy=category&from=2026-10-01&to=2026-10-31&format=xlsx',
      'finance-spend-by-category.xlsx',
      expect.stringContaining('finance'),
    );
  });

  it('defaults to grouping by project and drops empty filters', async () => {
    await GET(new Request('http://web/api/finance/report'));
    expect(proxyDownload).toHaveBeenCalledWith('/api/v1/finance/reports/project-spend?groupBy=project&format=xlsx', 'finance-spend-by-project.xlsx', expect.any(String));
  });

  it('ignores a grouping it does not know', async () => {
    await GET(new Request('http://web/api/finance/report?groupBy=%27%3Bdrop'));
    expect(proxyDownload.mock.calls[0]?.[0]).toContain('groupBy=project');
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement the route**

Run: `pnpm --filter web exec vitest run app/api/finance/report/route.spec.ts` — Expected: FAIL (cannot resolve `./route`).

`apps/web/app/api/finance/report/route.ts`:

```ts
import { proxyDownload } from '../../../lib/download';

const GROUPINGS = ['project', 'category', 'requester'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The spend report as an Excel file. A plain link to the gateway would arrive
 * unauthenticated (the session is an http-only cookie on this origin), so the
 * download is a route handler that reads the cookie server-side — the same
 * shape as the site-import template route.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('groupBy');
  const groupBy = GROUPINGS.find((g) => g === requested) ?? 'project';
  const params = new URLSearchParams({ groupBy });
  for (const key of ['projectId', 'from', 'to'] as const) {
    const value = url.searchParams.get(key);
    if (value && (key === 'projectId' || DATE.test(value))) params.set(key, value);
  }
  params.set('format', 'xlsx');
  return proxyDownload(
    `/api/v1/finance/reports/project-spend?${params.toString()}`,
    `finance-spend-by-${groupBy}.xlsx`,
    'You need access to finance reports to download this.',
  );
}
```

Run again — Expected: PASS. (If `proxyDownload`'s real signature differs from the call above, follow `lib/download.ts` and adjust both the route and its test.)

- [ ] **Step 3: Implement the categories and report pages**

`apps/web/app/finance/categories/forms.tsx` (client): `CreateCategoryForm` (inline form: code + name → `createCategoryAction`, toast "Category added") and `CategoryRow` (name edit form → `updateCategoryAction`, plus a `RowAction` toggling `disabled` with label "Disable"/"Enable", `hidden={{ id, disabled: String(!isDisabled) }}`). Mirror `projects/forms.tsx` (`useActionStateWithToast`, `FormError`, `SubmitButton`, `inline-form`, `field`).

`apps/web/app/finance/categories/page.tsx`: server page, gated on `finance_category.manage` (otherwise `StatePage` "Only finance can manage categories"), loads `listCategories()` and renders `CreateCategoryForm` plus a table of `CategoryRow`s inside the standard shell (`Sidebar active="finance"`, crumbs Finance / Categories).

`apps/web/app/finance/reports/page.tsx`: server page gated on `finance_request.view_all`; reads `?groupBy`, `from`, `to`; calls `spendReport`; renders a GET form (group-by select, from/to date inputs, "Show" button) and a table with columns Group, Advances paid, Settled (applied), Cash returned, Outstanding, Reimbursed, Expense (all `formatMoney`, numeric columns right-aligned), a totals row computed with integer paisa (convert each string with `Math.round(Number(v) * 100)` into a `bigint`-free sum of integers, then format), and the "Export to Excel" link `/api/finance/report?<same query>`. For `groupBy=requester` resolve labels through `listUserDirectory()` (the service labels rows with the raw id). Add a one-line note under the table: "Outstanding is each advance's balance today; the other columns follow the dates above." If there are no rows show "No completed spend in this period."

- [ ] **Step 4: Run, typecheck, lint, commit**

Run: `pnpm --filter web exec vitest run app/finance app/api/finance && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS, clean.

```bash
git add apps/web/app/finance/categories apps/web/app/finance/reports apps/web/app/api/finance
git commit -m "feat(web): finance categories, spend report and Excel download

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Navigation, role homes and removing the placeholders

**Files:**
- Modify: `apps/web/app/shell.tsx` (Finance menu; the `Section` union already has `'finance'` from Task 5)
- Modify: `apps/web/app/overview/model.ts`, `apps/web/app/overview/model.spec.ts` (`homeFor`)
- Modify: `apps/web/app/page.tsx`
- Modify: the overview pages and helpers that hold the sample finance panels: `apps/web/app/overview/admin-overview.tsx`, `manager-overview.tsx`, `qc-overview.tsx`, `engineer-overview.tsx`, `parts.tsx`, `placeholders.ts` (find them with `grep -rln "request-advance\|cash-advances\|CashAdvance\|advances" apps/web/app/overview apps/web/app/shell.tsx`)

**Interfaces:**
- `homeFor(roles)` additionally returns `'finance'` for `FINANCE` and `PROJECT_DIRECTOR` (checked after `SUPER_ADMIN` and `PROJECT_MANAGER`), and the root page redirects those homes to `/finance?view=awaiting`.
- Sidebar Finance section (shown to anyone holding `finance_request.view`): "Requests" (`/finance`), "Categories" (`/finance/categories`, only with `finance_category.manage`), "Spend report" (`/finance/reports`, only with `finance_request.view_all`).

- [ ] **Step 1: Write the failing tests for `homeFor`**

In `apps/web/app/overview/model.spec.ts` add (next to the existing `homeFor` tests):

```ts
  it('sends Finance and Project Directors to the finance workspace', () => {
    expect(homeFor(['FINANCE'])).toBe('finance');
    expect(homeFor(['PROJECT_DIRECTOR'])).toBe('finance');
  });

  it('keeps administrators and project managers on their own homes even if they also hold a finance role', () => {
    expect(homeFor(['SUPER_ADMIN', 'FINANCE'])).toBe('admin');
    expect(homeFor(['PROJECT_MANAGER', 'PROJECT_DIRECTOR'])).toBe('manager');
  });
```

Run: `pnpm --filter web exec vitest run app/overview/model.spec.ts` — Expected: FAIL.

- [ ] **Step 2: Implement `homeFor` and the root page**

In `apps/web/app/overview/model.ts` extend `HomeView` (find its definition; add `'finance'`) and `homeFor`:

```ts
export function homeFor(roles: readonly string[]): HomeView {
  if (roles.includes('SUPER_ADMIN')) return 'admin';
  if (roles.includes('PROJECT_MANAGER')) return 'manager';
  if (roles.includes('QC_MANAGER')) return 'qc';
  if (roles.includes('FINANCE') || roles.includes('PROJECT_DIRECTOR')) return 'finance';
  if (roles.includes('FIELD_ENGINEER')) return 'engineer';
  return 'admin';
}
```

In `apps/web/app/page.tsx` import `redirect` from `next/navigation` and add before the `default` case in the `switch`: `case 'finance': redirect('/finance?view=awaiting');` (update the comment: "five homes").

- [ ] **Step 3: Replace the placeholder links and panels**

In `apps/web/app/shell.tsx`:
1. Add `const mayViewFinance = viewer.state === 'ready' && hasPermission(viewer.data, 'finance_request.view');`, `const mayManageCategories = … 'finance_category.manage'`, `const maySeeSpend = … 'finance_request.view_all'` next to the other `may…` flags.
2. Replace the two placeholder `Finance` blocks (the `nav-finance` group with `/#request-advance` / `/#cash-advances`, and the standalone `Cash advances` item in the `Records` group) with one real group, rendered once for anyone with `mayViewFinance`, and for the `home === 'finance'` users make it the only group (their menu is Overview-less: Requests, Categories, Spend report, Docs). Items: `<NavItem section="finance" active={active} href="/finance" icon={<CashIcon />}>Requests</NavItem>`, and the two conditional items above (`href="/finance/categories"`, `href="/finance/reports"`, reuse `CashIcon`). Remove the now-unused `staff` variable if nothing else uses it, and keep the `'advances'` member of `Section` only if something still references it (remove it otherwise).
3. For users with `home === 'finance'`, hide the Projects/Quality/Records groups: they hold no permissions for them except read-only project/task views, and their home is finance.

In the overview files, delete the sample finance panels (the "Request advance" and "Cash advances" panels and their imports), the sample data they used in `placeholders.ts`, and any spec lines that asserted them; if a panel's removal leaves an empty layout cell, collapse the grid per the surrounding markup. Do not change any real (non-finance) panel. Where an overview page should point people to finance, add one link "Finance requests" to `/finance` in the existing quick-links area of the manager and engineer overviews (find the pattern the page already uses for links such as "Work orders").

- [ ] **Step 4: Run the whole web suite, typecheck, lint, build**

Run: `pnpm --filter web exec vitest run && pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: all PASS; the build succeeds with the new routes listed (`/finance`, `/finance/new`, `/finance/requests/[id]`, `/finance/requests/[id]/edit`, `/finance/categories`, `/finance/reports`, `/api/finance/report`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/shell.tsx apps/web/app/page.tsx apps/web/app/overview
git commit -m "feat(web): finance navigation, role homes, and real links instead of the sample panels

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end check against the running stack

**Files:** none (verification only; report findings, fix only what the plan's code got wrong).

The dev stack is the user's. Rebuild only what is needed and never use `down`, `--force-recreate` on the whole project, or `-V`.

- [ ] **Step 1: Bring up the finance pieces**

Run from the worktree: `docker compose -f docker/docker-compose.yml up -d --build --no-deps postgres-finance finance-migrate finance gateway web notification`. This restarts only those containers (the gateway to learn the finance route, web for the new pages, notification for the new consumer). Tell the user in your final report that you did this.

- [ ] **Step 2: Walk the whole flow in the browser pane**

Use the Browser tools against the web app (default `http://localhost:3100`) with the demo accounts (`engineer@`, `manager@`, `director@`, `finance@ipms.local`; the password is the dev `IAM_DEMO_PASSWORD` from `docker/env/iam.env`; never print it). The demo manager/engineer need access to a project first: grant it from the admin UI or `POST /api/v1/users/:id/projects` if none exists, and note that `director@` needs a project grant too; `finance@` has global scope. Then:
1. As the engineer: New request → Advance (project, category, purpose, amount) → Submit. See it in "My requests" as "With project manager".
2. As the manager: the bell shows "Approval needed"; open it; Approve. As the director: lower the amount; Approve. As finance: the bell shows "Payment due"; Record payment (bank transfer, reference, date). The engineer's bell shows approval and payment notifications.
3. As the engineer: open the paid advance → Settle this advance → add two invoices → Submit; manager and director approve; finance confirms. Check the advance page shows the new balance and the settlement.
4. As finance: record returned cash on the advance; check the engineer is notified and the balance drops.
5. Return and reject paths: a PM returns a request with a comment; the engineer edits and resubmits; finance returns a request at the payment step (approved amount disappears).
6. Open `/finance/reports` as finance; download the Excel file and open it.
Take screenshots of: the workspace, a request page mid-flow, the report. At 375 px width confirm there is no page-level horizontal scroll.

- [ ] **Step 3: Report**

Report what ran and what you saw, with any defect you found. Fix defects that are plain mistakes in this plan's code (typos, wrong field names, missing imports) with a test where one fits and a separate commit each; stop and report anything that needs a decision.

---

## Self-Review

**Spec coverage (spec §8):** My requests + new advance/reimbursement form (Tasks 5-6); settle advance with invoices and outstanding balance (Task 6, 7); approvals queue and detail with approve/return/reject and the Director amount (Tasks 5, 7); payments queue with the pay form and cash return (Tasks 5, 7); reports with Excel export (Task 8); categories (Task 8). Decisions folded in: Finance return/reject at the payment step (Task 3 rules, Task 7 panel), segregation of duties (`approvedEarlier`), optional invoice files (Task 1), finance workspace as the Director/Finance home and removal of the sample panels (Task 9).

**Placeholder scan:** Tasks 5 (CSS), 6 (edit page), 8 (categories/report pages) and 9 (menu and overview edits) describe the markup to write against the repo's existing classes and files rather than printing every line, because the exact tokens and pre-existing markup must be read from `styles.css`, `projects/forms.tsx`, `shell.tsx` and the overview files; the logic, wire types, actions, parsers, rules and the test for each are given in full.

**Type consistency:** `availableActions`/`RequestAction` (Task 3) are used by Task 7's `ActionPanels` and page; the action names in Task 4 match the `panels.spec.tsx` mocks and the `hidden` fields (`id`, `comment`, `amount`, `mode`, `reference`, `paidOn`, `note`); `RequestPage`, `FinanceRequestDetail`, `AdvanceView`, `SpendRow` (Task 2) match the service responses (`/finance/requests`, `/finance/requests/:id`, `/finance/advances/:id`, `/finance/reports/project-spend`).

**Known limits:** invoice files and payment proofs cannot be uploaded yet (follow-up: a finance-document category in the media service); report dates are UTC days; the requester's name needs `task.view` (held by every finance role).
