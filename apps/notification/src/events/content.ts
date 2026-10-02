import type { QcSubmissionReviewed, QcSubmissionSubmitted } from '@ipms/events';
import type { NewNotification } from '../notifications/notification.service.js';

export type NotificationDraft = Omit<NewNotification, 'recipientId' | 'eventId'>;

const urlFor = (workOrderId: string): string => `/quality/work-orders/${workOrderId}`;

function label(p: { workOrderTitle: string; siteCode: string }): string {
  return `Work order "${p.workOrderTitle}" at ${p.siteCode}`;
}

export function submittedContent(p: QcSubmissionSubmitted): NotificationDraft {
  return {
    type: 'QC_SUBMISSION_SUBMITTED',
    title: 'Submission awaiting review',
    body: `${label(p)} was submitted for review (attempt ${p.attemptNo}).`,
    actionUrl: urlFor(p.workOrderId),
    workOrderId: p.workOrderId,
  };
}

export function reviewedContent(p: QcSubmissionReviewed): NotificationDraft {
  const approved = p.decision === 'APPROVE';
  const reason = p.comment ? `: ${p.comment}` : '.';
  return {
    type: approved ? 'QC_SUBMISSION_APPROVED' : 'QC_SUBMISSION_REJECTED',
    title: approved ? 'Submission approved' : 'Rework required',
    body: approved ? `${label(p)} was approved.` : `${label(p)} needs rework${reason}`,
    actionUrl: urlFor(p.workOrderId),
    workOrderId: p.workOrderId,
  };
}
