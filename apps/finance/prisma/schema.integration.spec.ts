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

  describe('payments', () => {
    const payment = (requestId: string, kind: 'PAYOUT' | 'CASH_RETURN', amount = '10.00') => prisma.payment.create({
      data: { id: uuidv7(), requestId, kind, mode: 'CASH', reference: 'R', paidOn: new Date('2026-10-05'), amount, recordedBy: ACTORS.finance.id },
    });

    it('refuses a second payout for the same request', async () => {
      const row = await request({ status: 'PAID' });
      await payment(row.id, 'PAYOUT');
      await expect(payment(row.id, 'PAYOUT')).rejects.toMatchObject({ code: 'P2002' });
      expect(await prisma.payment.count({ where: { requestId: row.id } })).toBe(1);
    });

    it('allows one payout and any number of cash returns on a request', async () => {
      const row = await request({ status: 'PAID' });
      await payment(row.id, 'PAYOUT', '1000.00');
      await payment(row.id, 'CASH_RETURN');
      await payment(row.id, 'CASH_RETURN');
      expect(await prisma.payment.count({ where: { requestId: row.id } })).toBe(3);
    });
  });
});
