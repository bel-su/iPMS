import type {
  FinanceAdvanceCashReturned, FinanceEventBase, FinanceRequestApproved, FinanceRequestApprovedByPm,
  FinanceRequestCancelled, FinanceRequestPaid, FinanceRequestRejected, FinanceRequestReturned,
  FinanceRequestSubmitted, FinanceSettlementSettled, FinanceStep,
} from '@ipms/events';
import type { NotificationDraft } from './content.js';

const KIND: Record<FinanceEventBase['kind'], string> = { ADVANCE: 'Advance', SETTLEMENT: 'Settlement', REIMBURSEMENT: 'Reimbursement' };
const STEP: Record<FinanceStep, string> = { PM: 'the project manager', DIRECTOR: 'the project director', FINANCE: 'finance' };

/** "NPR 1,50,000.00": two decimals, Indian digit grouping, as the company writes it. */
export function formatNpr(amount: string): string {
  return `NPR ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const urlFor = (p: FinanceEventBase): string => `/finance/requests/${p.requestId}`;
const subject = (p: FinanceEventBase): string => `${KIND[p.kind]} ${p.number}`;
const lowerSubject = (p: FinanceEventBase): string => `${KIND[p.kind].toLowerCase()} ${p.number}`;
const onProject = (p: FinanceEventBase): string => `${subject(p)} for ${p.projectName}`;
/** `: <comment>` when there is one; each template adds its own closing full stop. */
const reason = (comment: string | null): string => (comment ? `: ${comment}` : '');

function draft(p: FinanceEventBase, type: string, title: string, body: string): NotificationDraft {
  return { type, title, body, actionUrl: urlFor(p), workOrderId: null };
}

export function approvalNeededContent(p: FinanceRequestSubmitted | FinanceRequestApprovedByPm): NotificationDraft {
  return draft(p, 'FINANCE_APPROVAL_NEEDED', 'Approval needed',
    `${onProject(p)} (${formatNpr(p.requestedAmount)}) is waiting for your approval.`);
}

export function paymentDueContent(p: FinanceRequestApproved): NotificationDraft {
  return draft(p, 'FINANCE_PAYMENT_DUE', 'Payment due',
    `${onProject(p)} is approved for ${formatNpr(p.approvedAmount ?? p.requestedAmount)} and ready to pay.`);
}

export function approvedContent(p: FinanceRequestApproved): NotificationDraft {
  const approved = p.approvedAmount ?? p.requestedAmount;
  const reduced = approved !== p.requestedAmount;
  const amount = reduced ? `${formatNpr(approved)} (you asked for ${formatNpr(p.requestedAmount)})` : formatNpr(approved);
  return draft(p, 'FINANCE_REQUEST_APPROVED', 'Request approved',
    `Your ${lowerSubject(p)} was approved for ${amount}. It is waiting for payment.`);
}

export function returnedContent(p: FinanceRequestReturned): NotificationDraft {
  return draft(p, 'FINANCE_REQUEST_RETURNED', 'Request returned',
    `Your ${lowerSubject(p)} was returned by ${STEP[p.step]}${reason(p.comment)}. Edit it and submit again.`);
}

export function rejectedContent(p: FinanceRequestRejected): NotificationDraft {
  return draft(p, 'FINANCE_REQUEST_REJECTED', 'Request rejected',
    `Your ${lowerSubject(p)} was rejected by ${STEP[p.step]}${reason(p.comment)}.`);
}

export function cancelledContent(p: FinanceRequestCancelled): NotificationDraft {
  return draft(p, 'FINANCE_REQUEST_CANCELLED', 'Request cancelled',
    `${onProject(p)} was cancelled by its requester while waiting for ${STEP[p.heldBy]}${reason(p.comment)}.`);
}

export function paidContent(p: FinanceRequestPaid): NotificationDraft {
  return draft(p, 'FINANCE_REQUEST_PAID', 'Payment made', `${onProject(p)} was paid: ${formatNpr(p.paidAmount)}.`);
}

export function settledContent(p: FinanceSettlementSettled): NotificationDraft {
  const payout = Number(p.payoutAmount) > 0 ? `, ${formatNpr(p.payoutAmount)} paid out` : '';
  return draft(p, 'FINANCE_SETTLEMENT_SETTLED', 'Settlement completed',
    `${onProject(p)} was settled: ${formatNpr(p.appliedAmount)} applied to the advance${payout}.`);
}

export function cashReturnedContent(p: FinanceAdvanceCashReturned): NotificationDraft {
  const rest = Number(p.outstandingAfter) > 0
    ? `${formatNpr(p.outstandingAfter)} is still outstanding.`
    : 'The advance is now fully settled.';
  return draft(p, 'FINANCE_CASH_RETURNED', 'Cash return recorded',
    `Finance recorded ${formatNpr(p.returnedAmount)} returned against ${lowerSubject(p)}. ${rest}`);
}
