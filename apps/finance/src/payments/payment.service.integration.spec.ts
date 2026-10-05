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

  it('reports approvers from the current revision only', async () => {
    const id = await advance();
    // Build: revision 1 had a PM approval; revision 2 was approved by the Director alone.
    await prisma.approvalAction.updateMany({ where: { requestId: id, step: 'DIRECTOR', action: 'APPROVED' }, data: { revision: 2 } });
    await prisma.financeRequest.update({ where: { id }, data: { revision: 2 } });
    await payments.pay(id, bank, ACTORS.finance, scopes.global);
    expect((await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.paid' } })).payload).toMatchObject({ approvers: { pmId: null, directorId: ACTORS.director.id } });
  });

  it('lets only one of two concurrent payments of the same request through', async () => {
    const id = await advance();
    const results = await Promise.allSettled([
      payments.pay(id, bank, ACTORS.finance, scopes.global),
      payments.pay(id, bank, ACTORS.finance, scopes.global),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { subject: 'finance.request.paid' } })).toBe(1);
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

  it('refuses Finance returning cash against their own advance', async () => {
    const advanceId = await paidAdvance('1000');
    const self = { id: ACTORS.engineer.id, permissions: [...ACTORS.finance.permissions] };
    await expect(payments.returnCash(advanceId, { ...bank, amount: '10' }, self, scopes.global)).rejects.toThrow(/your own request/);
    expect(await prisma.payment.count({ where: { kind: 'CASH_RETURN' } })).toBe(0);
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
