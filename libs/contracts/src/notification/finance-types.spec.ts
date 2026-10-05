import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from './notification.js';

const FINANCE_TYPES = [
  'FINANCE_APPROVAL_NEEDED', 'FINANCE_PAYMENT_DUE', 'FINANCE_REQUEST_APPROVED', 'FINANCE_REQUEST_RETURNED',
  'FINANCE_REQUEST_REJECTED', 'FINANCE_REQUEST_CANCELLED', 'FINANCE_REQUEST_PAID', 'FINANCE_SETTLEMENT_SETTLED',
  'FINANCE_CASH_RETURNED',
];

describe('finance notification types', () => {
  it('lists every type the finance consumer emits', () => {
    for (const type of FINANCE_TYPES) expect(NOTIFICATION_TYPES, type).toContain(type);
  });

  it('keeps the QC types and has no duplicates', () => {
    expect(NOTIFICATION_TYPES).toEqual(expect.arrayContaining(['QC_SUBMISSION_SUBMITTED', 'QC_SUBMISSION_APPROVED', 'QC_SUBMISSION_REJECTED']));
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
  });
});
