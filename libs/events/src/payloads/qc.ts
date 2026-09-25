/**
 * `attemptNo` orders a task's submissions. The two subjects are consumed by
 * separate durables, so a review can arrive before the submission it reviews;
 * the consumer uses the attempt number to apply each fact once and never let
 * an older one overwrite a newer one.
 */
export interface QcSubmissionSubmitted {
  submissionId: string;
  taskId: string;
  projectId: string;
  attemptNo: number;
  submittedBy: string;
  submittedAt: string;
}

export interface QcSubmissionReviewed {
  submissionId: string;
  taskId: string;
  projectId: string;
  attemptNo: number;
  decision: 'APPROVE' | 'REJECT_REWORK';
  reviewedBy: string;
  reviewedAt: string;
  comment: string | null;
}
