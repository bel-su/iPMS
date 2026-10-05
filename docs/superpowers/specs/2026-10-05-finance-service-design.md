# Finance Service Design

Date: 2026-10-05
Status: Draft for review

## 1. Why

Advance requests and invoice settlements currently run on Excel and WhatsApp. Records go missing or are entered wrongly, and spend cannot be seen per project. The finance service replaces that with a single system of record and an enforced approval flow, and notifies everyone involved when money moves.

## 2. Scope

In scope (v1):
- Three request kinds: `ADVANCE`, `SETTLEMENT` (invoices against a paid advance) and `REIMBURSEMENT` (invoices with no advance).
- A fixed three-step approval chain, the same for all kinds.
- Payment recording, cash-return recording, and a derived advance balance.
- Expense categories, project-spend reporting with Excel export.
- Two new IAM roles: `PROJECT_DIRECTOR` and `FINANCE`.
- Notifications on every step and on payment or settlement.
- Web UI. INR only.

Out of scope (v1): mobile app, multi-currency, partial or instalment payments, importing Excel history, a generic workflow engine, an override path for stuck requests.

## 3. Approval flow

```
DRAFT -> PENDING_PM -> PENDING_DIRECTOR -> PENDING_FINANCE -> PAID
             |               |                   |
             +-- RETURNED ---+-------------------+   (requester edits, resubmits -> PENDING_PM, revision+1)
             +-- REJECTED   (final)
             +-- CANCELLED  (requester only, from any PENDING_* state)
```

Field Engineer submits, Project Manager approves, Project Director approves, Finance pays.

Rules:
- **Matching:** an approver must hold the step's permission and have IAM scope on the request's `projectId`. Finance is global.
- **No self-approval:** the actor of any step must differ from `requesterId`. If a PM raises a request, a different PM scoped to that project must approve. If none exists the request waits; it is visible to Super Admin, with no override.
- **Amounts:** the PM approves as-is, returns or rejects and cannot change the amount. Only the Director may set `approvedAmount <= requestedAmount`. Finance pays exactly `approvedAmount`, in one payment.
- **Return and reject** require a comment. Return sends the request to the requester; reject is final.
- **Cancel:** the requester may cancel while any `PENDING_*` state, before payment.
- **Concurrency:** every transition is a conditional update on `(id, status, revision)`, so simultaneous approvals produce exactly one transition. The state change and its outbox event are written in one transaction.

## 4. Roles and permissions

New system roles seeded in `apps/iam/prisma/seed.ts` (with demo users):
- `PROJECT_DIRECTOR`: project-scoped, approves step 2.
- `FINANCE`: global, processes payments, manages categories.

New permissions in the `libs/authz` catalog:

| Permission | Held by |
|---|---|
| `finance.request.create`, `finance.request.cancel` (own) | Field Engineer, Project Manager |
| `finance.settlement.submit` (own) | Field Engineer, Project Manager |
| `finance.approve.pm` | Project Manager (project-scoped) |
| `finance.approve.director` | Project Director (project-scoped) |
| `finance.pay` | Finance |
| `finance.view` | engineers: own requests; PM and Director: their projects; Finance and Super Admin: all |
| `finance.category.manage` | Finance |

`SUPER_ADMIN` gets all. `ROLE_ASSIGNMENT` is unchanged: only an administrator can create Directors and Finance users.

## 5. Service boundary

New `apps/finance` NestJS service in the existing pattern: own Postgres database, Prisma schema, outbox, and `finance.*` events on NATS consumed by `notification`. Added to `docker-compose.yml` and `docker-compose.prod.yml` with its own DB and memory limits.

It owns categories, requests, invoices, approval history and payments. It references user, project and work order by ID only, with no cross-service DB reads. Scope comes from the token and IAM events, as `project` and `qc` do. Attachments use the `media` service.

## 6. Data model

Money is `Decimal(14,2)`, INR.

- `expense_category(id, code, name, disabledAt)`. Examples: travel, materials, labour, accommodation, fuel, misc. Finance maintains it.
- `finance_request(id, number, kind, projectId, workOrderId?, categoryId, requesterId, advanceId?, purpose, requestedAmount, approvedAmount?, status, revision, submittedAt, createdAt, updatedAt)`. Numbers: `ADV-2026-0001`, `SET-…`, `REI-…`. `workOrderId` is a plain optional ID with no hard dependency on `qc`.
- `request_invoice(id, requestId, vendor, invoiceNumber, invoiceDate, amount, mediaId)`. Settlements and reimbursements need at least one invoice, and `requestedAmount` equals the invoice sum.
- `approval_action(id, requestId, revision, step, actorId, action, amount?, comment, at)`. Append-only audit trail.
- `payment(id, requestId, kind PAYOUT|CASH_RETURN, mode, reference, paidOn, amount, proofMediaId, recordedBy)`. Modes: bank transfer, cash, cheque, UPI.
- `outbox`, same pattern as other services.

### Advance balance (derived, not stored)

`outstanding = paid advance - approved settlements applied - cash returned`

- Advance status: `PAID`, then `PARTIALLY_SETTLED`, then `CLOSED` when outstanding reaches 0.
- At a settlement's Finance step the invoice total is applied to outstanding. If invoices exceed outstanding, the excess is paid to the requester as a `PAYOUT` in the same step.
- Unspent cash: Finance records a `CASH_RETURN` against the advance.

## 7. API

Through the gateway proxy (`apps/gateway/src/proxy/routes.ts`), JWT forwarded.

| Endpoint | Purpose |
|---|---|
| `POST /finance/requests` | create draft |
| `PATCH /finance/requests/:id` | edit draft or returned request |
| `POST /finance/requests/:id/submit` | submit or resubmit |
| `POST /finance/requests/:id/approve`, `/return`, `/reject` | approval actions; step derived from current status |
| `POST /finance/requests/:id/cancel` | requester cancels |
| `POST /finance/requests/:id/pay` | Finance records payment |
| `POST /finance/advances/:id/cash-return` | Finance records returned cash |
| `GET /finance/requests`, `GET /finance/requests/:id` | role-filtered list and detail with history |
| `GET /finance/advances/:id` | paid, settled, returned, outstanding |
| `GET/POST/PATCH /finance/categories` | list for all, manage for Finance |
| `GET /finance/reports/project-spend` | totals by project, category, engineer; Excel export |

Lists are filtered by scope at query level. A user with no scope sees nothing.

## 8. Web UI (`apps/web/app/finance/`)

- My requests, with a new advance / reimbursement form.
- Settle advance: add invoices with file upload, outstanding balance shown.
- Approvals queue for the signed-in role; detail page with approve, return and reject, plus an amount field for the Director.
- Payments queue for Finance with pay form and proof upload.
- Reports: project spend with filters and Excel export.

## 9. Notifications

New `finance-notification.consumer.ts` in `apps/notification`, like the `qc` consumer. Recipients are resolved with the existing `iam-directory.client`.

| Event | Notifies |
|---|---|
| `finance.request.submitted` (including resubmit) | PMs scoped to the project |
| `finance.request.approved_by_pm` | Directors scoped to the project |
| `finance.request.approved` (Director) | Finance; requester |
| `finance.request.returned`, `.rejected` | requester, with comment |
| `finance.request.cancelled` | approvers currently holding it |
| `finance.request.paid`, `finance.settlement.paid` | requester, approving PM, approving Director, Finance |

A finance JetStream stream is added to `libs/events/src/subjects.ts` with one durable consumer per subject (see the comment on the IAM stream). Every state change also emits an audit event.

## 10. Testing

- State machine: every legal and illegal transition, self-approval blocked, Director amount cap.
- Scope: a PM on project A cannot see or approve a project B request.
- Balance: partial settlements, overspend payout, cash return.
- Concurrency: two simultaneous approvals yield exactly one transition.
- Integration tests against Postgres in the existing style, plus a consumer test for notification fan-out.

## 11. Rollout

No data migration; Excel history is not imported. Add roles to the seed, the service to compose files, gateway routes, and the web screens.
