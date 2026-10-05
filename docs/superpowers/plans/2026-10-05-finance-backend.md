# Finance Service Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `finance` microservice (advance, settlement and reimbursement requests with a PM → Director → Finance approval chain), the two new IAM roles, the finance events, and the gateway/compose wiring.

**Architecture:** A new NestJS/Fastify service `apps/finance`, one service one Postgres database, structured exactly like `apps/qc`: Prisma 7 with the `pg` adapter, a transactional outbox drained to NATS, `JwtUserGuard` + `AuthzGuard` with `@RequirePermission`, and project scope looked up per request from the `project` service with the caller's bearer token. All money logic is in pure modules (`money.ts`, `balance.ts`, `workflow.ts`) that the DB-backed services call.

**Tech Stack:** TypeScript 5.9, NestJS 12 on Fastify 5, Prisma 7.10 + PostgreSQL 17, zod 4, exceljs, vitest 4 + Testcontainers, NATS JetStream via `@ipms/events`, pnpm 10 / Nx 23.

**Spec:** `docs/superpowers/specs/2026-10-05-finance-service-design.md`. This plan is part 1 of 3. Part 2 (notification consumers) and part 3 (web UI) are written separately and depend on the events and API defined here.

## Global Constraints

Copied from the spec; every task's requirements include these.

- Currency is **NPR**; money is `Decimal(14,2)`. In TypeScript and over the wire amounts are strings with at most two decimals (`"1500.50"`). All arithmetic is done in integer minor units (`bigint` paisa) via `money.ts`, never with floating point.
- Request kinds: `ADVANCE`, `SETTLEMENT` (invoices against a paid advance), `REIMBURSEMENT` (invoices, no advance). Numbers: `ADV-2026-0001`, `SET-…`, `REI-…`.
- Chain: Field Engineer submits → Project Manager approves → Project Director approves → Finance pays. A request raised by a PM (requester holds `finance_approval.pm`) skips `PENDING_PM` and enters at `PENDING_DIRECTOR`. After a return, resubmission re-enters at the step the request originally entered at. Project Directors and Finance never raise requests.
- No self-approval: the actor of any approval or payment step must differ from `requesterId`.
- Approver matching: the actor must hold the step's permission **and** the request's `projectId` must be inside the actor's scope (`scope.global || scope.projectIds.includes(projectId)`). Finance is global through a seeded global scope.
- Only the Director sets `approvedAmount`, with `0 < approvedAmount <= requestedAmount`. The PM approves as-is and cannot change the amount. Finance pays exactly `approvedAmount`, in one payment.
- Return and reject require a comment. Cancel is the requester's, from any `PENDING_*` state.
- Every transition is a conditional update on `(id, status, revision)` and is committed in one transaction with its `approval_action` row, its audit outbox event and its finance outbox event.
- Terminal success status: `PAID` for `ADVANCE` and `REIMBURSEMENT`, `SETTLED` for `SETTLEMENT`.
- Advance balance is derived: `outstanding = paid advance − Σ applied settlements − Σ cash returned`. Advance status shows `PAID`, `PARTIALLY_SETTLED`, `CLOSED` (outstanding is 0). At a settlement's Finance step, `applied = min(approvedAmount, outstanding)` and `payout = approvedAmount − applied`; a payout needs payment details.
- Permission codes use one dot (`module.action`), see Task 1.
- Event subjects match `^[a-z]+\.[a-z_]+\.[a-z_]+$`, one JetStream durable per subject.
- Ports: finance service `3009`, finance DB host port `5440`.

## File Structure

```
libs/authz/src/permissions.ts                       modify: finance permissions
libs/authz/src/finance-permissions.spec.ts          create
apps/iam/prisma/seed.ts                             modify: roles, demo users, global scope
apps/iam/prisma/seed.integration.spec.ts            modify
libs/contracts/src/finance/finance.ts               create: zod schemas + DTO types
libs/contracts/src/finance/finance.spec.ts          create
libs/contracts/src/index.ts                         modify: export finance
libs/events/src/subjects.ts                         modify: finance subjects + FINANCE stream
libs/events/src/subjects.spec.ts                    modify
libs/events/src/payloads/finance.ts                 create
libs/events/src/index.ts                            modify
apps/finance/
  package.json, tsconfig.json, tsconfig.build.json, vitest.config.ts, prisma.config.ts
  prisma/schema.prisma, prisma/migrations/…/migration.sql, prisma/test-db.ts, prisma/fixtures.ts
  src/main.ts, src/app.module.ts, src/prisma.service.ts
  src/outbox/outbox.drainer.ts (+ spec)
  src/common.ts            Actor, Tx, ProjectRef, inScope, requirePermission
  src/money.ts             minor-unit arithmetic (+ spec)
  src/balance.ts           advance balance + settlement plan (+ spec)
  src/workflow.ts          statuses, steps, transitions (+ spec)
  src/audit.ts, src/events.ts   outbox writers
  src/serialize.ts         Decimal → string DTOs
  src/ledger.ts            loadBalance(), lockAdvance()
  src/requests/request.service.ts (+ integration spec)
  src/approvals/approval.service.ts (+ integration spec)
  src/payments/payment.service.ts (+ integration spec)
  src/queries/query.service.ts (+ integration spec)
  src/queries/report.service.ts, report.xlsx.ts (+ integration spec)
  src/categories/category.service.ts (+ integration spec)
  src/directory/project-directory.client.ts (+ spec)
  src/http/request.controller.ts, category.controller.ts, report.controller.ts
apps/gateway/src/proxy/routes.ts, routes.spec.ts    modify
docker/docker-compose.yml, docker-compose.prod.yml, env/finance.env, env/finance-db.env, env/README.md
```

Conventions used by every task:

- Run libs' tests with `pnpm --filter @ipms/<lib> exec vitest run <file>`.
- Run the finance service's tests with `pnpm --filter finance exec vitest run <file>`. Integration specs start a Postgres container with Testcontainers, so Docker must be running.
- Services consume `@ipms/*` libraries from their built `dist`, so after changing a lib run `pnpm -r --filter "./libs/*" build` before testing a service.
- Commit only the files the task lists. The working tree has unrelated uncommitted files under `apps/mobile`; never use `git add -A` or `git commit -a`.

---

### Task 1: Finance permissions and the two new roles

**Files:**
- Modify: `libs/authz/src/permissions.ts` (insert before the `// Audit` block)
- Create: `libs/authz/src/finance-permissions.spec.ts`
- Modify: `apps/iam/prisma/seed.ts`
- Modify: `apps/iam/prisma/seed.integration.spec.ts`

**Interfaces:**
- Produces permission codes: `finance_request.view`, `finance_request.view_all`, `finance_request.create`, `finance_request.cancel`, `finance_settlement.submit`, `finance_approval.pm`, `finance_approval.director`, `finance_payment.record`, `finance_category.manage`.
- Produces system roles `PROJECT_DIRECTOR` and `FINANCE`, demo users `director@ipms.local` and `finance@ipms.local`, and a global scope grant for `FINANCE`.

- [ ] **Step 1: Write the failing catalog test**

Create `libs/authz/src/finance-permissions.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES, expandDependencies, validatePermissionSet } from './permissions.js';

const FINANCE_CODES = [
  'finance_request.view', 'finance_request.view_all', 'finance_request.create', 'finance_request.cancel',
  'finance_settlement.submit', 'finance_approval.pm', 'finance_approval.director',
  'finance_payment.record', 'finance_category.manage',
];

describe('finance permissions', () => {
  it('defines every finance permission', () => {
    for (const code of FINANCE_CODES) expect(PERMISSION_CODES.has(code), code).toBe(true);
  });

  it('makes approving and paying imply seeing the requests in scope', () => {
    for (const code of ['finance_approval.pm', 'finance_approval.director', 'finance_payment.record']) {
      const closed = expandDependencies([code]);
      expect(closed).toContain('finance_request.view');
      expect(closed).toContain('finance_request.view_all');
    }
  });

  it('is dependency-complete once closed', () => {
    expect(validatePermissionSet(expandDependencies(['finance_approval.director'])).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ipms/authz exec vitest run src/finance-permissions.spec.ts`
Expected: FAIL (`defines every finance permission` – codes not in catalog).

- [ ] **Step 3: Add the permissions**

In `libs/authz/src/permissions.ts`, insert immediately before the line `  // Audit — deliberately no update or delete. The ledger is append-only.`:

```ts
  // Finance. `view` is the caller's own requests; `view_all` is every request
  // in the caller's project scope, the same split as task.view / task.view_all.
  // The approval and payment verbs are checked by FinanceService against the
  // request's project, because one route serves both approval steps.
  def('finance_request', 'view', 'View your own finance requests'),
  def('finance_request', 'view_all', 'View every finance request in your project scope', ['finance_request.view']),
  def('finance_request', 'create', 'Raise an advance or reimbursement request', ['finance_request.view']),
  def('finance_request', 'cancel', 'Cancel your own pending finance request', ['finance_request.view']),
  def('finance_settlement', 'submit', 'Submit invoices to settle an advance', ['finance_request.view']),
  def('finance_approval', 'pm', 'Approve finance requests as project manager', ['finance_request.view', 'finance_request.view_all']),
  def('finance_approval', 'director', 'Approve finance requests as project director', ['finance_request.view', 'finance_request.view_all']),
  def('finance_payment', 'record', 'Record payments and returned cash', ['finance_request.view', 'finance_request.view_all']),
  def('finance_category', 'manage', 'Manage expense categories', ['finance_request.view']),

```

- [ ] **Step 4: Run the catalog tests to verify they pass**

Run: `pnpm --filter @ipms/authz exec vitest run`
Expected: PASS (new spec and the existing catalog-consistency specs).

- [ ] **Step 5: Write the failing seed tests**

In `apps/iam/prisma/seed.integration.spec.ts` make these edits.

Replace the `'creates the five system roles'` test with:

```ts
  it('creates the seven system roles', async () => {
    const roles = await prisma.role.findMany({ where: { isSystemRole: true } });
    expect(roles.map((r) => r.code).sort()).toEqual(
      ['FIELD_ENGINEER', 'FINANCE', 'PROJECT_DIRECTOR', 'PROJECT_MANAGER', 'QC_MANAGER', 'SUPER_ADMIN', 'VIEWER'],
    );
  });

  it('splits the finance chain across roles', async () => {
    const codesOf = async (code: string) => (await prisma.role.findUniqueOrThrow({
      where: { code }, include: { permissions: { include: { permission: true } } },
    })).permissions.map((rp) => rp.permission.code);

    const engineer = await codesOf('FIELD_ENGINEER');
    expect(engineer).toEqual(expect.arrayContaining(['finance_request.create', 'finance_request.cancel', 'finance_settlement.submit']));
    expect(engineer).not.toContain('finance_approval.pm');
    expect(engineer).not.toContain('finance_request.view_all');

    const pm = await codesOf('PROJECT_MANAGER');
    expect(pm).toEqual(expect.arrayContaining(['finance_request.create', 'finance_approval.pm', 'finance_request.view_all']));
    expect(pm).not.toContain('finance_approval.director');
    expect(pm).not.toContain('finance_payment.record');

    const director = await codesOf('PROJECT_DIRECTOR');
    expect(director).toEqual(expect.arrayContaining(['finance_approval.director', 'finance_request.view_all', 'project.view', 'task.view']));
    expect(director).not.toContain('finance_request.create');
    expect(director).not.toContain('finance_payment.record');

    const finance = await codesOf('FINANCE');
    expect(finance).toEqual(expect.arrayContaining(['finance_payment.record', 'finance_category.manage', 'finance_request.view_all', 'project.view', 'task.view']));
    expect(finance).not.toContain('finance_request.create');
    expect(finance).not.toContain('finance_approval.director');
  });
```

In `'is idempotent'` change `expect(await prisma.role.count()).toBe(5);` to `.toBe(7);`.

In the `seedDemoUsers global scope replication` block replace the three tests `'emits iam.scope.granted…'`, `'grants nobody else global scope'` and `'is idempotent: a second seed…'` with:

```ts
  it('emits iam.scope.granted at level GLOBAL for each globally scoped account', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ipms.local' } });
    const finance = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@ipms.local' } });
    const events = await prisma.outboxEvent.findMany({ where: { subject: 'iam.scope.granted' } });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.payload)).toEqual(expect.arrayContaining([
      { userId: admin.id, level: 'GLOBAL', projectId: null, siteId: null },
      { userId: finance.id, level: 'GLOBAL', projectId: null, siteId: null },
    ]));
  });

  it('grants global scope to the administrator and to finance, nobody else', async () => {
    // A PM or Director is granted the projects they run, explicitly. Finance
    // pays across every project, so it is global like the administrator.
    const finance = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@ipms.local' } });
    expect(await prisma.userGlobalScope.findUnique({ where: { userId: finance.id } })).not.toBeNull();
    expect(await prisma.userGlobalScope.count()).toBe(2);
  });

  it('is idempotent: a second seed adds no row and no second event', async () => {
    await seedDemoUsers(prisma);
    expect(await prisma.userGlobalScope.count()).toBe(2);
    expect(await prisma.outboxEvent.count({ where: { subject: 'iam.scope.granted' } })).toBe(2);
  });
```

- [ ] **Step 6: Run the seed tests to verify they fail**

Run: `pnpm -r --filter "./libs/*" build && pnpm --filter iam exec vitest run prisma/seed.integration.spec.ts`
Expected: FAIL (`creates the seven system roles`: only five exist).

- [ ] **Step 7: Implement the roles and demo users**

In `apps/iam/prisma/seed.ts`:

1. In the `PROJECT_MANAGER` permissions array, add a line after `'scope.grant', 'scope.revoke',`:

```ts
      // Finance: raise advances and reimbursements, settle them, and approve the
      // first step for requests on the projects they run.
      'finance_request.view', 'finance_request.view_all', 'finance_request.create', 'finance_request.cancel',
      'finance_settlement.submit', 'finance_approval.pm',
```

2. In the `FIELD_ENGINEER` permissions array, add after `'qc_submission.update', 'qc_submission.submit', 'qc_evidence.upload',`:

```ts
      'finance_request.view', 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit',
```

3. Add two roles after the `FIELD_ENGINEER` entry (before `VIEWER`):

```ts
  {
    code: 'PROJECT_DIRECTOR', name: 'Project Director',
    description: 'Second approval step for finance requests on the projects they oversee. Read-only elsewhere.',
    permissions: [
      'project.view', 'site.view', 'milestone.view', 'task.view', 'task.view_all',
      'finance_request.view', 'finance_request.view_all', 'finance_approval.director',
    ],
  },
  {
    code: 'FINANCE', name: 'Finance',
    description: 'Pays approved finance requests, records returned cash, maintains expense categories. Global scope.',
    permissions: [
      // project.view and task.view let finance call project's scope lookup, as qc does.
      'project.view', 'task.view',
      'finance_request.view', 'finance_request.view_all', 'finance_payment.record', 'finance_category.manage',
    ],
  },
```

4. Add to `DEMO_USERS`:

```ts
  { email: 'director@ipms.local', fullName: 'Project Director',     role: 'PROJECT_DIRECTOR' },
  { email: 'finance@ipms.local',  fullName: 'Finance Officer',      role: 'FINANCE' },
```

5. Above `export async function seedDemoUsers` add `const GLOBAL_SCOPE_ROLES: ReadonlySet<string> = new Set(['SUPER_ADMIN', 'FINANCE']);` and change the docstring line `Creates four accounts, one per system role` to `Creates six accounts, one per role that people actually sign in as`.

6. Replace `if (demo.role === 'SUPER_ADMIN') {` with `if (GLOBAL_SCOPE_ROLES.has(demo.role)) {`, and replace the sentence `Deliberately only \`admin\`. The other three demo accounts are left unscoped` in the comment above it with `Deliberately only \`admin\` and \`finance\` (which pays across every project). The other demo accounts are left unscoped`.

- [ ] **Step 8: Run the seed tests and the full IAM suite**

Run: `pnpm --filter iam exec vitest run`
Expected: PASS. If an unrelated IAM spec hard-codes the role count or the four demo users, update that number to match and re-run.

- [ ] **Step 9: Commit**

```bash
git add libs/authz/src/permissions.ts libs/authz/src/finance-permissions.spec.ts apps/iam/prisma/seed.ts apps/iam/prisma/seed.integration.spec.ts
git commit -m "feat(iam): add finance permissions, Project Director and Finance roles

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Finance contracts (zod schemas)

**Files:**
- Create: `libs/contracts/src/finance/finance.ts`
- Create: `libs/contracts/src/finance/finance.spec.ts`
- Modify: `libs/contracts/src/index.ts` (append `export * from './finance/finance.js';`)

**Interfaces:**
- Produces (all exported from `@ipms/contracts`): `RequestKindSchema`, `RequestStatusSchema`, `PaymentModeSchema`, `MoneySchema`, `InvoiceInputSchema`, `CreateRequestSchema`, `UpdateRequestSchema`, `ApproveSchema`, `CommentSchema`, `OptionalCommentSchema`, `PaymentDetailsSchema`, `PayRequestSchema`, `CashReturnSchema`, `CategoryCreateSchema`, `CategoryUpdateSchema`, `ListRequestsQuerySchema`, `ReportQuerySchema`; types `RequestKind`, `RequestStatus`, `CreateRequestDto`, `UpdateRequestDto`, `ApproveDto`, `PaymentDetailsDto`, `CashReturnDto`, `ListRequestsQuery`, `ReportQuery`; constant `FINANCE_CURRENCY = 'NPR'`.

- [ ] **Step 1: Write the failing test**

Create `libs/contracts/src/finance/finance.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../common/ids.js';
import {
  ApproveSchema, CashReturnSchema, CommentSchema, CreateRequestSchema, ListRequestsQuerySchema, MoneySchema,
  PayRequestSchema, PaymentDetailsSchema,
} from './finance.js';

const invoice = { vendor: 'Himal Fuel', invoiceNumber: 'INV-1', invoiceDate: '2026-10-01', amount: '1500.50', mediaId: uuidv7() };

describe('MoneySchema', () => {
  it.each(['1', '10.5', '1500.50', '0.01'])('accepts %s', (v) => expect(MoneySchema.safeParse(v).success).toBe(true));
  it.each(['0', '0.00', '-5', '1.234', 'abc', '1e3', '', '1,000'])('rejects %s', (v) => expect(MoneySchema.safeParse(v).success).toBe(false));
});

describe('CreateRequestSchema', () => {
  const base = { categoryId: uuidv7(), purpose: 'Site travel' };

  it('takes an advance with an amount and no invoices', () => {
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'ADVANCE', projectId: uuidv7(), amount: '50000' }).success).toBe(true);
  });

  it('refuses an advance with no amount', () => {
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'ADVANCE', projectId: uuidv7() }).success).toBe(false);
  });

  it('needs at least one invoice for a reimbursement', () => {
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'REIMBURSEMENT', projectId: uuidv7(), invoices: [] }).success).toBe(false);
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'REIMBURSEMENT', projectId: uuidv7(), invoices: [invoice] }).success).toBe(true);
  });

  it('takes a settlement against an advance, with no project of its own', () => {
    expect(CreateRequestSchema.safeParse({ ...base, kind: 'SETTLEMENT', advanceId: uuidv7(), invoices: [invoice] }).success).toBe(true);
  });
});

describe('approval bodies', () => {
  it('lets the amount and comment be omitted on approve', () => {
    expect(ApproveSchema.parse({})).toEqual({});
  });
  it('requires a comment to return or reject', () => {
    expect(CommentSchema.safeParse({ comment: '  ' }).success).toBe(false);
    expect(CommentSchema.safeParse({ comment: 'Invoice unreadable' }).success).toBe(true);
  });
});

describe('payments', () => {
  const details = { mode: 'BANK_TRANSFER', reference: 'TXN-77', paidOn: '2026-10-05' };
  it('requires mode, reference and date', () => {
    expect(PaymentDetailsSchema.safeParse(details).success).toBe(true);
    expect(PaymentDetailsSchema.safeParse({ mode: 'BANK_TRANSFER' }).success).toBe(false);
  });
  it('allows an empty body for pay, since a settlement may need no payout', () => {
    expect(PayRequestSchema.parse({})).toEqual({});
  });
  it('refuses a mode we do not support', () => {
    expect(PaymentDetailsSchema.safeParse({ ...details, mode: 'BITCOIN' }).success).toBe(false);
  });
  it('needs an amount to return cash', () => {
    expect(CashReturnSchema.safeParse(details).success).toBe(false);
    expect(CashReturnSchema.safeParse({ ...details, amount: '2000' }).success).toBe(true);
  });
});

describe('ListRequestsQuerySchema', () => {
  it('defaults to my own requests', () => {
    expect(ListRequestsQuerySchema.parse({})).toMatchObject({ view: 'mine', page: 1, limit: 20 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ipms/contracts exec vitest run src/finance/finance.spec.ts`
Expected: FAIL (cannot resolve `./finance.js`).

- [ ] **Step 3: Implement the schemas**

Create `libs/contracts/src/finance/finance.ts`:

```ts
import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';
import { PaginationSchema } from '../common/pagination.js';

/** Finance deals in one currency. It is a constant, not a column, so a second currency is a deliberate change. */
export const FINANCE_CURRENCY = 'NPR';

export const RequestKindSchema = z.enum(['ADVANCE', 'SETTLEMENT', 'REIMBURSEMENT']);
export type RequestKind = z.infer<typeof RequestKindSchema>;

export const RequestStatusSchema = z.enum([
  'DRAFT', 'PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE', 'PAID', 'SETTLED', 'RETURNED', 'REJECTED', 'CANCELLED',
]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const PaymentModeSchema = z.enum(['BANK_TRANSFER', 'CASH', 'CHEQUE', 'MOBILE_WALLET']);

/**
 * An amount as a string, at most two decimals, greater than zero. A string and
 * not a number so that "1500.50" survives JSON untouched and no arithmetic is
 * ever done on a float; the service converts to integer paisa.
 */
export const MoneySchema = z.string().trim()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, 'Enter an amount in NPR with at most two decimals')
  .refine((value) => Number(value) > 0, 'Amount must be greater than zero');

const TextSchema = (max: number) => z.string().trim().min(1).max(max);

export const InvoiceInputSchema = z.object({
  vendor: TextSchema(200),
  invoiceNumber: TextSchema(100),
  invoiceDate: z.coerce.date(),
  amount: MoneySchema,
  /** The uploaded invoice scan or photo, held by the media service. */
  mediaId: UuidSchema,
});
export type InvoiceInput = z.infer<typeof InvoiceInputSchema>;

const InvoicesSchema = z.array(InvoiceInputSchema).min(1).max(100);

const Common = {
  categoryId: UuidSchema,
  purpose: TextSchema(500),
  workOrderId: UuidSchema.optional(),
};

export const CreateRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ADVANCE'), projectId: UuidSchema, amount: MoneySchema, ...Common }),
  z.object({ kind: z.literal('REIMBURSEMENT'), projectId: UuidSchema, invoices: InvoicesSchema, ...Common }),
  // A settlement belongs to its advance's project; it names no project of its own.
  z.object({ kind: z.literal('SETTLEMENT'), advanceId: UuidSchema, invoices: InvoicesSchema, ...Common }),
]);
export type CreateRequestDto = z.infer<typeof CreateRequestSchema>;

/** Edits to a draft or returned request. The kind and project never change. */
export const UpdateRequestSchema = z.object({
  categoryId: UuidSchema.optional(),
  purpose: TextSchema(500).optional(),
  workOrderId: UuidSchema.nullable().optional(),
  amount: MoneySchema.optional(),
  invoices: InvoicesSchema.optional(),
}).strict();
export type UpdateRequestDto = z.infer<typeof UpdateRequestSchema>;

const CommentText = z.string().trim().min(1, 'A comment is required').max(1000);

/** Approve: the Director may set an amount; the PM may not (the service enforces which). */
export const ApproveSchema = z.object({ amount: MoneySchema.optional(), comment: CommentText.optional() }).strict();
export type ApproveDto = z.infer<typeof ApproveSchema>;

/** Return and reject say why. */
export const CommentSchema = z.object({ comment: CommentText }).strict();
export const OptionalCommentSchema = z.object({ comment: CommentText.optional() }).strict();

export const PaymentDetailsSchema = z.object({
  mode: PaymentModeSchema,
  reference: TextSchema(100),
  paidOn: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
  proofMediaId: UuidSchema.optional(),
});
export type PaymentDetailsDto = z.infer<typeof PaymentDetailsSchema>;

/** Every field optional: a settlement with no payout needs none. The service demands them when money moves. */
export const PayRequestSchema = PaymentDetailsSchema.partial();

export const CashReturnSchema = PaymentDetailsSchema.extend({ amount: MoneySchema });
export type CashReturnDto = z.infer<typeof CashReturnSchema>;

export const CategoryCreateSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{2,30}$/, 'Use 2-30 capitals, digits or underscores'),
  name: TextSchema(100),
});
export const CategoryUpdateSchema = z.object({ name: TextSchema(100).optional(), disabled: z.boolean().optional() }).strict();

export const ListRequestsQuerySchema = PaginationSchema.extend({
  /** mine: my own. awaiting: waiting for my approval or payment. all: everything in my project scope. */
  view: z.enum(['mine', 'awaiting', 'all']).default('mine'),
  status: RequestStatusSchema.optional(),
  kind: RequestKindSchema.optional(),
  projectId: UuidSchema.optional(),
});
export type ListRequestsQuery = z.infer<typeof ListRequestsQuerySchema>;

export const ReportQuerySchema = z.object({
  groupBy: z.enum(['project', 'category', 'requester']).default('project'),
  projectId: UuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'xlsx']).default('json'),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;
```

Append to `libs/contracts/src/index.ts`:

```ts
export * from './finance/finance.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @ipms/contracts exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/contracts/src/finance libs/contracts/src/index.ts
git commit -m "feat(contracts): add finance request schemas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Finance events and the FINANCE stream

**Files:**
- Create: `libs/events/src/payloads/finance.ts`
- Modify: `libs/events/src/subjects.ts`
- Modify: `libs/events/src/subjects.spec.ts`
- Modify: `libs/events/src/index.ts` (append `export * from './payloads/finance.js';`)

**Interfaces:**
- Produces `SUBJECTS.FINANCE_REQUEST_SUBMITTED | FINANCE_REQUEST_APPROVED_BY_PM | FINANCE_REQUEST_APPROVED | FINANCE_REQUEST_RETURNED | FINANCE_REQUEST_REJECTED | FINANCE_REQUEST_CANCELLED | FINANCE_REQUEST_PAID | FINANCE_SETTLEMENT_SETTLED`, `STREAMS.FINANCE`, and payload types `FinanceEventBase`, `FinanceRequestSubmitted`, `FinanceRequestApprovedByPm`, `FinanceRequestApproved`, `FinanceRequestReturned`, `FinanceRequestRejected`, `FinanceRequestCancelled`, `FinanceRequestPaid`, `FinanceSettlementSettled`.
- Durable names (consumed by notification in part 2): `notification-finance-submitted`, `-approved-by-pm`, `-approved`, `-returned`, `-rejected`, `-cancelled`, `-paid`, `-settled`.

- [ ] **Step 1: Write the failing test**

Append to `libs/events/src/subjects.spec.ts` (inside the file, as a new `describe`; the existing `covers every subject with exactly one stream` test will also start covering the new subjects):

```ts
describe('finance stream', () => {
  it('captures every finance subject', () => {
    expect(STREAMS.FINANCE.subjects).toEqual(['finance.>']);
    for (const subject of Object.values(SUBJECTS).filter((s) => s.startsWith('finance.'))) {
      expect(subject).toMatch(/^finance\./);
    }
  });

  it('gives notification one durable per finance subject', () => {
    const financeSubjects = Object.values(SUBJECTS).filter((s) => s.startsWith('finance.'));
    expect(STREAMS.FINANCE.durableConsumers).toHaveLength(financeSubjects.length);
    expect(new Set(STREAMS.FINANCE.durableConsumers).size).toBe(financeSubjects.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @ipms/events exec vitest run src/subjects.spec.ts`
Expected: FAIL (`STREAMS.FINANCE` undefined).

- [ ] **Step 3: Implement subjects, stream and payloads**

In `libs/events/src/subjects.ts`, add to `SUBJECTS` after `QC_WORK_ORDER_CANCELLED`:

```ts
  FINANCE_REQUEST_SUBMITTED: 'finance.request.submitted',
  FINANCE_REQUEST_APPROVED_BY_PM: 'finance.request.approved_by_pm',
  FINANCE_REQUEST_APPROVED: 'finance.request.approved',
  FINANCE_REQUEST_RETURNED: 'finance.request.returned',
  FINANCE_REQUEST_REJECTED: 'finance.request.rejected',
  FINANCE_REQUEST_CANCELLED: 'finance.request.cancelled',
  FINANCE_REQUEST_PAID: 'finance.request.paid',
  FINANCE_SETTLEMENT_SETTLED: 'finance.settlement.settled',
```

Change `export const STREAMS: Record<'IAM' | 'AUDIT' | 'QC', StreamDefinition> = {` to `Record<'IAM' | 'AUDIT' | 'QC' | 'FINANCE', StreamDefinition>` and add after the `QC` entry:

```ts
  FINANCE: {
    name: 'FINANCE',
    subjects: ['finance.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    // notification is the only consumer, one durable per subject (a durable
    // carries a single filter_subject, see the note on IAM above).
    durableConsumers: [
      'notification-finance-submitted',
      'notification-finance-approved-by-pm',
      'notification-finance-approved',
      'notification-finance-returned',
      'notification-finance-rejected',
      'notification-finance-cancelled',
      'notification-finance-paid',
      'notification-finance-settled',
    ],
  },
```

Create `libs/events/src/payloads/finance.ts`:

```ts
export type FinanceRequestKind = 'ADVANCE' | 'SETTLEMENT' | 'REIMBURSEMENT';
export type FinanceStep = 'PM' | 'DIRECTOR' | 'FINANCE';

/**
 * What every finance event says about the request. Amounts are NPR strings with
 * two decimals. `actorId` is who did the thing; `requesterId` is who to tell
 * about the outcome. Carries the project name and request number so a consumer
 * can write the notification without calling back into finance.
 */
export interface FinanceEventBase {
  requestId: string;
  number: string;
  kind: FinanceRequestKind;
  projectId: string;
  projectName: string;
  requesterId: string;
  requestedAmount: string;
  /** Set once the Director has approved. */
  approvedAmount: string | null;
  actorId: string;
  /** ISO-8601. */
  at: string;
  comment: string | null;
}

/** `nextStep` says who is now holding it: PM, or DIRECTOR when a PM raised it. */
export interface FinanceRequestSubmitted extends FinanceEventBase { nextStep: 'PM' | 'DIRECTOR' }
export type FinanceRequestApprovedByPm = FinanceEventBase;
/** The Director approved; Finance holds it now. */
export type FinanceRequestApproved = FinanceEventBase;
export type FinanceRequestReturned = FinanceEventBase;
export type FinanceRequestRejected = FinanceEventBase;
/** `heldBy` is the step the request was waiting at when the requester cancelled it. */
export interface FinanceRequestCancelled extends FinanceEventBase { heldBy: FinanceStep }

/** Who approved at each step, so the paid notification can reach all of them. `pmId` is null for a PM-raised request. */
export interface FinanceApprovers { pmId: string | null; directorId: string }

/** An advance or reimbursement was paid. `paidAmount` equals `approvedAmount`. */
export interface FinanceRequestPaid extends FinanceEventBase { approvers: FinanceApprovers; paidAmount: string }

/**
 * A settlement against an advance completed. `appliedAmount` was set against the
 * advance; `payoutAmount` is any excess paid to the requester ("0.00" when none).
 */
export interface FinanceSettlementSettled extends FinanceEventBase {
  approvers: FinanceApprovers;
  advanceId: string;
  appliedAmount: string;
  payoutAmount: string;
}
```

Append to `libs/events/src/index.ts`:

```ts
export * from './payloads/finance.js';
```

- [ ] **Step 4: Run to verify it passes, then rebuild libs**

Run: `pnpm --filter @ipms/events exec vitest run src/subjects.spec.ts && pnpm -r --filter "./libs/*" build`
Expected: PASS, and the libs build without type errors.

- [ ] **Step 5: Commit**

```bash
git add libs/events/src
git commit -m "feat(events): add finance subjects, stream and payloads

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Finance service scaffold, schema and outbox

**Files (all under `apps/finance/`, all created):**
`package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/20261005000100_init_finance/migration.sql`, `prisma/migrations/migration_lock.toml`, `prisma/test-db.ts`, `prisma/fixtures.ts`, `prisma/schema.integration.spec.ts`, `src/main.ts`, `src/app.module.ts`, `src/prisma.service.ts`, `src/outbox/outbox.drainer.ts`, `src/outbox/outbox.drainer.spec.ts`.

**Interfaces:**
- Produces `PrismaService` (`.db: PrismaClient` from `@prisma-clients/finance`), `OutboxDrainer`, test helpers `startTestDb()`, `resetDb(prisma)`, `ACTORS`, `scopes`.
- Tables: `expense_category`, `finance_request`, `request_invoice`, `approval_action`, `payment`, `number_counter`, `outbox_event`.

- [ ] **Step 1: Create the package and config files**

`apps/finance/package.json`:

```json
{
  "name": "finance",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@ipms/authz": "workspace:*",
    "@ipms/contracts": "workspace:*",
    "@ipms/events": "workspace:*",
    "@ipms/observability": "workspace:*",
    "@ipms/persistence": "workspace:*",
    "@nestjs/common": "12.0.3",
    "@nestjs/config": "12.0.0",
    "@nestjs/core": "12.0.3",
    "@nestjs/platform-fastify": "12.0.3",
    "@prisma/adapter-pg": "7.10.0",
    "@prisma/client": "7.10.0",
    "@prisma/client-runtime-utils": "7.10.0",
    "exceljs": "4.4.0",
    "fastify": "5.12.4",
    "pg": "8.23.0"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "12.1.0",
    "@types/pg": "8.23.1",
    "prisma": "7.10.0",
    "reflect-metadata": "0.2.2",
    "tsx": "4.20.6",
    "zod": "4.6.5"
  }
}
```

`apps/finance/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "declaration": false,
    "types": ["node"],
    // The `@ipms/*` libraries are consumed as built packages through
    // node_modules, the same way this service would consume them if it moved
    // to its own repository. The workspace path aliases would instead compile
    // each library's source into this service's output.
    "paths": {}
  },
  "include": ["src/**/*.ts", "prisma/**/*.ts"]
}
```

`apps/finance/tsconfig.build.json`:

```json
{
  // Emit-only variant; see the note in any library's tsconfig.build.json for
  // why the tests are excluded here rather than in tsconfig.json.
  "extends": "./tsconfig.json",
  "exclude": ["**/*.spec.ts", "**/*.test.ts"]
}
```

`apps/finance/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    // Each integration spec starts its own Postgres container, so run files one at a time.
    fileParallelism: false,
    // Resolves DOCKER_HOST for Testcontainers on a fresh clone and in CI.
    setupFiles: ['../../tools/vitest-setup-containers.ts'],
  },
});
```

`apps/finance/prisma.config.ts`:

```ts
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

`apps/finance/prisma/migrations/migration_lock.toml`:

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
```

- [ ] **Step 2: Write the Prisma schema**

`apps/finance/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/@prisma-clients/finance"
}

datasource db {
  provider = "postgresql"
}

model ExpenseCategory {
  id         String           @id @db.Uuid
  code       String           @unique @db.VarChar(30)
  name       String           @db.VarChar(100)
  disabledAt DateTime?        @db.Timestamptz(6)
  createdAt  DateTime         @default(now()) @db.Timestamptz(6)
  requests   FinanceRequest[]

  @@map("expense_category")
}

/// One row per advance, settlement or reimbursement. `kind` and `status` are
/// strings validated by the service (see src/workflow.ts), as elsewhere in this repo.
model FinanceRequest {
  id              String            @id @db.Uuid
  number          String            @unique @db.VarChar(30)
  kind            String            @db.VarChar(20)
  status          String            @db.VarChar(30)
  /// Bumped each time a returned request is resubmitted; part of every conditional update.
  revision        Int               @default(1)
  /// Where the request enters on submit (PENDING_PM, or PENDING_DIRECTOR when a PM raised it). Set at first submit.
  entryStatus     String?           @db.VarChar(30)
  projectId       String            @db.Uuid
  projectCode     String            @db.VarChar(50)
  projectName     String            @db.VarChar(200)
  workOrderId     String?           @db.Uuid
  categoryId      String            @db.Uuid
  requesterId     String            @db.Uuid
  /// SETTLEMENT only: the advance being settled.
  advanceId       String?           @db.Uuid
  purpose         String            @db.VarChar(500)
  requestedAmount Decimal           @db.Decimal(14, 2)
  approvedAmount  Decimal?          @db.Decimal(14, 2)
  /// SETTLEMENT only, set when settled: the part set against the advance (the rest was paid out).
  appliedAmount   Decimal?          @db.Decimal(14, 2)
  submittedAt     DateTime?         @db.Timestamptz(6)
  createdAt       DateTime          @default(now()) @db.Timestamptz(6)
  updatedAt       DateTime          @updatedAt @db.Timestamptz(6)
  category        ExpenseCategory   @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  advance         FinanceRequest?   @relation("AdvanceSettlements", fields: [advanceId], references: [id], onDelete: Restrict)
  settlements     FinanceRequest[]  @relation("AdvanceSettlements")
  invoices        RequestInvoice[]
  actions         ApprovalAction[]
  payments        Payment[]

  @@index([projectId, status])
  @@index([requesterId, status])
  @@index([advanceId])
  @@index([status])
  @@map("finance_request")
}

model RequestInvoice {
  id            String         @id @db.Uuid
  requestId     String         @db.Uuid
  vendor        String         @db.VarChar(200)
  invoiceNumber String         @db.VarChar(100)
  invoiceDate   DateTime       @db.Date
  amount        Decimal        @db.Decimal(14, 2)
  mediaId       String         @db.Uuid
  request       FinanceRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)

  @@index([requestId])
  @@map("request_invoice")
}

/// Append-only history. Never updated or deleted by the service.
model ApprovalAction {
  id        String         @id @db.Uuid
  requestId String         @db.Uuid
  revision  Int
  /// REQUESTER | PM | DIRECTOR | FINANCE
  step      String         @db.VarChar(20)
  /// SUBMITTED | APPROVED | RETURNED | REJECTED | CANCELLED | PAID
  action    String         @db.VarChar(20)
  actorId   String         @db.Uuid
  amount    Decimal?       @db.Decimal(14, 2)
  comment   String?        @db.VarChar(1000)
  at        DateTime       @default(now()) @db.Timestamptz(6)
  request   FinanceRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)

  @@index([requestId, at])
  @@map("approval_action")
}

model Payment {
  id           String         @id @db.Uuid
  requestId    String         @db.Uuid
  /// PAYOUT (money to the requester) | CASH_RETURN (unspent advance returned to the company)
  kind         String         @db.VarChar(20)
  mode         String         @db.VarChar(20)
  reference    String         @db.VarChar(100)
  paidOn       DateTime       @db.Date
  amount       Decimal        @db.Decimal(14, 2)
  note         String?        @db.VarChar(500)
  proofMediaId String?        @db.Uuid
  recordedBy   String         @db.Uuid
  createdAt    DateTime       @default(now()) @db.Timestamptz(6)
  request      FinanceRequest @relation(fields: [requestId], references: [id], onDelete: Restrict)

  @@index([requestId, kind])
  @@map("payment")
}

/// One row per `ADV-2026` style key; `value` is the last number handed out.
model NumberCounter {
  key   String @id @db.VarChar(20)
  value Int

  @@map("number_counter")
}

model OutboxEvent {
  id            String    @id @db.Uuid
  subject       String    @db.VarChar(100)
  payload       Json
  correlationId String    @db.VarChar(64)
  actorId       String?   @db.Uuid
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  publishedAt   DateTime? @db.Timestamptz(6)

  @@index([publishedAt, createdAt])
  @@map("outbox_event")
}
```

- [ ] **Step 3: Install, generate the client and the migration**

Run:

```bash
pnpm install
pnpm --filter finance exec prisma generate
mkdir -p apps/finance/prisma/migrations/20261005000100_init_finance
cd apps/finance && DATABASE_URL=postgresql://x pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/20261005000100_init_finance/migration.sql && cd ../..
```

Expected: `pnpm install` links `finance` into the workspace and updates `pnpm-lock.yaml`; `migration.sql` contains `CREATE TABLE "finance_request"` and the other six tables. If Prisma rejects `--to-schema`, run the same command with `--to-schema-datamodel` instead.

Then append the default categories to the end of `migration.sql`. The ids are fixed UUIDv7-shaped literals so they pass `UuidSchema`:

```sql

-- Starting categories. Finance maintains the list from here on.
INSERT INTO "expense_category" ("id", "code", "name") VALUES
  ('01930000-0000-7000-8000-000000000001', 'TRAVEL', 'Travel'),
  ('01930000-0000-7000-8000-000000000002', 'MATERIALS', 'Materials'),
  ('01930000-0000-7000-8000-000000000003', 'LABOUR', 'Labour'),
  ('01930000-0000-7000-8000-000000000004', 'ACCOMMODATION', 'Accommodation'),
  ('01930000-0000-7000-8000-000000000005', 'FUEL', 'Fuel'),
  ('01930000-0000-7000-8000-000000000006', 'MISC', 'Miscellaneous');
```

- [ ] **Step 4: Write the test helpers**

`apps/finance/prisma/test-db.ts`:

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/finance';

export async function startTestDb(): Promise<{ prisma: PrismaClient; connectionString: string; stop(): Promise<void> }> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // fileURLToPath, not URL.pathname: the latter can stay percent-encoded on macOS.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return {
    prisma,
    connectionString,
    async stop() { await prisma.$disconnect(); await container.stop(); },
  };
}
```

`apps/finance/prisma/fixtures.ts`:

```ts
import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import type { PrismaClient } from '@prisma-clients/finance';

export interface TestActor { id: string; permissions: string[] }

const VIEW = ['finance_request.view'];
const VIEW_ALL = [...VIEW, 'finance_request.view_all'];

/** The permission sets the seed gives each role; keep in step with apps/iam/prisma/seed.ts. */
export const ACTORS = {
  engineer: { id: uuidv7(), permissions: [...VIEW, 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit'] },
  otherEngineer: { id: uuidv7(), permissions: [...VIEW, 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit'] },
  pm: { id: uuidv7(), permissions: [...VIEW_ALL, 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit', 'finance_approval.pm'] },
  otherPm: { id: uuidv7(), permissions: [...VIEW_ALL, 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit', 'finance_approval.pm'] },
  director: { id: uuidv7(), permissions: [...VIEW_ALL, 'finance_approval.director'] },
  finance: { id: uuidv7(), permissions: [...VIEW_ALL, 'finance_payment.record', 'finance_category.manage'] },
} satisfies Record<string, TestActor>;

export const PROJECT = { id: uuidv7(), code: 'KOS', name: 'Koshi Rollout' };
export const OTHER_PROJECT = { id: uuidv7(), code: 'GND', name: 'Gandaki Upgrade' };

export const scopes = {
  global: { global: true, projectIds: [], siteIds: [] } satisfies AuthzScope,
  project: { global: false, projectIds: [PROJECT.id], siteIds: [] } satisfies AuthzScope,
  otherProject: { global: false, projectIds: [OTHER_PROJECT.id], siteIds: [] } satisfies AuthzScope,
  none: { global: false, projectIds: [], siteIds: [] } satisfies AuthzScope,
};

/** Clears every table except the seeded categories. */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE "finance_request", "number_counter", "outbox_event" RESTART IDENTITY CASCADE');
}

export async function aCategory(prisma: PrismaClient): Promise<string> {
  return (await prisma.expenseCategory.findFirstOrThrow({ where: { disabledAt: null }, orderBy: { code: 'asc' } })).id;
}
```

- [ ] **Step 5: Write the failing schema test**

`apps/finance/prisma/schema.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from './test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const request = async (over: Record<string, unknown> = {}) => prisma.financeRequest.create({
  data: {
    id: uuidv7(), number: `ADV-2026-${Math.floor(Math.random() * 1e6)}`, kind: 'ADVANCE', status: 'DRAFT',
    projectId: PROJECT.id, projectCode: PROJECT.code, projectName: PROJECT.name,
    categoryId: await aCategory(prisma), requesterId: ACTORS.engineer.id, purpose: 'Travel', requestedAmount: '1000.00',
    ...over,
  },
});

describe('finance schema', () => {
  it('seeds the starting expense categories', async () => {
    const codes = (await prisma.expenseCategory.findMany()).map((c) => c.code).sort();
    expect(codes).toEqual(['ACCOMMODATION', 'FUEL', 'LABOUR', 'MATERIALS', 'MISC', 'TRAVEL']);
  });

  it('refuses a duplicate request number', async () => {
    await request({ number: 'ADV-2026-0001' });
    await expect(request({ number: 'ADV-2026-0001' })).rejects.toThrow();
  });

  it('stores money with two decimals', async () => {
    const row = await request({ requestedAmount: '1500.5' });
    expect(row.requestedAmount.toFixed(2)).toBe('1500.50');
  });

  it('refuses to delete an advance that has settlements', async () => {
    const advance = await request();
    await request({ kind: 'SETTLEMENT', advanceId: advance.id });
    await expect(prisma.financeRequest.delete({ where: { id: advance.id } })).rejects.toThrow();
  });

  it('removes invoices and history with their request', async () => {
    const row = await request();
    await prisma.requestInvoice.create({ data: { id: uuidv7(), requestId: row.id, vendor: 'V', invoiceNumber: '1', invoiceDate: new Date('2026-10-01'), amount: '10.00', mediaId: uuidv7() } });
    await prisma.financeRequest.delete({ where: { id: row.id } });
    expect(await prisma.requestInvoice.count()).toBe(0);
  });
});
```

- [ ] **Step 6: Run to verify the schema test passes**

Run: `pnpm --filter finance exec vitest run prisma/schema.integration.spec.ts`
Expected: PASS (5 tests). If `migrate deploy` fails, re-check `migration.sql` was generated into the right directory.

- [ ] **Step 7: Write the outbox drainer and its test**

`apps/finance/src/outbox/outbox.drainer.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import type { EventBus } from '@ipms/events';
import { OutboxDrainer } from './outbox.drainer.js';

const row = { id: 'e-1', subject: 'finance.request.submitted', payload: { requestId: 'r-1' }, correlationId: 'c-1', actorId: 'u-1' };

function setup(publish: () => Promise<void>) {
  const prisma = { outboxEvent: { findMany: vi.fn().mockResolvedValue([row]), update: vi.fn() } };
  const bus = { publish: vi.fn(publish) };
  return { prisma, bus, drainer: new OutboxDrainer(prisma as unknown as PrismaClient, bus as unknown as EventBus) };
}

describe('OutboxDrainer.drain', () => {
  it('publishes pending rows with their event id and marks them published', async () => {
    const { prisma, bus, drainer } = setup(async () => {});
    await drainer.drain();
    expect(bus.publish).toHaveBeenCalledWith('finance.request.submitted', { requestId: 'r-1' }, { correlationId: 'c-1', eventId: 'e-1', actorId: 'u-1' });
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({ where: { id: 'e-1' }, data: { publishedAt: expect.any(Date) } });
  });

  it('leaves a row pending when publishing fails, so the next poll retries', async () => {
    const { prisma, drainer } = setup(async () => { throw new Error('nats down'); });
    await drainer.drain();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
  });
});
```

Run `pnpm --filter finance exec vitest run src/outbox` — Expected: FAIL (cannot resolve `./outbox.drainer.js`).

`apps/finance/src/outbox/outbox.drainer.ts`:

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/finance';
import type { EventBus } from '@ipms/events';
import { createLogger } from '@ipms/observability';

const log = createLogger('finance');
const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 100;

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
        // Left pending; the next poll retries. Consumers dedupe on eventId.
        log.warn({ err, outboxId: row.id, subject: row.subject }, 'outbox publish failed, will retry');
      }
    }
  }
}
```

Run again — Expected: PASS.

- [ ] **Step 8: Write the Prisma service, main and a minimal module**

`apps/finance/src/prisma.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/finance';
import { PrismaBaseService } from '@ipms/persistence';

@Injectable()
export class PrismaService extends PrismaBaseService {
  protected readonly client: PrismaClient;

  constructor() {
    super();
    const connectionString = process.env['FINANCE_DATABASE_URL'];
    if (!connectionString) throw new Error('FINANCE_DATABASE_URL is not set');
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }

  get db(): PrismaClient { return this.client; }
}
```

`apps/finance/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { GlobalExceptionFilter, createLogger } from '@ipms/observability';
import { AppModule } from './app.module.js';

const log = createLogger('finance');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  app.useGlobalFilters(new GlobalExceptionFilter('finance'));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'metrics'] });
  const port = Number(process.env['PORT'] ?? 3009);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'finance service listening');
}

bootstrap().catch((err: unknown) => { log.fatal({ err }, 'finance service failed to start'); process.exit(1); });
```

`apps/finance/src/app.module.ts` (controllers and services are added in Task 12):

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
import { OutboxDrainer } from './outbox/outbox.drainer.js';
import { PrismaService } from './prisma.service.js';

// Least-permissive scope: no finance route passes a resource to check(), so scope is never consulted
// by the guard. Each request resolves the caller's real scope from project, per request.
const scopeProvider: ScopeProvider = { async for(): Promise<AuthzScope> { return { global: false, projectIds: [], siteIds: [] }; } };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MetricsController],
  providers: [
    // Order matters: JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: scopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: () => {
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
    { provide: OutboxDrainer, useFactory: (prisma: PrismaService, bus: EventBus) => new OutboxDrainer(prisma.db, bus), inject: [PrismaService, EventBus] },
  ],
})
export class AppModule {}
```

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter finance typecheck`
Expected: no errors.

```bash
git add apps/finance pnpm-lock.yaml
git commit -m "feat(finance): scaffold finance service, schema and outbox

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Money arithmetic and advance balance (pure)

**Files:**
- Create: `apps/finance/src/money.ts`, `apps/finance/src/money.spec.ts`
- Create: `apps/finance/src/balance.ts`, `apps/finance/src/balance.spec.ts`

**Interfaces:**
- Produces from `money.ts`: `toMinor(amount: string): bigint`, `fromMinor(minor: bigint): string`, `sumMoney(values: string[]): string`, `subMoney(a: string, b: string): string`, `minMoney(a: string, b: string): string`, `compareMoney(a: string, b: string): -1 | 0 | 1`.
- Produces from `balance.ts`: `AdvanceStatus = 'PAID' | 'PARTIALLY_SETTLED' | 'CLOSED'`, `AdvanceFacts { paid: string; applied: string[]; cashReturned: string[] }`, `AdvanceBalance { paid; applied; cashReturned; outstanding: string; status: AdvanceStatus }`, `advanceBalance(facts): AdvanceBalance`, `planSettlement(approved: string, outstanding: string): { applied: string; payout: string }`.

- [ ] **Step 1: Write the failing money test**

`apps/finance/src/money.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compareMoney, fromMinor, minMoney, subMoney, sumMoney, toMinor } from './money.js';

describe('money', () => {
  it('converts to integer paisa without floating point', () => {
    expect(toMinor('1500.50')).toBe(150050n);
    expect(toMinor('0.1')).toBe(10n);
    expect(toMinor('7')).toBe(700n);
    expect(toMinor('19.99')).toBe(1999n);
  });

  it('formats back to two decimals', () => {
    expect(fromMinor(150050n)).toBe('1500.50');
    expect(fromMinor(5n)).toBe('0.05');
    expect(fromMinor(0n)).toBe('0.00');
    expect(fromMinor(-250n)).toBe('-2.50');
  });

  it('sums exactly where floats would drift', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney([])).toBe('0.00');
    expect(sumMoney(['1000', '250.75', '0.25'])).toBe('1251.00');
  });

  it('subtracts, compares and takes the lesser', () => {
    expect(subMoney('100.00', '33.33')).toBe('66.67');
    expect(compareMoney('10.00', '10')).toBe(0);
    expect(compareMoney('9.99', '10')).toBe(-1);
    expect(compareMoney('10.01', '10')).toBe(1);
    expect(minMoney('5.00', '4.99')).toBe('4.99');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter finance exec vitest run src/money.spec.ts`
Expected: FAIL (cannot resolve `./money.js`).

- [ ] **Step 3: Implement `money.ts`**

```ts
/**
 * NPR amounts are strings ("1500.50"). All arithmetic goes through integer
 * paisa so no float ever touches a balance. Inputs are trusted to be at most
 * two decimals: the contracts' MoneySchema enforces that at the edge, and
 * Prisma returns Decimal(14,2), formatted with toFixed(2).
 */

export function toMinor(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const minor = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -minor : minor;
}

export function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const text = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

export const sumMoney = (values: string[]): string => fromMinor(values.reduce((total, v) => total + toMinor(v), 0n));
export const subMoney = (a: string, b: string): string => fromMinor(toMinor(a) - toMinor(b));

export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const diff = toMinor(a) - toMinor(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

export const minMoney = (a: string, b: string): string => (compareMoney(a, b) <= 0 ? fromMinor(toMinor(a)) : fromMinor(toMinor(b)));
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter finance exec vitest run src/money.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing balance test**

`apps/finance/src/balance.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { advanceBalance, planSettlement } from './balance.js';

describe('advanceBalance', () => {
  it('is PAID with everything outstanding before any settlement', () => {
    expect(advanceBalance({ paid: '50000.00', applied: [], cashReturned: [] })).toEqual({
      paid: '50000.00', applied: '0.00', cashReturned: '0.00', outstanding: '50000.00', status: 'PAID',
    });
  });

  it('is PARTIALLY_SETTLED once something is applied or returned', () => {
    const afterSettlement = advanceBalance({ paid: '50000.00', applied: ['12000.00'], cashReturned: [] });
    expect(afterSettlement).toMatchObject({ outstanding: '38000.00', status: 'PARTIALLY_SETTLED' });
    const afterReturn = advanceBalance({ paid: '50000.00', applied: [], cashReturned: ['500.00'] });
    expect(afterReturn).toMatchObject({ outstanding: '49500.00', status: 'PARTIALLY_SETTLED' });
  });

  it('is CLOSED when settlements and returned cash cover the advance', () => {
    expect(advanceBalance({ paid: '50000.00', applied: ['45000.00', '3000.00'], cashReturned: ['2000.00'] })).toMatchObject({
      outstanding: '0.00', status: 'CLOSED',
    });
  });
});

describe('planSettlement', () => {
  it('applies the whole amount when it fits within the outstanding balance', () => {
    expect(planSettlement('12000.00', '38000.00')).toEqual({ applied: '12000.00', payout: '0.00' });
  });

  it('applies up to the balance and pays the excess out', () => {
    expect(planSettlement('7000.00', '5000.00')).toEqual({ applied: '5000.00', payout: '2000.00' });
  });

  it('pays everything out when nothing is outstanding', () => {
    expect(planSettlement('300.00', '0.00')).toEqual({ applied: '0.00', payout: '300.00' });
  });
});
```

- [ ] **Step 6: Run to verify it fails, then implement**

Run: `pnpm --filter finance exec vitest run src/balance.spec.ts` — Expected: FAIL (cannot resolve `./balance.js`).

`apps/finance/src/balance.ts`:

```ts
import { compareMoney, minMoney, subMoney, sumMoney } from './money.js';

export type AdvanceStatus = 'PAID' | 'PARTIALLY_SETTLED' | 'CLOSED';

export interface AdvanceFacts {
  /** The advance's approved amount, once paid. */
  paid: string;
  /** `appliedAmount` of each settled settlement. */
  applied: string[];
  /** Amount of each CASH_RETURN payment. */
  cashReturned: string[];
}

export interface AdvanceBalance {
  paid: string;
  applied: string;
  cashReturned: string;
  outstanding: string;
  status: AdvanceStatus;
}

/** outstanding = paid − applied − cashReturned. Derived on every read; never stored. */
export function advanceBalance(facts: AdvanceFacts): AdvanceBalance {
  const applied = sumMoney(facts.applied);
  const cashReturned = sumMoney(facts.cashReturned);
  const outstanding = subMoney(subMoney(facts.paid, applied), cashReturned);
  const status: AdvanceStatus = compareMoney(outstanding, '0') <= 0
    ? 'CLOSED'
    : compareMoney(sumMoney([applied, cashReturned]), '0') > 0 ? 'PARTIALLY_SETTLED' : 'PAID';
  return { paid: facts.paid, applied, cashReturned, outstanding, status };
}

/**
 * How a settlement's approved invoices land against an advance: up to the
 * outstanding balance is applied, and any excess is the company owing the
 * engineer, paid out in the same Finance step.
 */
export function planSettlement(approved: string, outstanding: string): { applied: string; payout: string } {
  const applied = minMoney(approved, compareMoney(outstanding, '0') < 0 ? '0' : outstanding);
  return { applied, payout: subMoney(approved, applied) };
}
```

- [ ] **Step 7: Run both specs and commit**

Run: `pnpm --filter finance exec vitest run src/money.spec.ts src/balance.spec.ts`
Expected: PASS.

```bash
git add apps/finance/src/money.ts apps/finance/src/money.spec.ts apps/finance/src/balance.ts apps/finance/src/balance.spec.ts
git commit -m "feat(finance): integer-paisa money maths and advance balance

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Workflow state machine (pure)

**Files:**
- Create: `apps/finance/src/workflow.ts`, `apps/finance/src/workflow.spec.ts`

**Interfaces:**
- Produces: `Step`, `PENDING_STATUSES`, `EDITABLE_STATUSES`, `STEP_PERMISSION: Record<Step, string>`, `stepOf(status: string): Step | null`, `isPending(status: string): boolean`, `isEditable(status: string): boolean`, `entryStatus(requesterIsPm: boolean): 'PENDING_PM' | 'PENDING_DIRECTOR'`, `statusAfterApproval(status: 'PENDING_PM' | 'PENDING_DIRECTOR'): 'PENDING_DIRECTOR' | 'PENDING_FINANCE'`, `finalStatus(kind: RequestKind): 'PAID' | 'SETTLED'`, `awaitingStatuses(permissions: readonly string[]): string[]`, `isPm(permissions: readonly string[]): boolean`.

- [ ] **Step 1: Write the failing test**

`apps/finance/src/workflow.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  STEP_PERMISSION, awaitingStatuses, entryStatus, finalStatus, isEditable, isPending, isPm, statusAfterApproval, stepOf,
} from './workflow.js';

describe('workflow', () => {
  it('maps a pending status to the step that holds it', () => {
    expect(stepOf('PENDING_PM')).toBe('PM');
    expect(stepOf('PENDING_DIRECTOR')).toBe('DIRECTOR');
    expect(stepOf('PENDING_FINANCE')).toBe('FINANCE');
    expect(stepOf('DRAFT')).toBeNull();
    expect(stepOf('PAID')).toBeNull();
  });

  it('treats only the three PENDING states as cancellable-pending', () => {
    for (const s of ['PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE']) expect(isPending(s)).toBe(true);
    for (const s of ['DRAFT', 'RETURNED', 'REJECTED', 'CANCELLED', 'PAID', 'SETTLED']) expect(isPending(s)).toBe(false);
  });

  it('lets only a draft or returned request be edited', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('RETURNED')).toBe(true);
    expect(isEditable('PENDING_PM')).toBe(false);
  });

  it('sends an engineer to the PM and a PM straight to the Director', () => {
    expect(entryStatus(false)).toBe('PENDING_PM');
    expect(entryStatus(true)).toBe('PENDING_DIRECTOR');
  });

  it('advances PM to Director to Finance', () => {
    expect(statusAfterApproval('PENDING_PM')).toBe('PENDING_DIRECTOR');
    expect(statusAfterApproval('PENDING_DIRECTOR')).toBe('PENDING_FINANCE');
  });

  it('ends a settlement as SETTLED and the others as PAID', () => {
    expect(finalStatus('SETTLEMENT')).toBe('SETTLED');
    expect(finalStatus('ADVANCE')).toBe('PAID');
    expect(finalStatus('REIMBURSEMENT')).toBe('PAID');
  });

  it('names the permission each step needs', () => {
    expect(STEP_PERMISSION).toEqual({ PM: 'finance_approval.pm', DIRECTOR: 'finance_approval.director', FINANCE: 'finance_payment.record' });
  });

  it('recognises a PM by the permission to approve as one', () => {
    expect(isPm(['finance_approval.pm', 'finance_request.view'])).toBe(true);
    expect(isPm(['finance_request.create'])).toBe(false);
  });

  it('lists what is waiting for a user, from the steps they may act on', () => {
    expect(awaitingStatuses(['finance_approval.pm'])).toEqual(['PENDING_PM']);
    expect(awaitingStatuses(['finance_approval.pm', 'finance_approval.director'])).toEqual(['PENDING_PM', 'PENDING_DIRECTOR']);
    expect(awaitingStatuses(['finance_payment.record'])).toEqual(['PENDING_FINANCE']);
    expect(awaitingStatuses(['finance_request.view'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter finance exec vitest run src/workflow.spec.ts`
Expected: FAIL (cannot resolve `./workflow.js`).

- [ ] **Step 3: Implement `workflow.ts`**

```ts
import type { RequestKind } from '@ipms/contracts';

/** The three approval steps, in order. Statuses are strings in the database; this module is the only place that knows the rules. */
export type Step = 'PM' | 'DIRECTOR' | 'FINANCE';

export const PENDING_STATUSES = ['PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE'] as const;
export const EDITABLE_STATUSES = ['DRAFT', 'RETURNED'] as const;

const STEP_BY_STATUS: Record<string, Step> = { PENDING_PM: 'PM', PENDING_DIRECTOR: 'DIRECTOR', PENDING_FINANCE: 'FINANCE' };

export const STEP_PERMISSION: Record<Step, string> = {
  PM: 'finance_approval.pm',
  DIRECTOR: 'finance_approval.director',
  FINANCE: 'finance_payment.record',
};

export const stepOf = (status: string): Step | null => STEP_BY_STATUS[status] ?? null;
export const isPending = (status: string): boolean => status in STEP_BY_STATUS;
export const isEditable = (status: string): boolean => (EDITABLE_STATUSES as readonly string[]).includes(status);

/** Raising a request as a PM skips the PM step: nobody approves their own request. */
export const isPm = (permissions: readonly string[]): boolean => permissions.includes(STEP_PERMISSION.PM);
export const entryStatus = (requesterIsPm: boolean): 'PENDING_PM' | 'PENDING_DIRECTOR' => (requesterIsPm ? 'PENDING_DIRECTOR' : 'PENDING_PM');

export function statusAfterApproval(status: 'PENDING_PM' | 'PENDING_DIRECTOR'): 'PENDING_DIRECTOR' | 'PENDING_FINANCE' {
  return status === 'PENDING_PM' ? 'PENDING_DIRECTOR' : 'PENDING_FINANCE';
}

/** A settlement is "settled" (it may move no cash); the others are "paid". */
export const finalStatus = (kind: RequestKind): 'PAID' | 'SETTLED' => (kind === 'SETTLEMENT' ? 'SETTLED' : 'PAID');

/** The statuses a user could act on, from the steps their permissions open. */
export function awaitingStatuses(permissions: readonly string[]): string[] {
  return PENDING_STATUSES.filter((status) => permissions.includes(STEP_PERMISSION[STEP_BY_STATUS[status]!]));
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `pnpm --filter finance exec vitest run src/workflow.spec.ts`
Expected: PASS.

```bash
git add apps/finance/src/workflow.ts apps/finance/src/workflow.spec.ts
git commit -m "feat(finance): approval workflow rules

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Shared plumbing (common, audit, events, serialize, ledger)

**Files (all under `apps/finance/src/`, all created):** `common.ts`, `audit.ts`, `events.ts`, `serialize.ts`, `ledger.ts`, `ledger.integration.spec.ts`.

**Interfaces:**
- `common.ts` produces: `Tx` (`Prisma.TransactionClient`), `Actor { id: string; permissions: string[] }`, `ProjectRef { id; code; name }`, `inScope(scope, projectId): boolean`, `requirePermission(actor, permission): void` (throws `ForbiddenException`), `notFound(what): NotFoundException`.
- `audit.ts` produces: `recordAudit(tx, entry: { actorId; action; objectType?: 'FinanceRequest' | 'ExpenseCategory' | 'Payment'; objectId; previousState; newState })`, `asJson(value: object): JsonObject`.
- `events.ts` produces: `factsOf(row: FinanceRequest, actorId: string, comment: string | null, at?: Date): FinanceEventBase`, `emit(tx, subject: string, payload: object, actorId: string): Promise<void>`, `recordAction(tx, input: { requestId; revision; step: 'REQUESTER' | Step; action: string; actorId; amount?: string | null; comment?: string | null }): Promise<void>`.
- `serialize.ts` produces: `serializeRequest(row)`, `serializeDetail(row)` (adds invoices/actions/payments with money as strings).
- `ledger.ts` produces: `lockAdvance(tx, advanceId): Promise<void>`, `loadBalance(db: PrismaClient | Tx, advanceId): Promise<AdvanceBalance>`.

- [ ] **Step 1: Write `common.ts`**

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import type { Prisma } from '@prisma-clients/finance';

export type Tx = Prisma.TransactionClient;

/** The authenticated caller, as the JWT guard resolves them. */
export interface Actor { id: string; permissions: string[] }

/** The project facts a request snapshots at creation, so reports need no cross-service call. */
export interface ProjectRef { id: string; code: string; name: string }

/** True when the caller's project scope reaches the project. */
export const inScope = (scope: AuthzScope, projectId: string): boolean => scope.global || scope.projectIds.includes(projectId);

export function requirePermission(actor: Actor, permission: string): void {
  if (!actor.permissions.includes(permission)) throw new ForbiddenException(`This needs the ${permission} permission`);
}

/** Used for both "missing" and "not yours", so a request's existence is not disclosed. */
export const notFound = (what: string): NotFoundException => new NotFoundException(`${what} not found`);
```

- [ ] **Step 2: Write `audit.ts`**

```ts
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import type { Tx } from './common.js';

export type AuditObject = 'FinanceRequest' | 'ExpenseCategory' | 'Payment';

/** Written inside the action's own transaction, so an action and its audit entry commit together. */
export async function recordAudit(
  tx: Tx,
  entry: { actorId: string; action: string; objectType?: AuditObject; objectId: string; previousState: JsonObject; newState: JsonObject },
): Promise<void> {
  await tx.outboxEvent.create({
    data: buildOutboxRecord(SUBJECTS.AUDIT_EVENT, {
      actorId: entry.actorId, action: entry.action, objectType: entry.objectType ?? 'FinanceRequest', objectId: entry.objectId,
      previousState: entry.previousState, newState: entry.newState, details: {},
    }, getCorrelationId() ?? 'unknown', entry.actorId),
  });
}

/** A value as a ledger-safe JSON object: dates become ISO strings, Decimals become strings, undefined keys drop out. */
export function asJson(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
```

- [ ] **Step 3: Write `events.ts`**

```ts
import { uuidv7 } from '@ipms/contracts';
import type { FinanceEventBase } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord } from '@ipms/persistence';
import type { FinanceRequest } from '@prisma-clients/finance';
import { asJson } from './audit.js';
import type { Tx } from './common.js';
import type { Step } from './workflow.js';

/** What every finance event says about the request; see FinanceEventBase. */
export function factsOf(row: FinanceRequest, actorId: string, comment: string | null, at: Date = new Date()): FinanceEventBase {
  return {
    requestId: row.id,
    number: row.number,
    kind: row.kind as FinanceEventBase['kind'],
    projectId: row.projectId,
    projectName: row.projectName,
    requesterId: row.requesterId,
    requestedAmount: row.requestedAmount.toFixed(2),
    approvedAmount: row.approvedAmount?.toFixed(2) ?? null,
    actorId,
    at: at.toISOString(),
    comment,
  };
}

/** Queues a finance event in the caller's transaction; the drainer publishes it after commit. */
export async function emit(tx: Tx, subject: string, payload: object, actorId: string): Promise<void> {
  await tx.outboxEvent.create({ data: buildOutboxRecord(subject, asJson(payload), getCorrelationId() ?? 'unknown', actorId) });
}

/** One line of the request's append-only history. */
export async function recordAction(
  tx: Tx,
  input: { requestId: string; revision: number; step: 'REQUESTER' | Step; action: string; actorId: string; amount?: string | null; comment?: string | null },
): Promise<void> {
  await tx.approvalAction.create({
    data: {
      id: uuidv7(), requestId: input.requestId, revision: input.revision, step: input.step, action: input.action,
      actorId: input.actorId, amount: input.amount ?? null, comment: input.comment ?? null,
    },
  });
}
```

- [ ] **Step 4: Write `serialize.ts`**

```ts
import type { ApprovalAction, FinanceRequest, Payment, RequestInvoice } from '@prisma-clients/finance';

const money = (value: { toFixed(digits: number): string } | null): string | null => value?.toFixed(2) ?? null;

/** A request as JSON: amounts are two-decimal strings, never Decimal objects. */
export function serializeRequest(row: FinanceRequest) {
  return {
    ...row,
    requestedAmount: row.requestedAmount.toFixed(2),
    approvedAmount: money(row.approvedAmount),
    appliedAmount: money(row.appliedAmount),
  };
}

type Detail = FinanceRequest & { invoices?: RequestInvoice[]; actions?: ApprovalAction[]; payments?: Payment[] };

/** A request with whichever of its invoices, history and payments were loaded. */
export function serializeDetail(row: Detail) {
  const { invoices, actions, payments, ...rest } = row;
  return {
    ...serializeRequest(rest),
    ...(invoices ? { invoices: invoices.map((i) => ({ ...i, amount: i.amount.toFixed(2) })) } : {}),
    ...(actions ? { actions: actions.map((a) => ({ ...a, amount: money(a.amount) })) } : {}),
    ...(payments ? { payments: payments.map((p) => ({ ...p, amount: p.amount.toFixed(2) })) } : {}),
  };
}
```

- [ ] **Step 5: Write the failing ledger test**

`apps/finance/src/ledger.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../prisma/test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb } from '../prisma/fixtures.js';
import { loadBalance } from './ledger.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

async function row(over: Record<string, unknown>) {
  return prisma.financeRequest.create({
    data: {
      id: uuidv7(), number: `N-${uuidv7()}`.slice(0, 30), kind: 'ADVANCE', status: 'PAID',
      projectId: PROJECT.id, projectCode: PROJECT.code, projectName: PROJECT.name,
      categoryId: await aCategory(prisma), requesterId: ACTORS.engineer.id, purpose: 'x',
      requestedAmount: '50000.00', approvedAmount: '50000.00', ...over,
    },
  });
}

describe('loadBalance', () => {
  it('derives outstanding from settled settlements and returned cash only', async () => {
    const advance = await row({});
    await row({ kind: 'SETTLEMENT', status: 'SETTLED', advanceId: advance.id, approvedAmount: '12000.00', appliedAmount: '12000.00' });
    await row({ kind: 'SETTLEMENT', status: 'PENDING_PM', advanceId: advance.id, requestedAmount: '9999.00' }); // pending: ignored
    await prisma.payment.create({ data: { id: uuidv7(), requestId: advance.id, kind: 'CASH_RETURN', mode: 'CASH', reference: 'V-1', paidOn: new Date('2026-10-05'), amount: '3000.00', recordedBy: ACTORS.finance.id } });

    expect(await loadBalance(prisma, advance.id)).toEqual({
      paid: '50000.00', applied: '12000.00', cashReturned: '3000.00', outstanding: '35000.00', status: 'PARTIALLY_SETTLED',
    });
  });

  it('works inside a transaction', async () => {
    const advance = await row({});
    await prisma.$transaction(async (tx) => {
      expect((await loadBalance(tx, advance.id)).outstanding).toBe('50000.00');
    });
  });
});
```

Run: `pnpm --filter finance exec vitest run src/ledger.integration.spec.ts` — Expected: FAIL (cannot resolve `./ledger.js`).

- [ ] **Step 6: Implement `ledger.ts`**

```ts
import type { PrismaClient } from '@prisma-clients/finance';
import { advanceBalance, type AdvanceBalance } from './balance.js';
import type { Tx } from './common.js';

/**
 * Serialises everything that moves an advance's balance. A settlement being
 * settled and cash being returned both read the balance and then write against
 * it; without the row lock two of them could each see the same outstanding
 * amount and together over-apply it.
 */
export async function lockAdvance(tx: Tx, advanceId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "finance_request" WHERE "id" = ${advanceId}::uuid FOR UPDATE`;
}

/** The advance's balance, derived from its settled settlements and returned cash. */
export async function loadBalance(db: PrismaClient | Tx, advanceId: string): Promise<AdvanceBalance> {
  const advance = await db.financeRequest.findUniqueOrThrow({ where: { id: advanceId }, select: { approvedAmount: true } });
  const [settlements, returns] = await Promise.all([
    db.financeRequest.findMany({ where: { advanceId, status: 'SETTLED' }, select: { appliedAmount: true } }),
    db.payment.findMany({ where: { requestId: advanceId, kind: 'CASH_RETURN' }, select: { amount: true } }),
  ]);
  return advanceBalance({
    paid: advance.approvedAmount?.toFixed(2) ?? '0.00',
    applied: settlements.map((s) => s.appliedAmount?.toFixed(2) ?? '0.00'),
    cashReturned: returns.map((r) => r.amount.toFixed(2)),
  });
}
```

- [ ] **Step 7: Run to verify it passes, typecheck, commit**

Run: `pnpm --filter finance exec vitest run src/ledger.integration.spec.ts && pnpm --filter finance typecheck`
Expected: PASS, no type errors.

```bash
git add apps/finance/src/common.ts apps/finance/src/audit.ts apps/finance/src/events.ts apps/finance/src/serialize.ts apps/finance/src/ledger.ts apps/finance/src/ledger.integration.spec.ts
git commit -m "feat(finance): shared plumbing, audit and event writers, advance ledger

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: RequestService (create, edit, submit, cancel)

**Files:**
- Create: `apps/finance/src/requests/request.service.ts`
- Create: `apps/finance/src/requests/request.service.integration.spec.ts`

**Interfaces:**
- Consumes: `Actor`, `ProjectRef`, `inScope`, `notFound`, `requirePermission` (Task 7); `entryStatus`, `isEditable`, `isPending`, `isPm`, `stepOf` (Task 6); `sumMoney` (Task 5); `loadBalance` (Task 7); `CreateRequestDto`, `UpdateRequestDto` (Task 2); `recordAudit`, `asJson`, `emit`, `factsOf`, `recordAction`.
- Produces: `class RequestService { constructor(prisma: PrismaClient) }` with
  - `create(dto: CreateRequestDto, actor: Actor, scope: AuthzScope, project?: ProjectRef): Promise<ReturnType<typeof serializeDetail>>`
  - `update(id: string, dto: UpdateRequestDto, actor: Actor): Promise<…>`
  - `submit(id: string, actor: Actor): Promise<…>`
  - `cancel(id: string, comment: string | undefined, actor: Actor): Promise<…>`

- [ ] **Step 1: Write the failing tests**

`apps/finance/src/requests/request.service.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { uuidv7, type CreateRequestDto } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { RequestService } from './request.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: RequestService;
let categoryId: string;

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; service = new RequestService(prisma); categoryId = await aCategory(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const invoice = (amount: string) => ({ vendor: 'Himal Fuel', invoiceNumber: `INV-${amount}`, invoiceDate: new Date('2026-10-01'), amount, mediaId: uuidv7() });
const advanceDto = (amount = '50000'): CreateRequestDto => ({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Site travel', amount });

/** Makes a PAID advance for the engineer, without going through the whole chain. */
async function paidAdvance(approved = '50000.00') {
  const created = await service.create(advanceDto(approved), ACTORS.engineer, scopes.project, PROJECT);
  await prisma.financeRequest.update({ where: { id: created.id }, data: { status: 'PAID', approvedAmount: approved } });
  return created.id;
}

describe('create', () => {
  it('creates a draft advance with a number, the project snapshot and the requested amount', async () => {
    const created = await service.create(advanceDto('50000'), ACTORS.engineer, scopes.project, PROJECT);
    expect(created).toMatchObject({
      kind: 'ADVANCE', status: 'DRAFT', requesterId: ACTORS.engineer.id, projectCode: 'KOS', projectName: 'Koshi Rollout',
      requestedAmount: '50000.00', approvedAmount: null,
    });
    expect(created.number).toMatch(/^ADV-\d{4}-0001$/);
  });

  it('numbers each kind and year independently and in sequence', async () => {
    const a = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    const b = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    expect(a.number.endsWith('-0001')).toBe(true);
    expect(b.number.endsWith('-0002')).toBe(true);
    const r = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('100')] }, ACTORS.engineer, scopes.project, PROJECT);
    expect(r.number).toMatch(/^REI-\d{4}-0001$/);
  });

  it('sums invoices into the requested amount of a reimbursement', async () => {
    const r = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('100.10'), invoice('250.25')] }, ACTORS.engineer, scopes.project, PROJECT);
    expect(r.requestedAmount).toBe('350.35');
    expect(r.invoices).toHaveLength(2);
  });

  it('refuses a project outside the caller\'s scope', async () => {
    await expect(service.create(advanceDto(), ACTORS.engineer, scopes.otherProject, PROJECT)).rejects.toThrow(/access to this project/);
  });

  it('refuses without the create permission', async () => {
    const viewer = { id: uuidv7(), permissions: ['finance_request.view'] };
    await expect(service.create(advanceDto(), viewer, scopes.project, PROJECT)).rejects.toThrow(/finance_request\.create/);
  });

  it('refuses a disabled or unknown category', async () => {
    await expect(service.create({ ...advanceDto(), categoryId: uuidv7() }, ACTORS.engineer, scopes.project, PROJECT)).rejects.toThrow(/active expense category/);
  });

  it('settles only a paid advance that belongs to the caller', async () => {
    const advanceId = await paidAdvance();
    const dto: CreateRequestDto = { kind: 'SETTLEMENT', advanceId, categoryId, purpose: 'Fuel bills', invoices: [invoice('4000')] };

    const settlement = await service.create(dto, ACTORS.engineer, scopes.project);
    expect(settlement).toMatchObject({ kind: 'SETTLEMENT', projectId: PROJECT.id, advanceId, requestedAmount: '4000.00' });
    expect(settlement.number).toMatch(/^SET-/);

    await expect(service.create(dto, ACTORS.otherEngineer, scopes.project)).rejects.toThrow(/Advance not found/);
    const draftAdvance = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.create({ ...dto, advanceId: draftAdvance.id }, ACTORS.engineer, scopes.project)).rejects.toThrow(/paid advance/);
  });

  it('needs the settlement permission to settle', async () => {
    const advanceId = await paidAdvance();
    const noSettle = { id: ACTORS.engineer.id, permissions: ['finance_request.view', 'finance_request.create'] };
    await expect(service.create({ kind: 'SETTLEMENT', advanceId, categoryId, purpose: 'x', invoices: [invoice('1')] }, noSettle, scopes.project)).rejects.toThrow(/finance_settlement\.submit/);
  });
});

describe('update', () => {
  it('edits a draft, replacing invoices and recomputing the amount', async () => {
    const r = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('100')] }, ACTORS.engineer, scopes.project, PROJECT);
    const updated = await service.update(r.id, { purpose: 'Fuel and tolls', invoices: [invoice('300'), invoice('50.50')] }, ACTORS.engineer);
    expect(updated).toMatchObject({ purpose: 'Fuel and tolls', requestedAmount: '350.50' });
    expect(updated.invoices).toHaveLength(2);
  });

  it('refuses someone else\'s request, and a request already submitted', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.update(r.id, { purpose: 'x' }, ACTORS.otherEngineer)).rejects.toThrow(/not found/);
    await service.submit(r.id, ACTORS.engineer);
    await expect(service.update(r.id, { purpose: 'y' }, ACTORS.engineer)).rejects.toThrow(/draft or returned/);
  });

  it('refuses an amount on a request that has invoices, and invoices on an advance', async () => {
    const adv = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.update(adv.id, { invoices: [invoice('1')] }, ACTORS.engineer)).rejects.toThrow(/advance has no invoices/i);
    const rei = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('100')] }, ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.update(rei.id, { amount: '5' }, ACTORS.engineer)).rejects.toThrow(/total of its invoices/i);
  });
});

describe('submit', () => {
  it('sends an engineer\'s request to the PM and records it', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    const submitted = await service.submit(r.id, ACTORS.engineer);
    expect(submitted).toMatchObject({ status: 'PENDING_PM', entryStatus: 'PENDING_PM', revision: 1 });
    expect(submitted.submittedAt).not.toBeNull();
    expect((await prisma.approvalAction.findMany({ where: { requestId: r.id } })).map((a) => [a.step, a.action])).toEqual([['REQUESTER', 'SUBMITTED']]);
    const events = await prisma.outboxEvent.findMany({ where: { subject: 'finance.request.submitted' } });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ requestId: r.id, nextStep: 'PM', requesterId: ACTORS.engineer.id, projectName: 'Koshi Rollout' });
  });

  it('sends a PM\'s request straight to the Director', async () => {
    const r = await service.create(advanceDto(), ACTORS.pm, scopes.project, PROJECT);
    const submitted = await service.submit(r.id, ACTORS.pm);
    expect(submitted.status).toBe('PENDING_DIRECTOR');
    expect((await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.submitted' } })).payload).toMatchObject({ nextStep: 'DIRECTOR' });
  });

  it('also writes an audit event', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await service.submit(r.id, ACTORS.engineer);
    const audits = await prisma.outboxEvent.findMany({ where: { subject: 'audit.event.recorded' } });
    expect(audits.map((a) => (a.payload as { action: string }).action)).toEqual(expect.arrayContaining(['finance.request.created', 'finance.request.submitted']));
  });

  it('refuses to submit someone else\'s request', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.submit(r.id, ACTORS.otherEngineer)).rejects.toThrow(/not found/);
  });

  it('re-enters at the original step with a bumped revision after a return', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await service.submit(r.id, ACTORS.engineer);
    await prisma.financeRequest.update({ where: { id: r.id }, data: { status: 'RETURNED' } });
    const again = await service.submit(r.id, ACTORS.engineer);
    expect(again).toMatchObject({ status: 'PENDING_PM', revision: 2 });
  });

  it('refuses to settle an advance that is already fully settled', async () => {
    const advanceId = await paidAdvance('1000.00');
    const dto: CreateRequestDto = { kind: 'SETTLEMENT', advanceId, categoryId, purpose: 'x', invoices: [invoice('1000')] };
    const s = await service.create(dto, ACTORS.engineer, scopes.project);
    await prisma.financeRequest.create({ data: {
      id: uuidv7(), number: 'SET-2026-9999', kind: 'SETTLEMENT', status: 'SETTLED', advanceId, projectId: PROJECT.id, projectCode: 'KOS', projectName: 'K',
      categoryId, requesterId: ACTORS.engineer.id, purpose: 'x', requestedAmount: '1000.00', approvedAmount: '1000.00', appliedAmount: '1000.00',
    } });
    await expect(service.submit(s.id, ACTORS.engineer)).rejects.toThrow(/nothing outstanding/);
  });
});

describe('cancel', () => {
  it('lets the requester cancel while pending, recording who was holding it', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await service.submit(r.id, ACTORS.engineer);
    const cancelled = await service.cancel(r.id, 'No longer needed', ACTORS.engineer);
    expect(cancelled.status).toBe('CANCELLED');
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.cancelled' } });
    expect(event.payload).toMatchObject({ heldBy: 'PM', comment: 'No longer needed' });
  });

  it('refuses anyone but the requester, and a request that is not pending', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.cancel(r.id, undefined, ACTORS.engineer)).rejects.toThrow(/pending/);
    await service.submit(r.id, ACTORS.engineer);
    await expect(service.cancel(r.id, undefined, ACTORS.otherEngineer)).rejects.toThrow(/not found/);
  });

  it('needs the cancel permission', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await service.submit(r.id, ACTORS.engineer);
    await expect(service.cancel(r.id, undefined, { id: ACTORS.engineer.id, permissions: ['finance_request.view'] })).rejects.toThrow(/finance_request\.cancel/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter finance exec vitest run src/requests/request.service.integration.spec.ts`
Expected: FAIL (cannot resolve `./request.service.js`).

- [ ] **Step 3: Implement `RequestService`**

`apps/finance/src/requests/request.service.ts`:

```ts
import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import { SUBJECTS } from '@ipms/events';
import { uuidv7, type CreateRequestDto, type InvoiceInput, type RequestKind, type UpdateRequestDto } from '@ipms/contracts';
import type { FinanceRequest, PrismaClient } from '@prisma-clients/finance';
import { asJson, recordAudit } from '../audit.js';
import { inScope, notFound, requirePermission, type Actor, type ProjectRef, type Tx } from '../common.js';
import { emit, factsOf, recordAction } from '../events.js';
import { compareMoney, sumMoney } from '../money.js';
import { loadBalance } from '../ledger.js';
import { serializeDetail } from '../serialize.js';
import { entryStatus, isEditable, isPending, isPm, stepOf } from '../workflow.js';

const NUMBER_PREFIX: Record<RequestKind, string> = { ADVANCE: 'ADV', SETTLEMENT: 'SET', REIMBURSEMENT: 'REI' };
const WITH_DETAIL = { invoices: true, actions: { orderBy: { at: 'asc' as const } }, payments: true };

/**
 * A request's life before anyone approves it: drafting, editing, submitting and
 * cancelling. Only the requester ever touches a request here.
 */
export class RequestService {
  constructor(private readonly prisma: PrismaClient) {}

  /** `project` is required for an advance or reimbursement; a settlement takes its advance's project. */
  async create(dto: CreateRequestDto, actor: Actor, scope: AuthzScope, project?: ProjectRef) {
    requirePermission(actor, dto.kind === 'SETTLEMENT' ? 'finance_settlement.submit' : 'finance_request.create');

    const category = await this.prisma.expenseCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category || category.disabledAt) throw new UnprocessableEntityException('Choose an active expense category');

    let ref: ProjectRef;
    let advanceId: string | null = null;
    if (dto.kind === 'SETTLEMENT') {
      const advance = await this.prisma.financeRequest.findUnique({ where: { id: dto.advanceId } });
      // Missing and "someone else's" look the same on purpose.
      if (!advance || advance.kind !== 'ADVANCE' || advance.requesterId !== actor.id) throw notFound('Advance');
      if (advance.status !== 'PAID') throw new UnprocessableEntityException('Only a paid advance can be settled');
      ref = { id: advance.projectId, code: advance.projectCode, name: advance.projectName };
      advanceId = advance.id;
    } else {
      if (!project || project.id !== dto.projectId) throw new BadRequestException('The project could not be resolved');
      ref = project;
    }
    if (!inScope(scope, ref.id)) throw new ForbiddenException('You do not have access to this project');

    const invoices = dto.kind === 'ADVANCE' ? [] : dto.invoices;
    const requestedAmount = dto.kind === 'ADVANCE' ? dto.amount : sumMoney(invoices.map((i) => i.amount));

    const id = await this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRequest.create({
        data: {
          id: uuidv7(), number: await this.nextNumber(tx, dto.kind), kind: dto.kind, status: 'DRAFT',
          projectId: ref.id, projectCode: ref.code, projectName: ref.name,
          workOrderId: dto.workOrderId ?? null, categoryId: dto.categoryId, requesterId: actor.id, advanceId,
          purpose: dto.purpose, requestedAmount,
        },
      });
      await this.writeInvoices(tx, row.id, invoices);
      await recordAudit(tx, { actorId: actor.id, action: 'finance.request.created', objectId: row.id, previousState: {}, newState: asJson({ number: row.number, kind: row.kind, requestedAmount }) });
      return row.id;
    });
    return this.detail(id);
  }

  async update(id: string, dto: UpdateRequestDto, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.own(tx, id, actor);
      if (!isEditable(row.status)) throw new ConflictException('Only a draft or returned request can be edited');
      if (dto.invoices && row.kind === 'ADVANCE') throw new UnprocessableEntityException('An advance has no invoices');
      if (dto.amount && row.kind !== 'ADVANCE') throw new UnprocessableEntityException('The amount of this request is the total of its invoices');
      if (dto.categoryId) {
        const category = await tx.expenseCategory.findUnique({ where: { id: dto.categoryId } });
        if (!category || category.disabledAt) throw new UnprocessableEntityException('Choose an active expense category');
      }

      let requestedAmount = row.requestedAmount.toFixed(2);
      if (dto.amount) requestedAmount = dto.amount;
      if (dto.invoices) {
        await tx.requestInvoice.deleteMany({ where: { requestId: id } });
        await this.writeInvoices(tx, id, dto.invoices);
        requestedAmount = sumMoney(dto.invoices.map((i) => i.amount));
      }
      await tx.financeRequest.update({
        where: { id },
        data: {
          requestedAmount,
          ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
          ...(dto.purpose ? { purpose: dto.purpose } : {}),
          ...(dto.workOrderId !== undefined ? { workOrderId: dto.workOrderId } : {}),
        },
      });
      await recordAudit(tx, { actorId: actor.id, action: 'finance.request.updated', objectId: id, previousState: asJson({ requestedAmount: row.requestedAmount, purpose: row.purpose }), newState: asJson({ requestedAmount, purpose: dto.purpose ?? row.purpose }) });
    });
    return this.detail(id);
  }

  async submit(id: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.own(tx, id, actor);
      if (!isEditable(row.status)) throw new ConflictException('Only a draft or returned request can be submitted');
      if (row.kind !== 'ADVANCE' && (await tx.requestInvoice.count({ where: { requestId: id } })) === 0) {
        throw new UnprocessableEntityException('Add at least one invoice before submitting');
      }
      if (row.kind === 'SETTLEMENT' && row.advanceId) {
        const balance = await loadBalance(tx, row.advanceId);
        if (compareMoney(balance.outstanding, '0') <= 0) throw new UnprocessableEntityException('This advance has nothing outstanding to settle');
      }

      const entry = row.entryStatus ?? entryStatus(isPm(actor.permissions));
      const revision = row.status === 'RETURNED' ? row.revision + 1 : row.revision;
      const moved = await tx.financeRequest.updateMany({
        where: { id, status: row.status, revision: row.revision },
        data: { status: entry, entryStatus: entry, revision, submittedAt: new Date() },
      });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');

      await recordAction(tx, { requestId: id, revision, step: 'REQUESTER', action: 'SUBMITTED', actorId: actor.id });
      const after = await tx.financeRequest.findUniqueOrThrow({ where: { id } });
      await emit(tx, SUBJECTS.FINANCE_REQUEST_SUBMITTED, { ...factsOf(after, actor.id, null), nextStep: stepOf(entry) }, actor.id);
      await recordAudit(tx, { actorId: actor.id, action: 'finance.request.submitted', objectId: id, previousState: { status: row.status }, newState: { status: entry, revision } });
    });
    return this.detail(id);
  }

  async cancel(id: string, comment: string | undefined, actor: Actor) {
    requirePermission(actor, 'finance_request.cancel');
    await this.prisma.$transaction(async (tx) => {
      const row = await this.own(tx, id, actor);
      if (!isPending(row.status)) throw new ConflictException('Only a pending request can be cancelled');
      const heldBy = stepOf(row.status)!;
      const moved = await tx.financeRequest.updateMany({ where: { id, status: row.status, revision: row.revision }, data: { status: 'CANCELLED' } });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');

      await recordAction(tx, { requestId: id, revision: row.revision, step: 'REQUESTER', action: 'CANCELLED', actorId: actor.id, comment: comment ?? null });
      const after = await tx.financeRequest.findUniqueOrThrow({ where: { id } });
      await emit(tx, SUBJECTS.FINANCE_REQUEST_CANCELLED, { ...factsOf(after, actor.id, comment ?? null), heldBy }, actor.id);
      await recordAudit(tx, { actorId: actor.id, action: 'finance.request.cancelled', objectId: id, previousState: { status: row.status }, newState: { status: 'CANCELLED' } });
    });
    return this.detail(id);
  }

  private async detail(id: string) {
    return serializeDetail(await this.prisma.financeRequest.findUniqueOrThrow({ where: { id }, include: WITH_DETAIL }));
  }

  /** The request, if it exists and is the actor's; otherwise "not found". */
  private async own(tx: Tx, id: string, actor: Actor): Promise<FinanceRequest> {
    const row = await tx.financeRequest.findUnique({ where: { id } });
    if (!row || row.requesterId !== actor.id) throw notFound('Request');
    return row;
  }

  private async writeInvoices(tx: Tx, requestId: string, invoices: InvoiceInput[]): Promise<void> {
    if (invoices.length === 0) return;
    await tx.requestInvoice.createMany({
      data: invoices.map((i) => ({ id: uuidv7(), requestId, vendor: i.vendor, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, amount: i.amount, mediaId: i.mediaId })),
    });
  }

  /** ADV-2026-0001. One counter row per kind and year, incremented atomically inside the caller's transaction. */
  private async nextNumber(tx: Tx, kind: RequestKind): Promise<string> {
    const key = `${NUMBER_PREFIX[kind]}-${new Date().getUTCFullYear()}`;
    const counter = await tx.numberCounter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
    return `${key}-${String(counter.value).padStart(4, '0')}`;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter finance exec vitest run src/requests/request.service.integration.spec.ts && pnpm --filter finance typecheck`
Expected: PASS (all tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/finance/src/requests
git commit -m "feat(finance): request drafting, submission and cancellation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: ApprovalService (approve, return, reject)

**Files:**
- Create: `apps/finance/src/approvals/approval.service.ts`
- Create: `apps/finance/src/approvals/approval.service.integration.spec.ts`

**Interfaces:**
- Consumes: `Actor`, `inScope`, `notFound`, `Tx`; `STEP_PERMISSION`, `statusAfterApproval`, `stepOf`; `compareMoney`; `recordAction`, `emit`, `factsOf`, `recordAudit`, `serializeDetail`.
- Produces: `class ApprovalService { constructor(prisma: PrismaClient) }` with
  - `approve(id: string, dto: ApproveDto, actor: Actor, scope: AuthzScope)`
  - `returnToRequester(id: string, comment: string, actor: Actor, scope: AuthzScope)`
  - `reject(id: string, comment: string, actor: Actor, scope: AuthzScope)`
  each returning the serialized request with invoices/actions/payments.

- [ ] **Step 1: Write the failing tests**

`apps/finance/src/approvals/approval.service.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { RequestService } from '../requests/request.service.js';
import { ApprovalService } from './approval.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let approvals: ApprovalService;
let categoryId: string;

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

async function submitted(requester = ACTORS.engineer, amount = '50000') {
  const r = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount }, requester, scopes.project, PROJECT);
  return requests.submit(r.id, requester);
}

describe('approve', () => {
  it('moves PENDING_PM to PENDING_DIRECTOR when a PM approves, without setting an amount', async () => {
    const r = await submitted();
    const after = await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    expect(after).toMatchObject({ status: 'PENDING_DIRECTOR', approvedAmount: null });
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.approved_by_pm' } });
    expect(event.payload).toMatchObject({ requestId: r.id, actorId: ACTORS.pm.id });
  });

  it('lets the Director approve as requested, moving it to Finance', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    const after = await approvals.approve(r.id, {}, ACTORS.director, scopes.project);
    expect(after).toMatchObject({ status: 'PENDING_FINANCE', approvedAmount: '50000.00' });
    expect(await prisma.outboxEvent.count({ where: { subject: 'finance.request.approved' } })).toBe(1);
  });

  it('lets the Director approve a lower amount', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    const after = await approvals.approve(r.id, { amount: '40000', comment: 'Cut travel days' }, ACTORS.director, scopes.project);
    expect(after.approvedAmount).toBe('40000.00');
    const action = (after.actions ?? []).find((a) => a.step === 'DIRECTOR');
    expect(action).toMatchObject({ action: 'APPROVED', amount: '40000.00', comment: 'Cut travel days' });
  });

  it('refuses a Director amount above the request, or of zero', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    await expect(approvals.approve(r.id, { amount: '50000.01' }, ACTORS.director, scopes.project)).rejects.toThrow(/more than was requested/);
  });

  it('refuses a PM who tries to change the amount', async () => {
    const r = await submitted();
    await expect(approvals.approve(r.id, { amount: '100' }, ACTORS.pm, scopes.project)).rejects.toThrow(/only the project director/i);
  });

  it('skips the PM for a PM-raised request: the Director is first', async () => {
    const r = await submitted(ACTORS.pm);
    expect(r.status).toBe('PENDING_DIRECTOR');
    await expect(approvals.approve(r.id, {}, ACTORS.otherPm, scopes.project)).rejects.toThrow(/finance_approval\.director/);
    expect((await approvals.approve(r.id, {}, ACTORS.director, scopes.project)).status).toBe('PENDING_FINANCE');
  });

  it('never lets anyone approve their own request', async () => {
    const r = await submitted(ACTORS.pm);
    const pmAlsoDirector = { id: ACTORS.pm.id, permissions: [...ACTORS.pm.permissions, 'finance_approval.director'] };
    await expect(approvals.approve(r.id, {}, pmAlsoDirector, scopes.project)).rejects.toThrow(/your own request/);
  });

  it('refuses an approver outside the request\'s project', async () => {
    const r = await submitted();
    await expect(approvals.approve(r.id, {}, ACTORS.pm, scopes.otherProject)).rejects.toThrow(/not found/);
  });

  it('refuses the wrong role for the step', async () => {
    const r = await submitted();
    await expect(approvals.approve(r.id, {}, ACTORS.director, scopes.project)).rejects.toThrow(/finance_approval\.pm/);
  });

  it('refuses a request that is not waiting for approval', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    await expect(approvals.approve(r.id, {}, ACTORS.pm, scopes.project)).rejects.toThrow(/not waiting|finance_approval\.director/);
  });

  it('lets exactly one of two simultaneous approvals through', async () => {
    const r = await submitted();
    const results = await Promise.allSettled([
      approvals.approve(r.id, {}, ACTORS.pm, scopes.project),
      approvals.approve(r.id, {}, ACTORS.otherPm, scopes.project),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.approvalAction.count({ where: { requestId: r.id, action: 'APPROVED' } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { subject: 'finance.request.approved_by_pm' } })).toBe(1);
  });
});

describe('return and reject', () => {
  it('returns to the requester with the comment recorded and announced', async () => {
    const r = await submitted();
    const after = await approvals.returnToRequester(r.id, 'Attach the quotation', ACTORS.pm, scopes.project);
    expect(after.status).toBe('RETURNED');
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.returned' } });
    expect(event.payload).toMatchObject({ requesterId: ACTORS.engineer.id, comment: 'Attach the quotation' });
  });

  it('lets the engineer resubmit a returned request, restarting at the PM', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    await approvals.returnToRequester(r.id, 'Reduce the amount', ACTORS.director, scopes.project);
    const again = await requests.submit(r.id, ACTORS.engineer);
    expect(again).toMatchObject({ status: 'PENDING_PM', revision: 2 });
  });

  it('rejects for good, with a comment', async () => {
    const r = await submitted();
    const after = await approvals.reject(r.id, 'Not in budget', ACTORS.pm, scopes.project);
    expect(after.status).toBe('REJECTED');
    expect(await prisma.outboxEvent.count({ where: { subject: 'finance.request.rejected' } })).toBe(1);
    await expect(requests.submit(r.id, ACTORS.engineer)).rejects.toThrow(/draft or returned/);
  });

  it('applies the same step, scope and self-approval rules as approve', async () => {
    const r = await submitted(ACTORS.pm);
    await expect(approvals.reject(r.id, 'no', ACTORS.director, scopes.otherProject)).rejects.toThrow(/not found/);
    await expect(approvals.returnToRequester(r.id, 'no', ACTORS.otherPm, scopes.project)).rejects.toThrow(/finance_approval\.director/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter finance exec vitest run src/approvals/approval.service.integration.spec.ts`
Expected: FAIL (cannot resolve `./approval.service.js`).

- [ ] **Step 3: Implement `ApprovalService`**

`apps/finance/src/approvals/approval.service.ts`:

```ts
import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import type { ApproveDto } from '@ipms/contracts';
import { SUBJECTS } from '@ipms/events';
import type { PrismaClient } from '@prisma-clients/finance';
import { recordAudit } from '../audit.js';
import { inScope, notFound, type Actor } from '../common.js';
import { emit, factsOf, recordAction } from '../events.js';
import { compareMoney } from '../money.js';
import { serializeDetail } from '../serialize.js';
import { STEP_PERMISSION, statusAfterApproval, stepOf, type Step } from '../workflow.js';

type Outcome = 'APPROVED' | 'RETURNED' | 'REJECTED';

/**
 * The PM and Director steps. One route serves both, so the step is read from
 * the request's status and the permission it needs is checked here, together
 * with scope and the no-self-approval rule. Finance's step is PaymentService.
 */
export class ApprovalService {
  constructor(private readonly prisma: PrismaClient) {}

  approve(id: string, dto: ApproveDto, actor: Actor, scope: AuthzScope) {
    return this.act(id, 'APPROVED', dto.comment ?? null, dto.amount, actor, scope);
  }

  returnToRequester(id: string, comment: string, actor: Actor, scope: AuthzScope) {
    return this.act(id, 'RETURNED', comment, undefined, actor, scope);
  }

  reject(id: string, comment: string, actor: Actor, scope: AuthzScope) {
    return this.act(id, 'REJECTED', comment, undefined, actor, scope);
  }

  private async act(id: string, outcome: Outcome, comment: string | null, amount: string | undefined, actor: Actor, scope: AuthzScope) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRequest.findUnique({ where: { id } });
      // Out of scope looks like missing, so a request's existence is not disclosed across projects.
      if (!row || !inScope(scope, row.projectId)) throw notFound('Request');

      const step = stepOf(row.status);
      if (step === null || step === 'FINANCE') throw new ConflictException('This request is not waiting for an approval');
      if (!actor.permissions.includes(STEP_PERMISSION[step])) throw new ForbiddenException(`This step needs the ${STEP_PERMISSION[step]} permission`);
      if (row.requesterId === actor.id) throw new ForbiddenException('You cannot act on your own request');

      let approvedAmount: string | undefined;
      if (outcome === 'APPROVED') {
        if (step === 'PM') {
          if (amount !== undefined) throw new UnprocessableEntityException('Only the project director can change the amount');
        } else {
          approvedAmount = amount ?? row.requestedAmount.toFixed(2);
          if (compareMoney(approvedAmount, row.requestedAmount.toFixed(2)) > 0) {
            throw new UnprocessableEntityException('The approved amount cannot be more than was requested');
          }
        }
      }

      const next = outcome === 'APPROVED' ? statusAfterApproval(row.status as 'PENDING_PM' | 'PENDING_DIRECTOR') : outcome;
      const moved = await tx.financeRequest.updateMany({
        where: { id, status: row.status, revision: row.revision },
        data: { status: next, ...(approvedAmount === undefined ? {} : { approvedAmount }) },
      });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');

      await recordAction(tx, { requestId: id, revision: row.revision, step, action: outcome, actorId: actor.id, amount: approvedAmount ?? null, comment });
      const after = await tx.financeRequest.findUniqueOrThrow({ where: { id } });
      await emit(tx, subjectFor(outcome, step), factsOf(after, actor.id, comment), actor.id);
      await recordAudit(tx, {
        actorId: actor.id, action: `finance.request.${outcome.toLowerCase()}`, objectId: id,
        previousState: { status: row.status }, newState: { status: next, step, ...(approvedAmount === undefined ? {} : { approvedAmount }) },
      });
    });
    return serializeDetail(await this.prisma.financeRequest.findUniqueOrThrow({
      where: { id }, include: { invoices: true, actions: { orderBy: { at: 'asc' } }, payments: true },
    }));
  }
}

function subjectFor(outcome: Outcome, step: Step): string {
  if (outcome === 'RETURNED') return SUBJECTS.FINANCE_REQUEST_RETURNED;
  if (outcome === 'REJECTED') return SUBJECTS.FINANCE_REQUEST_REJECTED;
  return step === 'PM' ? SUBJECTS.FINANCE_REQUEST_APPROVED_BY_PM : SUBJECTS.FINANCE_REQUEST_APPROVED;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter finance exec vitest run src/approvals/approval.service.integration.spec.ts && pnpm --filter finance typecheck`
Expected: PASS (all tests, including the simultaneous-approval test), no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/finance/src/approvals
git commit -m "feat(finance): PM and Director approval, return and reject

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: PaymentService (pay, settle, return cash)

**Files:**
- Create: `apps/finance/src/payments/payment.service.ts`
- Create: `apps/finance/src/payments/payment.service.integration.spec.ts`

**Interfaces:**
- Consumes: `lockAdvance`, `loadBalance` (Task 7); `planSettlement` (Task 5); `finalStatus` (Task 6); `PaymentDetailsSchema`, `PayRequestSchema`, `CashReturnDto` (Task 2); `emit`, `factsOf`, `recordAction`, `recordAudit`, `serializeDetail`.
- Produces: `class PaymentService { constructor(prisma: PrismaClient) }` with
  - `pay(id: string, body: z.infer<typeof PayRequestSchema>, actor: Actor, scope: AuthzScope)`
  - `returnCash(advanceId: string, dto: CashReturnDto, actor: Actor, scope: AuthzScope)`
  and `advanceView(id, actor, scope)` is in Task 11 (QueryService).

- [ ] **Step 1: Write the failing tests**

`apps/finance/src/payments/payment.service.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { loadBalance } from '../ledger.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { RequestService } from '../requests/request.service.js';
import { PaymentService } from './payment.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let approvals: ApprovalService;
let payments: PaymentService;
let categoryId: string;

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const bank = { mode: 'BANK_TRANSFER' as const, reference: 'TXN-1', paidOn: new Date('2026-10-05') };
const invoice = (amount: string) => ({ vendor: 'V', invoiceNumber: `I-${amount}`, invoiceDate: new Date('2026-10-01'), amount, mediaId: uuidv7() });

/** Takes a request through both approvals so it waits at Finance. */
async function atFinance(id: string, directorAmount?: string) {
  await approvals.approve(id, {}, ACTORS.pm, scopes.project);
  await approvals.approve(id, directorAmount ? { amount: directorAmount } : {}, ACTORS.director, scopes.project);
}

async function advance(amount = '50000') {
  const r = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount }, ACTORS.engineer, scopes.project, PROJECT);
  await requests.submit(r.id, ACTORS.engineer);
  await atFinance(r.id);
  return r.id;
}

async function paidAdvance(amount = '50000') {
  const id = await advance(amount);
  await payments.pay(id, bank, ACTORS.finance, scopes.global);
  return id;
}

async function settlementAtFinance(advanceId: string, invoiceAmount: string, directorAmount?: string) {
  const s = await requests.create({ kind: 'SETTLEMENT', advanceId, categoryId, purpose: 'Bills', invoices: [invoice(invoiceAmount)] }, ACTORS.engineer, scopes.project);
  await requests.submit(s.id, ACTORS.engineer);
  await atFinance(s.id, directorAmount);
  return s.id;
}

describe('pay an advance or reimbursement', () => {
  it('pays exactly the approved amount, recording the payment and announcing it to everyone involved', async () => {
    const r = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount: '50000' }, ACTORS.engineer, scopes.project, PROJECT);
    await requests.submit(r.id, ACTORS.engineer);
    await atFinance(r.id, '40000');

    const paid = await payments.pay(r.id, { ...bank, note: 'Paid via NIC Asia' }, ACTORS.finance, scopes.global);
    expect(paid.status).toBe('PAID');
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments?.[0]).toMatchObject({ kind: 'PAYOUT', amount: '40000.00', reference: 'TXN-1', recordedBy: ACTORS.finance.id });

    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.paid' } });
    expect(event.payload).toMatchObject({
      requestId: r.id, paidAmount: '40000.00', requesterId: ACTORS.engineer.id,
      approvers: { pmId: ACTORS.pm.id, directorId: ACTORS.director.id },
    });
  });

  it('reports no PM approver when a PM raised the request', async () => {
    const r = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount: '1000' }, ACTORS.pm, scopes.project, PROJECT);
    await requests.submit(r.id, ACTORS.pm);
    await approvals.approve(r.id, {}, ACTORS.director, scopes.project);
    await payments.pay(r.id, bank, ACTORS.finance, scopes.global);
    expect((await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.paid' } })).payload).toMatchObject({ approvers: { pmId: null, directorId: ACTORS.director.id } });
  });

  it('refuses without payment details, and anyone who is not Finance', async () => {
    const id = await advance();
    await expect(payments.pay(id, {}, ACTORS.finance, scopes.global)).rejects.toThrow(/payment details/i);
    await expect(payments.pay(id, bank, ACTORS.pm, scopes.project)).rejects.toThrow(/finance_payment\.record/);
  });

  it('refuses a request that is not at the Finance step, and pays only once', async () => {
    const r = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'x', amount: '10' }, ACTORS.engineer, scopes.project, PROJECT);
    await requests.submit(r.id, ACTORS.engineer);
    await expect(payments.pay(r.id, bank, ACTORS.finance, scopes.global)).rejects.toThrow(/not waiting for payment/);
    await atFinance(r.id);
    await payments.pay(r.id, bank, ACTORS.finance, scopes.global);
    await expect(payments.pay(r.id, bank, ACTORS.finance, scopes.global)).rejects.toThrow(/not waiting for payment/);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('refuses Finance whose scope does not reach the project', async () => {
    const id = await advance();
    await expect(payments.pay(id, bank, ACTORS.finance, scopes.otherProject)).rejects.toThrow(/not found/);
  });

  it('pays a reimbursement', async () => {
    const r = await requests.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('800')] }, ACTORS.engineer, scopes.project, PROJECT);
    await requests.submit(r.id, ACTORS.engineer);
    await atFinance(r.id);
    expect((await payments.pay(r.id, bank, ACTORS.finance, scopes.global)).status).toBe('PAID');
  });
});

describe('settle an advance', () => {
  it('applies the whole settlement and needs no payment details when it fits the balance', async () => {
    const advanceId = await paidAdvance('50000');
    const sId = await settlementAtFinance(advanceId, '12000');
    const settled = await payments.pay(sId, {}, ACTORS.finance, scopes.global);
    expect(settled).toMatchObject({ status: 'SETTLED', appliedAmount: '12000.00' });
    expect(settled.payments).toHaveLength(0);
    expect(await loadBalance(prisma, advanceId)).toMatchObject({ applied: '12000.00', outstanding: '38000.00', status: 'PARTIALLY_SETTLED' });
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.settlement.settled' } });
    expect(event.payload).toMatchObject({ advanceId, appliedAmount: '12000.00', payoutAmount: '0.00' });
  });

  it('applies up to the balance and pays the excess to the engineer, which needs payment details', async () => {
    const advanceId = await paidAdvance('5000');
    const sId = await settlementAtFinance(advanceId, '7000');
    await expect(payments.pay(sId, {}, ACTORS.finance, scopes.global)).rejects.toThrow(/payment details/i);

    const settled = await payments.pay(sId, bank, ACTORS.finance, scopes.global);
    expect(settled).toMatchObject({ status: 'SETTLED', appliedAmount: '5000.00' });
    expect(settled.payments?.[0]).toMatchObject({ kind: 'PAYOUT', amount: '2000.00' });
    expect(await loadBalance(prisma, advanceId)).toMatchObject({ outstanding: '0.00', status: 'CLOSED' });
    expect((await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.settlement.settled' } })).payload).toMatchObject({ appliedAmount: '5000.00', payoutAmount: '2000.00' });
  });

  it('uses the Director\'s reduced amount when applying', async () => {
    const advanceId = await paidAdvance('50000');
    const sId = await settlementAtFinance(advanceId, '9000', '8000');
    expect(await payments.pay(sId, {}, ACTORS.finance, scopes.global)).toMatchObject({ appliedAmount: '8000.00' });
  });

  it('never over-applies when two settlements race for one balance', async () => {
    const advanceId = await paidAdvance('10000');
    const a = await settlementAtFinance(advanceId, '7000');
    const b = await settlementAtFinance(advanceId, '7000');
    await Promise.all([
      payments.pay(a, bank, ACTORS.finance, scopes.global),
      payments.pay(b, bank, ACTORS.finance, scopes.global),
    ]);
    const balance = await loadBalance(prisma, advanceId);
    expect(balance.applied).toBe('10000.00');
    expect(balance.outstanding).toBe('0.00');
    const payouts = await prisma.payment.findMany({ where: { kind: 'PAYOUT', request: { kind: 'SETTLEMENT' } } });
    expect(payouts.map((p) => p.amount.toFixed(2))).toEqual(['4000.00']);
  });
});

describe('return unspent cash', () => {
  it('records returned cash against the advance and lowers the balance', async () => {
    const advanceId = await paidAdvance('50000');
    await payments.returnCash(advanceId, { ...bank, amount: '3000' }, ACTORS.finance, scopes.global);
    expect(await loadBalance(prisma, advanceId)).toMatchObject({ cashReturned: '3000.00', outstanding: '47000.00' });
    expect(await prisma.payment.findFirstOrThrow({ where: { kind: 'CASH_RETURN' } })).toMatchObject({ recordedBy: ACTORS.finance.id });
  });

  it('closes the advance when the rest of it is returned', async () => {
    const advanceId = await paidAdvance('1000');
    await payments.returnCash(advanceId, { ...bank, amount: '1000' }, ACTORS.finance, scopes.global);
    expect((await loadBalance(prisma, advanceId)).status).toBe('CLOSED');
  });

  it('refuses more than is outstanding, an advance that is not paid, and a non-Finance caller', async () => {
    const advanceId = await paidAdvance('1000');
    await expect(payments.returnCash(advanceId, { ...bank, amount: '1000.01' }, ACTORS.finance, scopes.global)).rejects.toThrow(/more than is outstanding/);
    await expect(payments.returnCash(advanceId, { ...bank, amount: '10' }, ACTORS.pm, scopes.project)).rejects.toThrow(/finance_payment\.record/);
    const draft = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'x', amount: '10' }, ACTORS.engineer, scopes.project, PROJECT);
    await expect(payments.returnCash(draft.id, { ...bank, amount: '1' }, ACTORS.finance, scopes.global)).rejects.toThrow(/paid advance/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter finance exec vitest run src/payments/payment.service.integration.spec.ts`
Expected: FAIL (cannot resolve `./payment.service.js`).

- [ ] **Step 3: Implement `PaymentService`**

`apps/finance/src/payments/payment.service.ts`:

```ts
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import { PaymentDetailsSchema, uuidv7, type CashReturnDto, type PaymentDetailsDto } from '@ipms/contracts';
import { SUBJECTS, type FinanceApprovers } from '@ipms/events';
import type { PrismaClient } from '@prisma-clients/finance';
import { planSettlement } from '../balance.js';
import { recordAudit } from '../audit.js';
import { inScope, notFound, requirePermission, type Actor, type Tx } from '../common.js';
import { emit, factsOf, recordAction } from '../events.js';
import { loadBalance, lockAdvance } from '../ledger.js';
import { compareMoney } from '../money.js';
import { serializeDetail } from '../serialize.js';
import { finalStatus } from '../workflow.js';

const FINANCE = 'finance_payment.record';

/**
 * Finance's step: pay an approved advance or reimbursement, settle a
 * settlement against its advance, and record cash an engineer hands back.
 * One payment per request, for exactly the approved amount.
 */
export class PaymentService {
  constructor(private readonly prisma: PrismaClient) {}

  async pay(id: string, body: Partial<PaymentDetailsDto>, actor: Actor, scope: AuthzScope) {
    requirePermission(actor, FINANCE);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRequest.findUnique({ where: { id } });
      if (!row || !inScope(scope, row.projectId)) throw notFound('Request');
      if (row.status !== 'PENDING_FINANCE') throw new ConflictException('This request is not waiting for payment');
      if (row.requesterId === actor.id) throw new ConflictException('You cannot act on your own request');

      const approved = row.approvedAmount!.toFixed(2);
      let applied: string | null = null;
      let payout = approved;

      if (row.kind === 'SETTLEMENT') {
        // The balance is read and then written against: lock the advance so two settlements cannot both see the same room.
        await lockAdvance(tx, row.advanceId!);
        const balance = await loadBalance(tx, row.advanceId!);
        ({ applied, payout } = planSettlement(approved, balance.outstanding));
      }

      if (compareMoney(payout, '0') > 0) {
        const details = PaymentDetailsSchema.safeParse(body);
        if (!details.success) throw new UnprocessableEntityException('Payment details are required: mode, reference and date');
        await this.writePayment(tx, id, 'PAYOUT', payout, details.data, actor);
      }

      const status = finalStatus(row.kind as 'ADVANCE' | 'SETTLEMENT' | 'REIMBURSEMENT');
      const moved = await tx.financeRequest.updateMany({
        where: { id, status: 'PENDING_FINANCE', revision: row.revision },
        data: { status, ...(applied === null ? {} : { appliedAmount: applied }) },
      });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');

      await recordAction(tx, { requestId: id, revision: row.revision, step: 'FINANCE', action: 'PAID', actorId: actor.id, amount: payout });
      const after = await tx.financeRequest.findUniqueOrThrow({ where: { id } });
      const approvers = await this.approversOf(tx, id);
      const facts = factsOf(after, actor.id, null);
      if (row.kind === 'SETTLEMENT') {
        await emit(tx, SUBJECTS.FINANCE_SETTLEMENT_SETTLED, { ...facts, approvers, advanceId: row.advanceId, appliedAmount: applied, payoutAmount: payout }, actor.id);
      } else {
        await emit(tx, SUBJECTS.FINANCE_REQUEST_PAID, { ...facts, approvers, paidAmount: approved }, actor.id);
      }
      await recordAudit(tx, { actorId: actor.id, action: row.kind === 'SETTLEMENT' ? 'finance.settlement.settled' : 'finance.request.paid', objectId: id, previousState: { status: 'PENDING_FINANCE' }, newState: { status, ...(applied === null ? {} : { applied }), payout } });
    });
    return this.detail(id);
  }

  /** Cash an engineer hands back out of an advance. Lowers the balance; never more than is outstanding. */
  async returnCash(advanceId: string, dto: CashReturnDto, actor: Actor, scope: AuthzScope) {
    requirePermission(actor, FINANCE);
    await this.prisma.$transaction(async (tx) => {
      const advance = await tx.financeRequest.findUnique({ where: { id: advanceId } });
      if (!advance || advance.kind !== 'ADVANCE' || !inScope(scope, advance.projectId)) throw notFound('Advance');
      if (advance.status !== 'PAID') throw new UnprocessableEntityException('Cash can only be returned against a paid advance');

      await lockAdvance(tx, advanceId);
      const balance = await loadBalance(tx, advanceId);
      if (compareMoney(dto.amount, balance.outstanding) > 0) throw new UnprocessableEntityException('That is more than is outstanding on this advance');

      await this.writePayment(tx, advanceId, 'CASH_RETURN', dto.amount, dto, actor);
      await recordAudit(tx, { actorId: actor.id, action: 'finance.advance.cash_returned', objectId: advanceId, previousState: { outstanding: balance.outstanding }, newState: { returned: dto.amount } });
    });
    return this.detail(advanceId);
  }

  private async writePayment(tx: Tx, requestId: string, kind: 'PAYOUT' | 'CASH_RETURN', amount: string, d: PaymentDetailsDto, actor: Actor): Promise<void> {
    await tx.payment.create({
      data: {
        id: uuidv7(), requestId, kind, mode: d.mode, reference: d.reference, paidOn: d.paidOn, amount,
        note: d.note ?? null, proofMediaId: d.proofMediaId ?? null, recordedBy: actor.id,
      },
    });
  }

  /** Who approved at each step, read from the request's own history. */
  private async approversOf(tx: Tx, requestId: string): Promise<FinanceApprovers> {
    const approvals = await tx.approvalAction.findMany({ where: { requestId, action: 'APPROVED' }, orderBy: { at: 'desc' } });
    return {
      pmId: approvals.find((a) => a.step === 'PM')?.actorId ?? null,
      directorId: approvals.find((a) => a.step === 'DIRECTOR')!.actorId,
    };
  }

  private async detail(id: string) {
    return serializeDetail(await this.prisma.financeRequest.findUniqueOrThrow({
      where: { id }, include: { invoices: true, actions: { orderBy: { at: 'asc' } }, payments: true },
    }));
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter finance exec vitest run src/payments/payment.service.integration.spec.ts && pnpm --filter finance typecheck`
Expected: PASS (including the two-settlements race), no type errors.

If the race test is flaky because the second payment reads before the first commits, confirm `lockAdvance` runs before `loadBalance` inside the same transaction (it does above); do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add apps/finance/src/payments
git commit -m "feat(finance): payment, settlement against advances, cash return

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Queries, categories and reports

**Files:**
- Create: `apps/finance/src/queries/query.service.ts`, `apps/finance/src/queries/query.service.integration.spec.ts`
- Create: `apps/finance/src/categories/category.service.ts`, `apps/finance/src/categories/category.service.integration.spec.ts`
- Create: `apps/finance/src/queries/report.service.ts`, `apps/finance/src/queries/report.xlsx.ts`, `apps/finance/src/queries/report.service.integration.spec.ts`

**Interfaces:**
- Consumes: `scopeWhere` from `@ipms/authz`; `awaitingStatuses`; `loadBalance`; `serializeRequest`, `serializeDetail`; `ListRequestsQuery`, `ReportQuery`.
- Produces:
  - `class QueryService { constructor(prisma) }`: `list(actor, scope, query): Promise<Paginated<…>>`, `get(id, actor, scope)`, `advance(id, actor, scope)`.
  - `class CategoryService { constructor(prisma) }`: `list(actor): Promise<…[]>`, `create(dto, actor)`, `update(id, dto, actor)`.
  - `class ReportService { constructor(prisma) }`: `spend(actor, scope, query): Promise<SpendRow[]>`; `SpendRow { key: string; label: string; advancesPaid: string; applied: string; cashReturned: string; outstanding: string; reimbursed: string; settled: string; expense: string }`.
  - `buildSpendWorkbook(rows: SpendRow[]): Promise<Buffer>`.

- [ ] **Step 1: Write the failing query tests**

`apps/finance/src/queries/query.service.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, OTHER_PROJECT, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RequestService } from '../requests/request.service.js';
import { QueryService } from './query.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let approvals: ApprovalService;
let payments: PaymentService;
let queries: QueryService;
let categoryId: string;

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma); queries = new QueryService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const make = async (requester = ACTORS.engineer, project = PROJECT) => {
  const scope = project.id === PROJECT.id ? scopes.project : scopes.otherProject;
  const r = await requests.create({ kind: 'ADVANCE', projectId: project.id, categoryId, purpose: 'Travel', amount: '1000' }, requester, scope, project);
  return requests.submit(r.id, requester);
};

describe('list', () => {
  it('shows an engineer only their own requests', async () => {
    await make(ACTORS.engineer); await make(ACTORS.otherEngineer);
    const page = await queries.list(ACTORS.engineer, scopes.project, { view: 'mine', page: 1, limit: 20 });
    expect(page.items.map((i) => i.requesterId)).toEqual([ACTORS.engineer.id]);
    expect(page.total).toBe(1);
  });

  it('refuses the "all" view without view_all', async () => {
    await expect(queries.list(ACTORS.engineer, scopes.project, { view: 'all', page: 1, limit: 20 })).rejects.toThrow(/finance_request\.view_all/);
  });

  it('shows a PM everything in their project scope and nothing from other projects', async () => {
    await make(ACTORS.engineer); await make(ACTORS.otherEngineer, OTHER_PROJECT);
    const page = await queries.list(ACTORS.pm, scopes.project, { view: 'all', page: 1, limit: 20 });
    expect(page.items.map((i) => i.projectId)).toEqual([PROJECT.id]);
  });

  it('shows Finance, with global scope, every project', async () => {
    await make(ACTORS.engineer); await make(ACTORS.otherEngineer, OTHER_PROJECT);
    expect((await queries.list(ACTORS.finance, scopes.global, { view: 'all', page: 1, limit: 20 })).total).toBe(2);
  });

  it('lists what awaits the caller, excluding their own requests', async () => {
    const mine = await make(ACTORS.pm);          // PM-raised: waits for the Director
    const theirs = await make(ACTORS.engineer);  // waits for a PM
    const forPm = await queries.list(ACTORS.otherPm, scopes.project, { view: 'awaiting', page: 1, limit: 20 });
    expect(forPm.items.map((i) => i.id)).toEqual([theirs.id]);
    const forDirector = await queries.list(ACTORS.director, scopes.project, { view: 'awaiting', page: 1, limit: 20 });
    expect(forDirector.items.map((i) => i.id)).toEqual([mine.id]);
    expect((await queries.list(ACTORS.engineer, scopes.project, { view: 'awaiting', page: 1, limit: 20 })).items).toEqual([]);
  });

  it('filters by status, kind and project, and paginates newest first', async () => {
    await make(); await make(); await make();
    const page = await queries.list(ACTORS.pm, scopes.project, { view: 'all', page: 2, limit: 2, status: 'PENDING_PM', kind: 'ADVANCE', projectId: PROJECT.id });
    expect(page).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(page.items).toHaveLength(1);
  });
});

describe('get', () => {
  it('returns the request with invoices, history and payments to its requester', async () => {
    const r = await make();
    const detail = await queries.get(r.id, ACTORS.engineer, scopes.project);
    expect(detail.actions?.map((a) => a.action)).toEqual(['SUBMITTED']);
    expect(detail.category).toMatchObject({ code: expect.any(String) });
  });

  it('hides it from another engineer and from a PM outside the project', async () => {
    const r = await make();
    await expect(queries.get(r.id, ACTORS.otherEngineer, scopes.project)).rejects.toThrow(/not found/);
    await expect(queries.get(r.id, ACTORS.pm, scopes.otherProject)).rejects.toThrow(/not found/);
    expect((await queries.get(r.id, ACTORS.pm, scopes.project)).id).toBe(r.id);
  });
});

describe('advance', () => {
  it('shows the balance and the settlements against a paid advance', async () => {
    const a = await make();
    await approvals.approve(a.id, {}, ACTORS.pm, scopes.project);
    await approvals.approve(a.id, {}, ACTORS.director, scopes.project);
    await payments.pay(a.id, { mode: 'CASH', reference: 'V1', paidOn: new Date('2026-10-05') }, ACTORS.finance, scopes.global);
    const view = await queries.advance(a.id, ACTORS.engineer, scopes.project);
    expect(view.balance).toMatchObject({ paid: '1000.00', outstanding: '1000.00', status: 'PAID' });
    expect(view.settlements).toEqual([]);
  });

  it('refuses something that is not an advance', async () => {
    const r = await requests.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'x', invoices: [{ vendor: 'V', invoiceNumber: '1', invoiceDate: new Date('2026-10-01'), amount: '5', mediaId: ACTORS.engineer.id }] }, ACTORS.engineer, scopes.project, PROJECT);
    await expect(queries.advance(r.id, ACTORS.engineer, scopes.project)).rejects.toThrow(/Advance not found/);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement `QueryService`**

Run: `pnpm --filter finance exec vitest run src/queries/query.service.integration.spec.ts` — Expected: FAIL (cannot resolve `./query.service.js`).

`apps/finance/src/queries/query.service.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { ListRequestsQuery } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { inScope, notFound, type Actor } from '../common.js';
import { loadBalance } from '../ledger.js';
import { serializeDetail, serializeRequest } from '../serialize.js';
import { awaitingStatuses } from '../workflow.js';

const VIEW_ALL = 'finance_request.view_all';
const PROJECT_ONLY = { project: 'projectId', site: null } as const;

/**
 * Reads. Visibility is the caller's own requests, or, with view_all, every
 * request in their project scope. Out of scope reads as "not found".
 */
export class QueryService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(actor: Actor, scope: AuthzScope, query: ListRequestsQuery) {
    const where = this.visibility(actor, scope, query.view);
    const filters: Prisma.FinanceRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
    };
    const full: Prisma.FinanceRequestWhereInput = { AND: [where, filters] };
    const [items, total] = await Promise.all([
      this.prisma.financeRequest.findMany({
        where: full, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit,
        include: { category: { select: { code: true, name: true } } },
      }),
      this.prisma.financeRequest.count({ where: full }),
    ]);
    return { items: items.map((row) => ({ ...serializeRequest(row), category: row.category })), total, page: query.page, limit: query.limit };
  }

  async get(id: string, actor: Actor, scope: AuthzScope) {
    const row = await this.prisma.financeRequest.findUnique({
      where: { id },
      include: { invoices: true, actions: { orderBy: { at: 'asc' } }, payments: true, category: { select: { code: true, name: true } } },
    });
    if (!row || !this.mayRead(row, actor, scope)) throw notFound('Request');
    const detail = { ...serializeDetail(row), category: row.category };
    return row.kind === 'ADVANCE' && row.status === 'PAID' ? { ...detail, balance: await loadBalance(this.prisma, id) } : detail;
  }

  /** An advance's balance and the settlements raised against it. */
  async advance(id: string, actor: Actor, scope: AuthzScope) {
    const advance = await this.prisma.financeRequest.findUnique({ where: { id }, include: { settlements: { orderBy: { createdAt: 'asc' } } } });
    if (!advance || advance.kind !== 'ADVANCE' || !this.mayRead(advance, actor, scope)) throw notFound('Advance');
    return {
      advance: serializeRequest(advance),
      balance: advance.status === 'PAID' ? await loadBalance(this.prisma, id) : null,
      settlements: advance.settlements.map(serializeRequest),
    };
  }

  private mayRead(row: { requesterId: string; projectId: string }, actor: Actor, scope: AuthzScope): boolean {
    if (row.requesterId === actor.id) return true;
    return actor.permissions.includes(VIEW_ALL) && inScope(scope, row.projectId);
  }

  private visibility(actor: Actor, scope: AuthzScope, view: ListRequestsQuery['view']): Prisma.FinanceRequestWhereInput {
    if (view === 'mine') return { requesterId: actor.id };
    if (!actor.permissions.includes(VIEW_ALL)) throw new ForbiddenException(`This view needs the ${VIEW_ALL} permission`);
    const inProjects = scopeWhere(scope, PROJECT_ONLY) as Prisma.FinanceRequestWhereInput;
    if (view === 'all') return inProjects;
    const statuses = awaitingStatuses(actor.permissions);
    return { AND: [inProjects, { status: { in: statuses } }, { requesterId: { not: actor.id } }] };
  }
}
```

- [ ] **Step 3: Run query tests, then write the category tests**

Run: `pnpm --filter finance exec vitest run src/queries/query.service.integration.spec.ts` — Expected: PASS.

`apps/finance/src/categories/category.service.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS } from '../../prisma/fixtures.js';
import { CategoryService } from './category.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: CategoryService;
beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; service = new CategoryService(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });

describe('categories', () => {
  it('lists active categories for everyone', async () => {
    const list = await service.list(ACTORS.engineer);
    expect(list.map((c) => c.code)).toEqual(['ACCOMMODATION', 'FUEL', 'LABOUR', 'MATERIALS', 'MISC', 'TRAVEL']);
    expect(list.every((c) => c.disabledAt === null)).toBe(true);
  });

  it('lets Finance add, rename and disable one, and hides the disabled from everyone else', async () => {
    const created = await service.create({ code: 'PERMITS', name: 'Permits' }, ACTORS.finance);
    expect(created).toMatchObject({ code: 'PERMITS', name: 'Permits', disabledAt: null });

    expect(await service.update(created.id, { name: 'Permits and fees' }, ACTORS.finance)).toMatchObject({ name: 'Permits and fees' });
    await service.update(created.id, { disabled: true }, ACTORS.finance);

    expect((await service.list(ACTORS.engineer)).map((c) => c.code)).not.toContain('PERMITS');
    expect((await service.list(ACTORS.finance)).find((c) => c.code === 'PERMITS')?.disabledAt).not.toBeNull();

    await service.update(created.id, { disabled: false }, ACTORS.finance);
    expect((await service.list(ACTORS.engineer)).map((c) => c.code)).toContain('PERMITS');
  });

  it('refuses a duplicate code and a caller who cannot manage categories', async () => {
    await expect(service.create({ code: 'TRAVEL', name: 'Again' }, ACTORS.finance)).rejects.toThrow(/already exists/);
    await expect(service.create({ code: 'NEWCAT', name: 'New' }, ACTORS.engineer)).rejects.toThrow(/finance_category\.manage/);
  });
});
```

Run it — Expected: FAIL (cannot resolve `./category.service.js`).

`apps/finance/src/categories/category.service.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { uuidv7 } from '@ipms/contracts';
import type { PrismaClient } from '@prisma-clients/finance';
import { recordAudit } from '../audit.js';
import { notFound, requirePermission, type Actor } from '../common.js';

const MANAGE = 'finance_category.manage';

/** The expense categories requests are filed under. Finance maintains them; disabling hides a category without breaking old requests. */
export class CategoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Everyone sees the active ones; those who manage categories also see the disabled. */
  list(actor: Actor) {
    const manages = actor.permissions.includes(MANAGE);
    return this.prisma.expenseCategory.findMany({ where: manages ? {} : { disabledAt: null }, orderBy: { code: 'asc' } });
  }

  async create(dto: { code: string; name: string }, actor: Actor) {
    requirePermission(actor, MANAGE);
    if (await this.prisma.expenseCategory.findUnique({ where: { code: dto.code } })) throw new ConflictException(`A category with code ${dto.code} already exists`);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.expenseCategory.create({ data: { id: uuidv7(), code: dto.code, name: dto.name } });
      await recordAudit(tx, { actorId: actor.id, action: 'finance.category.created', objectType: 'ExpenseCategory', objectId: created.id, previousState: {}, newState: { code: dto.code, name: dto.name } });
      return created;
    });
  }

  async update(id: string, dto: { name?: string; disabled?: boolean }, actor: Actor) {
    requirePermission(actor, MANAGE);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.expenseCategory.findUnique({ where: { id } });
      if (!before) throw notFound('Category');
      const updated = await tx.expenseCategory.update({
        where: { id },
        data: { ...(dto.name ? { name: dto.name } : {}), ...(dto.disabled === undefined ? {} : { disabledAt: dto.disabled ? new Date() : null }) },
      });
      await recordAudit(tx, { actorId: actor.id, action: 'finance.category.updated', objectType: 'ExpenseCategory', objectId: id, previousState: { name: before.name, disabled: before.disabledAt !== null }, newState: { name: updated.name, disabled: updated.disabledAt !== null } });
      return updated;
    });
  }
}
```

Run: `pnpm --filter finance exec vitest run src/categories` — Expected: PASS.

- [ ] **Step 4: Write the failing report tests**

`apps/finance/src/queries/report.service.integration.spec.ts`:

```ts
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, OTHER_PROJECT, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RequestService } from '../requests/request.service.js';
import { ReportService } from './report.service.js';
import { buildSpendWorkbook } from './report.xlsx.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService; let approvals: ApprovalService; let payments: PaymentService; let reports: ReportService;
let categoryId: string;

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma); reports = new ReportService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const bank = { mode: 'BANK_TRANSFER' as const, reference: 'T', paidOn: new Date('2026-10-05') };
const inv = (amount: string) => ({ vendor: 'V', invoiceNumber: `I${amount}`, invoiceDate: new Date('2026-10-01'), amount, mediaId: ACTORS.engineer.id });
const through = async (id: string) => {
  await approvals.approve(id, {}, ACTORS.pm, scopes.project);
  await approvals.approve(id, {}, ACTORS.director, scopes.project);
};

async function scenario() {
  // KOS: advance 50,000 paid; settlement 12,000 settled; 3,000 returned; reimbursement 800 paid.
  const adv = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount: '50000' }, ACTORS.engineer, scopes.project, PROJECT);
  await requests.submit(adv.id, ACTORS.engineer); await through(adv.id); await payments.pay(adv.id, bank, ACTORS.finance, scopes.global);
  const set = await requests.create({ kind: 'SETTLEMENT', advanceId: adv.id, categoryId, purpose: 'Bills', invoices: [inv('12000')] }, ACTORS.engineer, scopes.project);
  await requests.submit(set.id, ACTORS.engineer); await through(set.id); await payments.pay(set.id, {}, ACTORS.finance, scopes.global);
  await payments.returnCash(adv.id, { ...bank, amount: '3000' }, ACTORS.finance, scopes.global);
  const rei = await requests.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [inv('800')] }, ACTORS.engineer, scopes.project, PROJECT);
  await requests.submit(rei.id, ACTORS.engineer); await through(rei.id); await payments.pay(rei.id, bank, ACTORS.finance, scopes.global);
  // An unpaid request on another project must not count.
  const other = await requests.create({ kind: 'ADVANCE', projectId: OTHER_PROJECT.id, categoryId, purpose: 'x', amount: '999' }, ACTORS.otherEngineer, scopes.otherProject, OTHER_PROJECT);
  await requests.submit(other.id, ACTORS.otherEngineer);
}

describe('spend report', () => {
  it('totals advances, settlements, returns and outstanding per project', async () => {
    await scenario();
    const rows = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'project', format: 'json' });
    expect(rows).toEqual([{
      key: PROJECT.id, label: 'KOS Koshi Rollout',
      advancesPaid: '50000.00', applied: '12000.00', cashReturned: '3000.00', outstanding: '35000.00',
      reimbursed: '800.00', settled: '12000.00', expense: '12800.00',
    }]);
  });

  it('groups by category and by requester', async () => {
    await scenario();
    const byCategory = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'category', format: 'json' });
    expect(byCategory).toHaveLength(1);
    expect(byCategory[0]).toMatchObject({ key: categoryId, expense: '12800.00' });
    const byRequester = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'requester', format: 'json' });
    expect(byRequester[0]).toMatchObject({ key: ACTORS.engineer.id, advancesPaid: '50000.00' });
  });

  it('limits a PM to the projects in their scope, and refuses a caller without view_all', async () => {
    await scenario();
    expect(await reports.spend(ACTORS.pm, scopes.otherProject, { groupBy: 'project', format: 'json' })).toEqual([]);
    await expect(reports.spend(ACTORS.engineer, scopes.project, { groupBy: 'project', format: 'json' })).rejects.toThrow(/finance_request\.view_all/);
  });

  it('filters by date', async () => {
    await scenario();
    const future = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'project', format: 'json', from: new Date('2100-01-01') });
    expect(future).toEqual([]);
  });
});

describe('spend workbook', () => {
  it('writes one row per group with a header', async () => {
    await scenario();
    const rows = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'project', format: 'xlsx' });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildSpendWorkbook(rows));
    const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(['Group', 'Advances paid', 'Expense (NPR)']));
    expect(sheet.getRow(2).getCell(1).value).toBe('KOS Koshi Rollout');
    expect(sheet.rowCount).toBe(2);
  });
});
```

Run it — Expected: FAIL (cannot resolve `./report.service.js`).

- [ ] **Step 5: Implement `ReportService` and the workbook**

`apps/finance/src/queries/report.service.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { ReportQuery } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import type { Actor } from '../common.js';
import { compareMoney, fromMinor, sumMoney, toMinor } from '../money.js';

export interface SpendRow {
  key: string;
  label: string;
  advancesPaid: string;
  applied: string;
  cashReturned: string;
  outstanding: string;
  reimbursed: string;
  settled: string;
  /** reimbursed + settled: money the project actually spent. Unsettled advance is outstanding, not expense. */
  expense: string;
}

const VIEW_ALL = 'finance_request.view_all';

/**
 * Spend per project, category or engineer. Only completed money counts: a paid
 * advance, a paid reimbursement, a settled settlement and cash returned.
 * Volumes are small (one row per request), so grouping is done in memory.
 */
export class ReportService {
  constructor(private readonly prisma: PrismaClient) {}

  async spend(actor: Actor, scope: AuthzScope, query: ReportQuery): Promise<SpendRow[]> {
    if (!actor.permissions.includes(VIEW_ALL)) throw new ForbiddenException(`Reports need the ${VIEW_ALL} permission`);

    const base: Prisma.FinanceRequestWhereInput = {
      AND: [
        scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput,
        query.projectId ? { projectId: query.projectId } : {},
        query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {},
      ],
    };
    const [requests, returns] = await Promise.all([
      this.prisma.financeRequest.findMany({
        where: { AND: [base, { status: { in: ['PAID', 'SETTLED'] } }] },
        select: { kind: true, projectId: true, projectCode: true, projectName: true, categoryId: true, requesterId: true, approvedAmount: true, appliedAmount: true, category: { select: { name: true } } },
      }),
      this.prisma.payment.findMany({
        where: { kind: 'CASH_RETURN', request: base },
        select: { amount: true, request: { select: { projectId: true, projectCode: true, projectName: true, categoryId: true, requesterId: true, category: { select: { name: true } } } } },
      }),
    ]);

    const groups = new Map<string, { label: string; advances: string[]; applied: string[]; returned: string[]; reimbursed: string[]; settled: string[] }>();
    const slot = (r: { projectId: string; projectCode: string; projectName: string; categoryId: string; requesterId: string; category: { name: string } }) => {
      const [key, label] = query.groupBy === 'project' ? [r.projectId, `${r.projectCode} ${r.projectName}`]
        : query.groupBy === 'category' ? [r.categoryId, r.category.name]
        : [r.requesterId, r.requesterId];
      if (!groups.has(key)) groups.set(key, { label, advances: [], applied: [], returned: [], reimbursed: [], settled: [] });
      return { key, group: groups.get(key)! };
    };

    for (const r of requests) {
      const { group } = slot(r);
      const approved = r.approvedAmount?.toFixed(2) ?? '0.00';
      if (r.kind === 'ADVANCE') group.advances.push(approved);
      else if (r.kind === 'REIMBURSEMENT') group.reimbursed.push(approved);
      else { group.settled.push(approved); group.applied.push(r.appliedAmount?.toFixed(2) ?? '0.00'); }
    }
    for (const p of returns) slot(p.request).group.returned.push(p.amount.toFixed(2));

    return [...groups.entries()].map(([key, g]) => {
      const advancesPaid = sumMoney(g.advances);
      const applied = sumMoney(g.applied);
      const cashReturned = sumMoney(g.returned);
      const reimbursed = sumMoney(g.reimbursed);
      const settled = sumMoney(g.settled);
      return {
        key, label: g.label, advancesPaid, applied, cashReturned,
        outstanding: fromMinor(toMinor(advancesPaid) - toMinor(applied) - toMinor(cashReturned)),
        reimbursed, settled, expense: sumMoney([reimbursed, settled]),
      };
    }).sort((a, b) => compareMoney(b.expense, a.expense) || a.label.localeCompare(b.label));
  }
}
```

`apps/finance/src/queries/report.xlsx.ts`:

```ts
import ExcelJS from 'exceljs';
import type { SpendRow } from './report.service.js';

const MONEY = '#,##0.00';

/** The spend report as an Excel file, replacing the spreadsheets this service exists to retire. */
export async function buildSpendWorkbook(rows: SpendRow[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Spend');
  sheet.columns = [
    { header: 'Group', key: 'label', width: 36 },
    { header: 'Advances paid', key: 'advancesPaid', width: 18 },
    { header: 'Applied to settlements', key: 'applied', width: 22 },
    { header: 'Cash returned', key: 'cashReturned', width: 16 },
    { header: 'Outstanding', key: 'outstanding', width: 16 },
    { header: 'Reimbursed', key: 'reimbursed', width: 16 },
    { header: 'Settled', key: 'settled', width: 16 },
    { header: 'Expense (NPR)', key: 'expense', width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow({
      label: row.label, advancesPaid: Number(row.advancesPaid), applied: Number(row.applied), cashReturned: Number(row.cashReturned),
      outstanding: Number(row.outstanding), reimbursed: Number(row.reimbursed), settled: Number(row.settled), expense: Number(row.expense),
    });
  }
  for (let c = 2; c <= 8; c += 1) sheet.getColumn(c).numFmt = MONEY;
  return Buffer.from(await book.xlsx.writeBuffer());
}
```

- [ ] **Step 6: Run everything for this task, typecheck, commit**

Run: `pnpm --filter finance exec vitest run src/queries src/categories && pnpm --filter finance typecheck`
Expected: PASS, no type errors.

```bash
git add apps/finance/src/queries apps/finance/src/categories
git commit -m "feat(finance): scoped queries, categories and spend report with Excel export

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: HTTP layer and module wiring

**Files:**
- Create: `apps/finance/src/directory/project-directory.client.ts`, `apps/finance/src/directory/project-directory.client.spec.ts`
- Create: `apps/finance/src/http/request.controller.ts`, `apps/finance/src/http/category.controller.ts`, `apps/finance/src/http/report.controller.ts`
- Create: `apps/finance/src/http/controllers.spec.ts`
- Modify: `apps/finance/src/app.module.ts`

**Interfaces:**
- Consumes: all services from Tasks 8-11 and the schemas from Task 2.
- Produces: `ProjectDirectoryClient { scope(bearer): Promise<Lookup<AuthzScope>>; project(id, bearer): Promise<Lookup<ProjectRef>> }`, `required<T>(lookup, what): T`; routes under `/api/v1/finance/*`:

| Route | Permission on the route | Handler |
|---|---|---|
| `POST /finance/requests` | `finance_request.view` (kind-specific check in service) | create |
| `PATCH /finance/requests/:id` | `finance_request.view` | update |
| `POST /finance/requests/:id/submit` | `finance_request.view` | submit |
| `POST /finance/requests/:id/cancel` | `finance_request.view` | cancel |
| `POST /finance/requests/:id/approve` \| `/return` \| `/reject` | `finance_request.view` (step permission in service) | approve / return / reject |
| `POST /finance/requests/:id/pay` | `finance_payment.record` | pay |
| `POST /finance/advances/:id/cash-return` | `finance_payment.record` | returnCash |
| `GET /finance/requests`, `GET /finance/requests/:id`, `GET /finance/advances/:id` | `finance_request.view` | list / get / advance |
| `GET /finance/categories` | `finance_request.view` | list |
| `POST /finance/categories`, `PATCH /finance/categories/:id` | `finance_category.manage` | create / update |
| `GET /finance/reports/project-spend` | `finance_request.view_all` | spend (json or xlsx) |

- [ ] **Step 1: Write the failing project-client test**

`apps/finance/src/directory/project-directory.client.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDirectoryClient, required } from './project-directory.client.js';

const respond = (status: number, body: unknown = {}) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
const client = () => new ProjectDirectoryClient('http://project:3004');
afterEach(() => vi.unstubAllGlobals());

describe('ProjectDirectoryClient', () => {
  it('forwards the caller\'s bearer token to project\'s scope endpoint', async () => {
    const fetchMock = respond(200, { global: false, projectIds: ['p1'], siteIds: [] });
    vi.stubGlobal('fetch', fetchMock);
    expect(await client().scope('Bearer abc')).toEqual({ state: 'found', value: { global: false, projectIds: ['p1'], siteIds: [] } });
    expect(fetchMock).toHaveBeenCalledWith('http://project:3004/api/v1/internal/scope', expect.objectContaining({ headers: { authorization: 'Bearer abc' } }));
  });

  it('reduces a project to the facts a request snapshots', async () => {
    vi.stubGlobal('fetch', respond(200, { id: 'p1', code: 'KOS', name: 'Koshi', status: 'ONGOING', extra: 'ignored' }));
    expect(await client().project('p1', 'Bearer abc')).toEqual({ state: 'found', value: { id: 'p1', code: 'KOS', name: 'Koshi' } });
  });

  it('maps 404, 401/403 and server errors to distinct states', async () => {
    vi.stubGlobal('fetch', respond(404)); expect(await client().project('p', 'b')).toEqual({ state: 'not_found' });
    vi.stubGlobal('fetch', respond(403)); expect(await client().project('p', 'b')).toEqual({ state: 'forbidden' });
    vi.stubGlobal('fetch', respond(500)); expect(await client().project('p', 'b')).toEqual({ state: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down'))); expect(await client().scope('b')).toEqual({ state: 'unavailable' });
  });

  it('turns a lookup into a value or the matching HTTP error', () => {
    expect(required({ state: 'found', value: 5 }, 'Thing')).toBe(5);
    expect(() => required({ state: 'not_found' }, 'Project')).toThrow(/Project not found/);
    expect(() => required({ state: 'forbidden' }, 'Project')).toThrow(/cannot view this project/);
    expect(() => required({ state: 'unavailable' }, 'Project')).toThrow(/could not be reached/);
  });
});
```

Run: `pnpm --filter finance exec vitest run src/directory` — Expected: FAIL (cannot resolve the client).

- [ ] **Step 2: Implement the project client**

`apps/finance/src/directory/project-directory.client.ts`:

```ts
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import type { ProjectRef } from '../common.js';

export type Lookup<T> =
  | { state: 'found'; value: T }
  | { state: 'not_found' }
  | { state: 'forbidden' }
  | { state: 'unavailable' };

/** The lookup as an answer, or the HTTP error that stands in for one. */
export function required<T>(lookup: Lookup<T>, what: string): T {
  switch (lookup.state) {
    case 'found': return lookup.value;
    case 'not_found': throw new NotFoundException(`${what} not found`);
    case 'forbidden': throw new ForbiddenException(`You cannot view this ${what.toLowerCase()}`);
    case 'unavailable': throw new ServiceUnavailableException('The project service could not be reached. Try again shortly.');
  }
}

/**
 * What finance needs from project: the caller's project scope, and a project's
 * code and name to snapshot onto a request.
 *
 * Every call forwards the caller's own bearer token, so project answers with
 * the caller's own permissions and no shared secret is needed. Neither call
 * degrades: with no scope there is no safe list to show.
 */
export class ProjectDirectoryClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  scope(bearer: string): Promise<Lookup<AuthzScope>> {
    return this.call('/api/v1/internal/scope', bearer, (body) => body as AuthzScope);
  }

  project(projectId: string, bearer: string): Promise<Lookup<ProjectRef>> {
    return this.call(`/api/v1/projects/${projectId}`, bearer, (body) => {
      const { id, code, name } = body as ProjectRef;
      return { id, code, name };
    });
  }

  private async call<T>(path: string, bearer: string, pick: (body: unknown) => T): Promise<Lookup<T>> {
    try {
      const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        headers: { authorization: bearer },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) return { state: 'not_found' };
      if (response.status === 401 || response.status === 403) return { state: 'forbidden' };
      if (!response.ok) return { state: 'unavailable' };
      return { state: 'found', value: pick(await response.json()) };
    } catch {
      return { state: 'unavailable' };
    }
  }
}
```

Run: `pnpm --filter finance exec vitest run src/directory` — Expected: PASS.

- [ ] **Step 3: Write the controllers**

`apps/finance/src/http/request.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import {
  ApproveSchema, CashReturnSchema, CommentSchema, CreateRequestSchema, ListRequestsQuerySchema, OptionalCommentSchema,
  PayRequestSchema, UpdateRequestSchema, UuidSchema,
} from '@ipms/contracts';
import { ApprovalService } from '../approvals/approval.service.js';
import { ProjectDirectoryClient, required } from '../directory/project-directory.client.js';
import { PaymentService } from '../payments/payment.service.js';
import { QueryService } from '../queries/query.service.js';
import { RequestService } from '../requests/request.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };
const bearerOf = (req: Authed): string => req.headers['authorization'] ?? '';

/**
 * Requests, approvals and payments, reached through the gateway's
 * `/api/v1/finance` prefix.
 *
 * The route-level permission is the broad gate (any finance user). The verb
 * that actually decides, create versus settle, PM versus Director, is checked
 * in the service against the request, because one route serves several of
 * them. Project scope is project's to decide, so each handler asks it.
 */
@Controller('finance')
export class RequestController {
  constructor(
    private readonly requests: RequestService,
    private readonly approvals: ApprovalService,
    private readonly payments: PaymentService,
    private readonly queries: QueryService,
    private readonly projects: ProjectDirectoryClient,
  ) {}

  private async scope(req: Authed) {
    return required(await this.projects.scope(bearerOf(req)), 'Scope');
  }

  @Post('requests') @RequirePermission('finance_request.view')
  async create(@Body() body: unknown, @Req() req: Authed) {
    const dto = CreateRequestSchema.parse(body);
    const scope = await this.scope(req);
    const project = dto.kind === 'SETTLEMENT' ? undefined : required(await this.projects.project(dto.projectId, bearerOf(req)), 'Project');
    return this.requests.create(dto, req.user, scope, project);
  }

  @Patch('requests/:id') @RequirePermission('finance_request.view')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.requests.update(UuidSchema.parse(id), UpdateRequestSchema.parse(body), req.user);
  }

  @Post('requests/:id/submit') @RequirePermission('finance_request.view')
  submit(@Param('id') id: string, @Req() req: Authed) {
    return this.requests.submit(UuidSchema.parse(id), req.user);
  }

  @Post('requests/:id/cancel') @RequirePermission('finance_request.view')
  cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.requests.cancel(UuidSchema.parse(id), OptionalCommentSchema.parse(body ?? {}).comment, req.user);
  }

  @Post('requests/:id/approve') @RequirePermission('finance_request.view')
  async approve(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.approvals.approve(UuidSchema.parse(id), ApproveSchema.parse(body ?? {}), req.user, await this.scope(req));
  }

  @Post('requests/:id/return') @RequirePermission('finance_request.view')
  async returnToRequester(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.approvals.returnToRequester(UuidSchema.parse(id), CommentSchema.parse(body).comment, req.user, await this.scope(req));
  }

  @Post('requests/:id/reject') @RequirePermission('finance_request.view')
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.approvals.reject(UuidSchema.parse(id), CommentSchema.parse(body).comment, req.user, await this.scope(req));
  }

  @Post('requests/:id/pay') @RequirePermission('finance_payment.record')
  async pay(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.payments.pay(UuidSchema.parse(id), PayRequestSchema.parse(body ?? {}), req.user, await this.scope(req));
  }

  @Post('advances/:id/cash-return') @RequirePermission('finance_payment.record')
  async returnCash(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.payments.returnCash(UuidSchema.parse(id), CashReturnSchema.parse(body), req.user, await this.scope(req));
  }

  @Get('requests') @RequirePermission('finance_request.view')
  async list(@Query() query: unknown, @Req() req: Authed) {
    return this.queries.list(req.user, await this.scope(req), ListRequestsQuerySchema.parse(query));
  }

  @Get('requests/:id') @RequirePermission('finance_request.view')
  async get(@Param('id') id: string, @Req() req: Authed) {
    return this.queries.get(UuidSchema.parse(id), req.user, await this.scope(req));
  }

  @Get('advances/:id') @RequirePermission('finance_request.view')
  async advance(@Param('id') id: string, @Req() req: Authed) {
    return this.queries.advance(UuidSchema.parse(id), req.user, await this.scope(req));
  }
}
```

`apps/finance/src/http/category.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { CategoryCreateSchema, CategoryUpdateSchema, UuidSchema } from '@ipms/contracts';
import { CategoryService } from '../categories/category.service.js';

@Controller('finance/categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get() @RequirePermission('finance_request.view')
  list(@Req() req: { user: AuthzUser }) { return this.categories.list(req.user); }

  @Post() @RequirePermission('finance_category.manage')
  create(@Body() body: unknown, @Req() req: { user: AuthzUser }) { return this.categories.create(CategoryCreateSchema.parse(body), req.user); }

  @Patch(':id') @RequirePermission('finance_category.manage')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.categories.update(UuidSchema.parse(id), CategoryUpdateSchema.parse(body), req.user);
  }
}
```

`apps/finance/src/http/report.controller.ts`:

```ts
import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { ReportQuerySchema } from '@ipms/contracts';
import type { FastifyReply } from 'fastify';
import { ProjectDirectoryClient, required } from '../directory/project-directory.client.js';
import { ReportService } from '../queries/report.service.js';
import { buildSpendWorkbook } from '../queries/report.xlsx.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

@Controller('finance/reports')
export class ReportController {
  constructor(private readonly reports: ReportService, private readonly projects: ProjectDirectoryClient) {}

  /** Spend per project, category or engineer, as JSON or an Excel file (`?format=xlsx`). */
  @Get('project-spend') @RequirePermission('finance_request.view_all')
  async spend(@Query() query: unknown, @Req() req: Authed, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = ReportQuerySchema.parse(query);
    const scope = required(await this.projects.scope(req.headers['authorization'] ?? ''), 'Scope');
    const rows = await this.reports.spend(req.user, scope, parsed);
    if (parsed.format === 'json') return rows;
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="finance-spend-by-${parsed.groupBy}.xlsx"`);
    return buildSpendWorkbook(rows);
  }
}
```

- [ ] **Step 4: Write a failing wiring test, then wire the module**

`apps/finance/src/http/controllers.spec.ts` (asserts the permission each route is gated on, so a refactor cannot silently open a route):

```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSION_KEY, type PermissionMetadata } from '@ipms/authz';
import { PERMISSION_CODES } from '@ipms/authz';
import { CategoryController } from './category.controller.js';
import { ReportController } from './report.controller.js';
import { RequestController } from './request.controller.js';

const gate = (controller: { prototype: object }, handler: string): string | undefined =>
  (Reflect.getMetadata(PERMISSION_KEY, (controller.prototype as Record<string, object>)[handler]!) as PermissionMetadata | undefined)?.permission;

describe('route permissions', () => {
  it.each([
    [RequestController, 'create', 'finance_request.view'],
    [RequestController, 'approve', 'finance_request.view'],
    [RequestController, 'pay', 'finance_payment.record'],
    [RequestController, 'returnCash', 'finance_payment.record'],
    [RequestController, 'list', 'finance_request.view'],
    [CategoryController, 'create', 'finance_category.manage'],
    [CategoryController, 'update', 'finance_category.manage'],
    [CategoryController, 'list', 'finance_request.view'],
    [ReportController, 'spend', 'finance_request.view_all'],
  ] as const)('%o.%s requires %s', (controller, handler, permission) => {
    expect(gate(controller, handler)).toBe(permission);
    expect(PERMISSION_CODES.has(permission)).toBe(true);
  });

  it('gates every handler of every finance controller', () => {
    for (const controller of [RequestController, CategoryController, ReportController]) {
      const handlers = Object.getOwnPropertyNames(controller.prototype).filter((n) => n !== 'constructor' && typeof (controller.prototype as Record<string, unknown>)[n] === 'function' && n !== 'scope');
      for (const name of handlers) expect(gate(controller, name), `${controller.name}.${name} has no @RequirePermission`).toBeDefined();
    }
  });
});
```

Run: `pnpm --filter finance exec vitest run src/http` — Expected: PASS once the controllers exist (they do); if `Reflect.getMetadata` is undefined, ensure `import 'reflect-metadata'` is first, as above.

Replace `apps/finance/src/app.module.ts` with the full module:

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
import { ApprovalService } from './approvals/approval.service.js';
import { CategoryService } from './categories/category.service.js';
import { ProjectDirectoryClient } from './directory/project-directory.client.js';
import { CategoryController } from './http/category.controller.js';
import { ReportController } from './http/report.controller.js';
import { RequestController } from './http/request.controller.js';
import { OutboxDrainer } from './outbox/outbox.drainer.js';
import { PaymentService } from './payments/payment.service.js';
import { PrismaService } from './prisma.service.js';
import { QueryService } from './queries/query.service.js';
import { ReportService } from './queries/report.service.js';
import { RequestService } from './requests/request.service.js';

// Least-permissive scope: no finance route passes a resource to check(), so scope is never consulted
// by the guard. Each request resolves the caller's real scope from project, per request.
const scopeProvider: ScopeProvider = { async for(): Promise<AuthzScope> { return { global: false, projectIds: [], siteIds: [] }; } };

const projectInternalUrl = (): string => process.env['PROJECT_INTERNAL_URL'] ?? 'http://project:3004';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const service = <T>(cls: new (db: PrismaService['db']) => T) => ({
  provide: cls,
  useFactory: (prisma: PrismaService) => new cls(prisma.db),
  inject: [PrismaService],
});

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [RequestController, CategoryController, ReportController, HealthController, MetricsController],
  providers: [
    // Order matters: JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: scopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: () => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
    { provide: ProjectDirectoryClient, useFactory: () => new ProjectDirectoryClient(projectInternalUrl()) },
    service(RequestService),
    service(ApprovalService),
    service(PaymentService),
    service(QueryService),
    service(CategoryService),
    service(ReportService),
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
    { provide: OutboxDrainer, useFactory: (prisma: PrismaService, bus: EventBus) => new OutboxDrainer(prisma.db, bus), inject: [PrismaService, EventBus] },
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Typecheck, run the whole finance suite, commit**

Run: `pnpm --filter finance typecheck && pnpm --filter finance exec vitest run`
Expected: no type errors; all finance specs PASS.

```bash
git add apps/finance/src
git commit -m "feat(finance): HTTP controllers, project scope client and module wiring

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Gateway route and Docker stack

**Files:**
- Modify: `apps/gateway/src/proxy/routes.ts`, `apps/gateway/src/proxy/routes.spec.ts`
- Create: `docker/env/finance.env`, `docker/env/finance-db.env`
- Modify: `docker/docker-compose.yml`, `docker/docker-compose.prod.yml`, `docker/env/README.md`

**Interfaces:**
- Produces the gateway prefix `/api/v1/finance` → `finance:3009`, and the compose services `postgres-finance`, `finance-migrate`, `finance`.

- [ ] **Step 1: Write the failing gateway tests**

In `apps/gateway/src/proxy/routes.spec.ts`, add next to the docs test:

```ts
  it('routes the finance prefix to the finance service', () => {
    const upstream = resolveUpstream('/api/v1/finance/requests');
    expect(upstream?.service).toBe('finance');
    expect(upstream?.port).toBe(3009);
  });

  it('keeps the finance prefix authenticated, and its internals private', () => {
    expect(isPublicPath('/api/v1/finance/requests')).toBe(false);
    expect(resolveUpstream('/api/v1/finance/internal/anything')).toBeUndefined();
  });
```

Run: `pnpm --filter gateway exec vitest run src/proxy/routes.spec.ts` — Expected: FAIL (finance route not found).

- [ ] **Step 2: Add the route**

In `apps/gateway/src/proxy/routes.ts` add after the `DOCS` constant:

```ts
const FINANCE = { host: upstreamHost('finance', 'finance'), port: upstreamPort('finance', 3009) };
```

and after the `/api/v1/docs` entry in `ROUTES`:

```ts
  { prefix: '/api/v1/finance', service: 'finance', ...FINANCE },
```

Run `pnpm --filter gateway exec vitest run` — Expected: PASS.

- [ ] **Step 3: Create the env files**

Run from the repo root (derives the finance files from qc's, so shared dev values such as `JWT_SECRET` stay identical):

```bash
sed -e 's/3005/3009/' -e 's/ipms_qc/ipms_finance/g' -e 's/postgres-qc/postgres-finance/g' -e 's/QC_DATABASE_URL/FINANCE_DATABASE_URL/' docker/env/qc.env \
  | grep -vE '^(# Read by qc-migrate|PROJECT_DATABASE_URL|QC_RETIRED_VERSION_GRACE_DAYS|MEDIA_INTERNAL_URL)' > docker/env/finance.env
sed -e 's/ipms_qc/ipms_finance/g' docker/env/qc-db.env > docker/env/finance-db.env
cat docker/env/finance.env | sed -E 's/(JWT_SECRET)=.*/\1=<hidden>/'
```

Expected `finance.env` (secret hidden): `PORT=3009`, `NODE_ENV=production`, `LOG_LEVEL=info`, `NATS_URL=nats://nats:4222`, `REDIS_URL=redis://redis:6379`, `JWT_SECRET=…`, `JWT_ACCESS_TTL=900`, `JWT_REFRESH_TTL=2592000`, `DATABASE_URL=postgresql://ipms_finance:ipms_finance@postgres-finance:5432/ipms_finance`, `FINANCE_DATABASE_URL=` same URL, `PROJECT_INTERNAL_URL=http://project:3004`.

- [ ] **Step 4: Add the services to `docker/docker-compose.yml`**

After the `postgres-docs` service block add:

```yaml
  postgres-finance:
    image: postgres:17-alpine
    env_file:
      - ./env/finance-db.env
    volumes:
      - postgres-finance-data:/var/lib/postgresql/data
    ports:
      - "${FINANCE_DB_PORT:-5440}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ipms_finance -d ipms_finance"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped
```

After the `docs` service block (before `gateway`) add:

```yaml
  finance-migrate:
    <<: *migrate-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      target: migrate
      args: { SERVICE: finance }
    env_file:
      - ./env/finance.env
    depends_on:
      postgres-finance: { condition: service_healthy }

  finance:
    <<: *service-defaults
    build:
      context: ..
      dockerfile: docker/Dockerfile.service
      args: { SERVICE: finance }
    env_file:
      - ./env/finance.env
    depends_on:
      postgres-finance: { condition: service_healthy }
      nats:             { condition: service_healthy }
      redis:            { condition: service_healthy }
      finance-migrate:  { condition: service_completed_successfully }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3009/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

In the `gateway` service's `depends_on` add `      finance:      { condition: service_healthy }` after the `docs` line, and in the `volumes:` list at the bottom add `  postgres-finance-data:`.

- [ ] **Step 5: Add the production overrides**

In `docker/docker-compose.prod.yml` add under `services:` after `postgres-docs:`:

```yaml
  postgres-finance:
    <<: *pg
```

and after the `docs:` block:

```yaml
  finance:
    <<: *node
```

- [ ] **Step 6: Document the env files**

In `docker/env/README.md` add two rows to the table, after the Docs rows:

```markdown
| **Finance Database** | `finance-db.env` | 5440 (mapped to 5432) | PostgreSQL credentials for Finance database (`ipms_finance`) |
| **Finance Service** | `finance.env` | 3009 | Advance, settlement and reimbursement requests with PM → Director → Finance approval + migrations. Calls project (PROJECT_INTERNAL_URL) with the caller's token for scope. |
```

- [ ] **Step 7: Validate the compose files and run the full finance build**

Run:

```bash
docker compose -f docker/docker-compose.yml config --quiet && echo compose-ok
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml config --quiet && echo prod-ok
pnpm --filter finance build && ls apps/finance/dist/src/main.js
```

Expected: `compose-ok`, `prod-ok`, and the built `main.js` listed.

- [ ] **Step 8: Smoke-test the running stack**

Run:

```bash
docker compose -f docker/docker-compose.yml up -d --build postgres-finance finance-migrate finance
docker compose -f docker/docker-compose.yml ps finance
docker compose -f docker/docker-compose.yml exec finance node -e "fetch('http://localhost:3009/health/ready').then(async r=>console.log(r.status, await r.text()))"
```

Expected: `finance` is `healthy`, and the readiness call prints `200`. Then stop what you started: `docker compose -f docker/docker-compose.yml stop finance postgres-finance`.

- [ ] **Step 9: Commit**

```bash
git add apps/gateway/src/proxy docker/docker-compose.yml docker/docker-compose.prod.yml docker/env/finance.env docker/env/finance-db.env docker/env/README.md
git commit -m "feat(finance): route /api/v1/finance through the gateway and add the compose stack

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (section → task):

| Spec | Task |
|---|---|
| §2 scope: three kinds, chain, payment, balance, categories, report + Excel, roles, NPR | 2, 8-11 |
| §3 flow, return/reject/cancel, PM-raised skip, no self-approval, Director amount cap, concurrency | 6, 8, 9 |
| §4 roles and permissions, global scope for Finance | 1 |
| §5 service boundary, compose, env | 4, 13 |
| §6 data model, balance, overspend payout, cash return | 4, 5, 7, 10 |
| §7 API | 12 |
| §9 events and the finance stream, audit | 3, 7, 8-10 |
| §10 testing: state machine, scope, balance, concurrency, integration | 5, 6, 9, 10, 11 |
| §8 Web UI, §9 notification consumers | **Parts 3 and 2** (separate plans) |

**Known refinements to the spec, made while planning** (the spec should be updated to match when this plan is approved):
1. Permission codes use one dot (`finance_request.view`), and a `view_all` tier exists, as `task.view_all` does.
2. A settlement ends as `SETTLED` rather than `PAID`; the subject is `finance.settlement.settled`.
3. The report route is `GET /finance/reports/project-spend?groupBy=…`.
4. Scope comes from the `project` service using the caller's bearer (as `qc` does), not from the token.

**Placeholder scan:** none.

**Type consistency checked:** `Actor`, `ProjectRef`, `Tx` (Task 7) are used with the same shape in Tasks 8-12. `serializeDetail` return shape is read as `.actions`, `.payments`, `.invoices` in tests. `RequestService.create(dto, actor, scope, project?)` matches the controller call. `PaymentService.pay(id, body, actor, scope)` and `returnCash(advanceId, dto, actor, scope)` match the controller. `ReportService.spend(actor, scope, query)` and `SpendRow` match `buildSpendWorkbook`. Event payload fields in Task 3 (`approvers`, `paidAmount`, `appliedAmount`, `payoutAmount`, `heldBy`, `nextStep`) match what Tasks 8-10 emit.
