/**
 * `attemptNo` orders a task's submissions. The two subjects are consumed by
 * separate durables, so a review can arrive before the submission it reviews;
 * the consumer uses the attempt number to apply each fact once and never let
 * an older one overwrite a newer one.
 */
export interface QcSubmissionSubmitted {
  submissionId: string;
  taskId: string;
  /** The work order's id; the same value as `taskId`, named for what consumers mean by it. */
  workOrderId: string;
  workOrderTitle: string;
  projectId: string;
  siteId: string;
  siteCode: string;
  attemptNo: number;
  submittedBy: string;
  submittedAt: string;
}

export interface QcSubmissionReviewed {
  submissionId: string;
  taskId: string;
  workOrderId: string;
  workOrderTitle: string;
  projectId: string;
  siteId: string;
  siteCode: string;
  attemptNo: number;
  /** Who submitted the work being reviewed: the person to tell about the decision. */
  submittedBy: string;
  decision: 'APPROVE' | 'REJECT_REWORK';
  reviewedBy: string;
  reviewedAt: string;
  comment: string | null;
}

/** A work order left the open states without completing. `cancelledAt` is ISO-8601. */
export interface QcWorkOrderCancelled {
  workOrderId: string;
  projectId: string;
  siteId: string;
  cancelledAt: string;
}
