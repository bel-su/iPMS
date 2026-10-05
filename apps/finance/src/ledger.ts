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
