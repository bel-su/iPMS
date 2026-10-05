export type FinanceRequestKind = 'ADVANCE' | 'SETTLEMENT' | 'REIMBURSEMENT';
export type FinanceStep = 'PM' | 'DIRECTOR' | 'FINANCE';

/**
 * What every finance event says about the request. Amounts are NPR strings with
 * two decimals. `actorId` is who did the thing; `requesterId` is who to tell
 * about the outcome. Carries the project name and request number so a consumer
 * can write the notification without calling back into finance.
 */
export interface FinanceEventBase {
  requestId: string;
  number: string;
  kind: FinanceRequestKind;
  projectId: string;
  projectName: string;
  requesterId: string;
  requestedAmount: string;
  /** Set once the Director has approved. */
  approvedAmount: string | null;
  actorId: string;
  /** ISO-8601. */
  at: string;
  comment: string | null;
}

/** `nextStep` says who is now holding it: PM, or DIRECTOR when a PM raised it. */
export interface FinanceRequestSubmitted extends FinanceEventBase { nextStep: 'PM' | 'DIRECTOR' }
export type FinanceRequestApprovedByPm = FinanceEventBase;
/** The Director approved; Finance holds it now. */
export type FinanceRequestApproved = FinanceEventBase;
export type FinanceRequestReturned = FinanceEventBase;
export type FinanceRequestRejected = FinanceEventBase;
/** `heldBy` is the step the request was waiting at when the requester cancelled it. */
export interface FinanceRequestCancelled extends FinanceEventBase { heldBy: FinanceStep }

/** Who approved at each step, so the paid notification can reach all of them. `pmId` is null for a PM-raised request. */
export interface FinanceApprovers { pmId: string | null; directorId: string }

/** An advance or reimbursement was paid. `paidAmount` equals `approvedAmount`. */
export interface FinanceRequestPaid extends FinanceEventBase { approvers: FinanceApprovers; paidAmount: string }

/**
 * A settlement against an advance completed. `appliedAmount` was set against the
 * advance; `payoutAmount` is any excess paid to the requester ("0.00" when none).
 */
export interface FinanceSettlementSettled extends FinanceEventBase {
  approvers: FinanceApprovers;
  advanceId: string;
  appliedAmount: string;
  payoutAmount: string;
}

/**
 * Finance recorded cash the requester handed back out of a paid advance.
 * `returnedAmount` is this return; `outstandingAfter` is the advance's balance
 * once it is counted ("0.00" closes the advance).
 */
export interface FinanceAdvanceCashReturned extends FinanceEventBase {
  returnedAmount: string;
  outstandingAfter: string;
}
