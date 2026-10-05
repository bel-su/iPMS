import type { RequestKind } from '@ipms/contracts';

/** The three approval steps, in order. Statuses are strings in the database; this module is the only place that knows the rules. */
export type Step = 'PM' | 'DIRECTOR' | 'FINANCE';

export const PENDING_STATUSES = ['PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE'] as const;
export const EDITABLE_STATUSES = ['DRAFT', 'RETURNED'] as const;

const STEP_BY_STATUS: Record<string, Step> = { PENDING_PM: 'PM', PENDING_DIRECTOR: 'DIRECTOR', PENDING_FINANCE: 'FINANCE' };

export const STEP_PERMISSION: Record<Step, string> = {
  PM: 'finance_approval.pm',
  DIRECTOR: 'finance_approval.director',
  FINANCE: 'finance_payment.record',
};

export const stepOf = (status: string): Step | null => STEP_BY_STATUS[status] ?? null;
export const isPending = (status: string): boolean => status in STEP_BY_STATUS;
export const isEditable = (status: string): boolean => (EDITABLE_STATUSES as readonly string[]).includes(status);

/** Raising a request as a PM skips the PM step: nobody approves their own request. */
export const isPm = (permissions: readonly string[]): boolean => permissions.includes(STEP_PERMISSION.PM);
export const entryStatus = (requesterIsPm: boolean): 'PENDING_PM' | 'PENDING_DIRECTOR' => (requesterIsPm ? 'PENDING_DIRECTOR' : 'PENDING_PM');

export function statusAfterApproval(status: 'PENDING_PM' | 'PENDING_DIRECTOR'): 'PENDING_DIRECTOR' | 'PENDING_FINANCE' {
  return status === 'PENDING_PM' ? 'PENDING_DIRECTOR' : 'PENDING_FINANCE';
}

/** A settlement is "settled" (it may move no cash); the others are "paid". */
export const finalStatus = (kind: RequestKind): 'PAID' | 'SETTLED' => (kind === 'SETTLEMENT' ? 'SETTLED' : 'PAID');

/** The statuses a user could act on, from the steps their permissions open. */
export function awaitingStatuses(permissions: readonly string[]): string[] {
  return PENDING_STATUSES.filter((status) => permissions.includes(STEP_PERMISSION[STEP_BY_STATUS[status]!]));
}
