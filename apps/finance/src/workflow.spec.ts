import { describe, expect, it } from 'vitest';
import {
  STEP_PERMISSION, awaitingStatuses, entryStatus, finalStatus, isEditable, isPending, isPm, statusAfterApproval, stepOf,
} from './workflow.js';

describe('workflow', () => {
  it('maps a pending status to the step that holds it', () => {
    expect(stepOf('PENDING_PM')).toBe('PM');
    expect(stepOf('PENDING_DIRECTOR')).toBe('DIRECTOR');
    expect(stepOf('PENDING_FINANCE')).toBe('FINANCE');
    expect(stepOf('DRAFT')).toBeNull();
    expect(stepOf('PAID')).toBeNull();
  });

  it('treats only the three PENDING states as pending', () => {
    for (const s of ['PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE']) expect(isPending(s)).toBe(true);
    for (const s of ['DRAFT', 'RETURNED', 'REJECTED', 'CANCELLED', 'PAID', 'SETTLED']) expect(isPending(s)).toBe(false);
  });

  it('does not mistake inherited object keys for statuses', () => {
    for (const s of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(isPending(s)).toBe(false);
      expect(stepOf(s)).toBeNull();
    }
  });

  it('lets only a draft or returned request be edited', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('RETURNED')).toBe(true);
    expect(isEditable('PENDING_PM')).toBe(false);
  });

  it('sends an engineer to the PM and a PM straight to the Director', () => {
    expect(entryStatus(false)).toBe('PENDING_PM');
    expect(entryStatus(true)).toBe('PENDING_DIRECTOR');
  });

  it('advances PM to Director to Finance', () => {
    expect(statusAfterApproval('PENDING_PM')).toBe('PENDING_DIRECTOR');
    expect(statusAfterApproval('PENDING_DIRECTOR')).toBe('PENDING_FINANCE');
  });

  it('ends a settlement as SETTLED and the others as PAID', () => {
    expect(finalStatus('SETTLEMENT')).toBe('SETTLED');
    expect(finalStatus('ADVANCE')).toBe('PAID');
    expect(finalStatus('REIMBURSEMENT')).toBe('PAID');
  });

  it('names the permission each step needs', () => {
    expect(STEP_PERMISSION).toEqual({ PM: 'finance_approval.pm', DIRECTOR: 'finance_approval.director', FINANCE: 'finance_payment.record' });
  });

  it('recognises a PM by the permission to approve as one', () => {
    expect(isPm(['finance_approval.pm', 'finance_request.view'])).toBe(true);
    expect(isPm(['finance_request.create'])).toBe(false);
  });

  it('lists what is waiting for a user, from the steps they may act on', () => {
    expect(awaitingStatuses(['finance_approval.pm'])).toEqual(['PENDING_PM']);
    expect(awaitingStatuses(['finance_approval.pm', 'finance_approval.director'])).toEqual(['PENDING_PM', 'PENDING_DIRECTOR']);
    expect(awaitingStatuses(['finance_payment.record'])).toEqual(['PENDING_FINANCE']);
    expect(awaitingStatuses(['finance_request.view'])).toEqual([]);
  });
});
