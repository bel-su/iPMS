import { describe, expect, it } from 'vitest';
import type { QcSubmissionReviewed, QcSubmissionSubmitted } from '@ipms/events';
import { reviewedContent, submittedContent } from './content.js';

const SUBMITTED: QcSubmissionSubmitted = {
  submissionId: 's-1', taskId: 'w-1', workOrderId: 'w-1', workOrderTitle: 'Tower foundation check',
  projectId: 'p-1', siteId: 'si-1', siteCode: 'KOS121', attemptNo: 2, submittedBy: 'u-1', submittedAt: '2026-10-02T08:00:00Z',
};
const REVIEWED: QcSubmissionReviewed = {
  submissionId: 's-1', taskId: 'w-1', workOrderId: 'w-1', workOrderTitle: 'Tower foundation check',
  projectId: 'p-1', siteId: 'si-1', siteCode: 'KOS121', attemptNo: 2, submittedBy: 'u-1',
  decision: 'APPROVE', reviewedBy: 'u-2', reviewedAt: '2026-10-02T09:00:00Z', comment: null,
};

describe('submittedContent', () => {
  it('names the work order, site and attempt and links to the work order', () => {
    expect(submittedContent(SUBMITTED)).toEqual({
      type: 'QC_SUBMISSION_SUBMITTED',
      title: 'Submission awaiting review',
      body: 'Work order "Tower foundation check" at KOS121 was submitted for review (attempt 2).',
      actionUrl: '/quality/work-orders/w-1',
      workOrderId: 'w-1',
    });
  });
});

describe('reviewedContent', () => {
  it('approves', () => {
    expect(reviewedContent(REVIEWED)).toMatchObject({
      type: 'QC_SUBMISSION_APPROVED',
      title: 'Submission approved',
      body: 'Work order "Tower foundation check" at KOS121 was approved.',
    });
  });

  it('puts the reviewer’s comment in a rework notice', () => {
    expect(reviewedContent({ ...REVIEWED, decision: 'REJECT_REWORK', comment: 'Photo is blurred' })).toMatchObject({
      type: 'QC_SUBMISSION_REJECTED',
      title: 'Rework required',
      body: 'Work order "Tower foundation check" at KOS121 needs rework: Photo is blurred',
    });
  });

  it('still reads sensibly with no comment', () => {
    expect(reviewedContent({ ...REVIEWED, decision: 'REJECT_REWORK' }).body)
      .toBe('Work order "Tower foundation check" at KOS121 needs rework.');
  });
});
