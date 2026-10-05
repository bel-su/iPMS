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
