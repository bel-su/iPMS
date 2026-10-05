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
