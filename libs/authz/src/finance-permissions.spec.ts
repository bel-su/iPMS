import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES, expandDependencies, validatePermissionSet } from './permissions.js';

const FINANCE_CODES = [
  'finance_request.view', 'finance_request.view_all', 'finance_request.create', 'finance_request.cancel',
  'finance_settlement.submit', 'finance_approval.pm', 'finance_approval.director',
  'finance_payment.record', 'finance_category.manage',
];

describe('finance permissions', () => {
  it('defines every finance permission', () => {
    for (const code of FINANCE_CODES) expect(PERMISSION_CODES.has(code), code).toBe(true);
  });

  it('makes approving and paying imply seeing the requests in scope', () => {
    for (const code of ['finance_approval.pm', 'finance_approval.director', 'finance_payment.record']) {
      const closed = expandDependencies([code]);
      expect(closed).toContain('finance_request.view');
      expect(closed).toContain('finance_request.view_all');
    }
  });

  it('is dependency-complete once closed', () => {
    expect(validatePermissionSet(expandDependencies(['finance_approval.director'])).valid).toBe(true);
  });
});
