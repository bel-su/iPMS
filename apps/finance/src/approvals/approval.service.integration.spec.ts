import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { CommentSchema, uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { PaymentService } from '../payments/payment.service.js';
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

  it('refuses a Director amount above the request', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    await expect(approvals.approve(r.id, { amount: '50000.01' }, ACTORS.director, scopes.project)).rejects.toThrow(/more than was requested/);
  });

  it.each(['0', '0.00', '-5'])('refuses a Director amount of %s and leaves the request untouched', async (amount) => {
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    await expect(approvals.approve(r.id, { amount }, ACTORS.director, scopes.project)).rejects.toThrow(/greater than zero/i);
    const row = await prisma.financeRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('PENDING_DIRECTOR');
    expect(row.approvedAmount).toBeNull();
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

  it('hides the request from an in-scope caller who neither raised it nor may view all requests', async () => {
    const r = await submitted();
    // otherEngineer is in the same project but holds no view_all: the request must look missing, whatever its status.
    await expect(approvals.approve(r.id, {}, ACTORS.otherEngineer, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 404, message: 'Request not found' }));
    await expect(approvals.returnToRequester(r.id, 'x', ACTORS.otherEngineer, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 404 }));
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    await approvals.approve(r.id, {}, ACTORS.director, scopes.project);
    await expect(approvals.reject(r.id, 'x', ACTORS.otherEngineer, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 404, message: 'Request not found' }));
  });

  it('still tells a caller who can see the request that they lack the step permission', async () => {
    const r = await submitted();
    await expect(approvals.approve(r.id, {}, ACTORS.director, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 403 }));
    await expect(approvals.approve(r.id, {}, ACTORS.engineer, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 403 }));
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
    expect(event.payload).toMatchObject({ requesterId: ACTORS.engineer.id, comment: 'Attach the quotation', step: 'PM' });
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

  it('says which step acted when the Director rejects', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    await approvals.reject(r.id, 'Not in budget', ACTORS.director, scopes.project);
    expect((await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.rejected' } })).payload).toMatchObject({ step: 'DIRECTOR' });
  });

  it('applies the same step, scope and self-approval rules as approve', async () => {
    const r = await submitted(ACTORS.pm);
    await expect(approvals.reject(r.id, 'no', ACTORS.director, scopes.otherProject)).rejects.toThrow(/not found/);
    await expect(approvals.returnToRequester(r.id, 'no', ACTORS.otherPm, scopes.project)).rejects.toThrow(/finance_approval\.director/);
  });
});

describe('segregation of duties', () => {
  const ALREADY = 'You already approved an earlier step of this request';
  const pmAndDirector = { id: uuidv7(), permissions: [...ACTORS.pm.permissions, 'finance_approval.director'] };
  const superAdmin = { id: uuidv7(), permissions: [...ACTORS.pm.permissions, 'finance_approval.director', 'finance_payment.record', 'finance_category.manage'] };

  it('refuses a PM-and-Director who approved as PM when they try to act as Director', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, pmAndDirector, scopes.project);
    await expect(approvals.approve(r.id, {}, pmAndDirector, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 403, message: ALREADY }));
    await expect(approvals.returnToRequester(r.id, 'x', pmAndDirector, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 403, message: ALREADY }));
    await expect(approvals.reject(r.id, 'x', pmAndDirector, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 403, message: ALREADY }));
    expect((await prisma.financeRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('PENDING_DIRECTOR');
    expect(await prisma.outboxEvent.count({ where: { subject: 'finance.request.approved' } })).toBe(0);
  });

  it('refuses an all-permissions actor the second step after approving the first', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, superAdmin, scopes.global);
    await expect(approvals.approve(r.id, {}, superAdmin, scopes.global)).rejects.toThrow(ALREADY);
  });

  it('lets a different person take the next step', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, superAdmin, scopes.global);
    expect((await approvals.approve(r.id, {}, ACTORS.director, scopes.project)).status).toBe('PENDING_FINANCE');
  });

  it('only counts approvals of the current revision', async () => {
    const r = await submitted();
    await approvals.approve(r.id, {}, pmAndDirector, scopes.project);
    await approvals.returnToRequester(r.id, 'Fix it', ACTORS.director, scopes.project);
    await requests.submit(r.id, ACTORS.engineer);
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    // pmAndDirector approved revision 1 as PM; revision 2 is a fresh chain.
    expect((await approvals.approve(r.id, {}, pmAndDirector, scopes.project)).status).toBe('PENDING_FINANCE');
  });
});

describe('Finance returns or rejects at the payment step', () => {
  const bank = { mode: 'BANK_TRANSFER' as const, reference: 'TXN-1', paidOn: new Date('2026-10-05') };
  const payments = () => new PaymentService(prisma);

  async function atFinance(directorAmount = '40000') {
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    await approvals.approve(r.id, { amount: directorAmount }, ACTORS.director, scopes.project);
    return r.id;
  }

  it('returns to the requester, clearing the approved amount; the resubmission needs a new Director amount', async () => {
    const id = await atFinance('40000');
    const after = await approvals.returnToRequester(id, 'Wrong bank account', ACTORS.finance, scopes.global);
    expect(after).toMatchObject({ status: 'RETURNED', approvedAmount: null });
    expect((after.actions ?? []).at(-1)).toMatchObject({ step: 'FINANCE', action: 'RETURNED', actorId: ACTORS.finance.id, comment: 'Wrong bank account' });
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.returned' } });
    expect(event.payload).toMatchObject({ requestId: id, actorId: ACTORS.finance.id, approvedAmount: null, comment: 'Wrong bank account', step: 'FINANCE' });

    const again = await requests.submit(id, ACTORS.engineer);
    expect(again).toMatchObject({ status: 'PENDING_PM', revision: 2, approvedAmount: null });
    await expect(payments().pay(id, bank, ACTORS.finance, scopes.global)).rejects.toThrow(/not waiting for payment/);
    await approvals.approve(id, {}, ACTORS.pm, scopes.project);
    await approvals.approve(id, { amount: '30000' }, ACTORS.director, scopes.project);
    const paid = await payments().pay(id, bank, ACTORS.finance, scopes.global);
    expect(paid).toMatchObject({ status: 'PAID', approvedAmount: '30000.00' });
    expect(paid.payments?.[0]).toMatchObject({ amount: '30000.00' });
  });

  it('rejects for good, clearing the approved amount', async () => {
    const id = await atFinance();
    const after = await approvals.reject(id, 'Duplicate of ADV-0003', ACTORS.finance, scopes.global);
    expect(after).toMatchObject({ status: 'REJECTED', approvedAmount: null });
    expect((after.actions ?? []).at(-1)).toMatchObject({ step: 'FINANCE', action: 'REJECTED' });
    expect((await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.rejected' } })).payload).toMatchObject({ approvedAmount: null, comment: 'Duplicate of ADV-0003', step: 'FINANCE' });
    await expect(requests.submit(id, ACTORS.engineer)).rejects.toThrow(/draft or returned/);
    await expect(payments().pay(id, bank, ACTORS.finance, scopes.global)).rejects.toThrow(/not waiting for payment/);
  });

  it('refuses a PM or Director at the Finance step', async () => {
    const id = await atFinance();
    await expect(approvals.returnToRequester(id, 'x', ACTORS.otherPm, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 403, message: expect.stringMatching(/finance_payment\.record/) }));
    await expect(approvals.reject(id, 'x', ACTORS.director, scopes.project)).rejects.toThrow(expect.objectContaining({ status: 403 }));
    expect((await prisma.financeRequest.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_FINANCE');
  });

  it('hides the request from Finance outside its project', async () => {
    const id = await atFinance();
    await expect(approvals.returnToRequester(id, 'x', ACTORS.finance, scopes.otherProject)).rejects.toThrow(/not found/);
  });

  it('requires a comment (the route\'s contract)', () => {
    expect(CommentSchema.safeParse({ comment: '  ' }).success).toBe(false);
    expect(CommentSchema.safeParse({}).success).toBe(false);
  });

  it('still has no approve at the Finance step: paying is the approval', async () => {
    const id = await atFinance();
    await expect(approvals.approve(id, {}, ACTORS.finance, scopes.global)).rejects.toThrow(expect.objectContaining({ status: 409 }));
  });

  it('refuses Finance returning a request they approved at an earlier step', async () => {
    const financeAndDirector = { id: uuidv7(), permissions: [...ACTORS.finance.permissions, 'finance_approval.director'] };
    const r = await submitted();
    await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    await approvals.approve(r.id, {}, financeAndDirector, scopes.global);
    await expect(approvals.returnToRequester(r.id, 'x', financeAndDirector, scopes.global)).rejects.toThrow(/already approved an earlier step/);
  });
});
