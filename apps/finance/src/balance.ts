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
