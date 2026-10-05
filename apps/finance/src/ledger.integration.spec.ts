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
