import type { IamScopeExpiring, QcSubmissionReviewed, QcSubmissionSubmitted } from '@ipms/events';
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

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function whenText(p: IamScopeExpiring): string {
  return p.daysLeft <= 0 ? 'today' : `in ${plural(p.daysLeft, 'day')}`;
}

export function accessExpiringForEngineer(p: IamScopeExpiring): NotificationDraft {
  return {
    type: 'PROJECT_ACCESS_EXPIRING',
    title: 'Your project access is ending',
    body: `Your access to ${plural(p.grants.length, 'project')} ends ${whenText(p)}. Ask your project manager to renew it; work orders in those projects will no longer be visible to you after that.`,
    actionUrl: null,
    workOrderId: null,
  };
}

export function accessExpiringForManager(p: IamScopeExpiring): NotificationDraft {
  return {
    type: 'PROJECT_ACCESS_EXPIRING',
    title: `${p.userName}’s project access is ending`,
    body: `${p.userName}’s access to ${plural(p.grants.length, 'project')} ends ${whenText(p)}. Renew it on their user page if they still need it.`,
    actionUrl: `/users/${p.userId}`,
    workOrderId: null,
  };
}
