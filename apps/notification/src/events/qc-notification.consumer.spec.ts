import { describe, expect, it, vi } from 'vitest';
import { SUBJECTS, type EventEnvelope, type QcSubmissionReviewed, type QcSubmissionSubmitted } from '@ipms/events';
import {
  NOTIFICATION_DURABLES, QcNotificationConsumer, REVIEW_PERMISSION,
} from './qc-notification.consumer.js';

const SUBMITTER = 'u-submitter';
const SUBMITTED: QcSubmissionSubmitted = {
  submissionId: 's-1', taskId: 'w-1', workOrderId: 'w-1', workOrderTitle: 'Tower check', projectId: 'p-1',
  siteId: 'si-1', siteCode: 'KOS121', attemptNo: 1, submittedBy: SUBMITTER, submittedAt: '2026-10-02T08:00:00Z',
};
const REVIEWED: QcSubmissionReviewed = {
  submissionId: 's-1', taskId: 'w-1', workOrderId: 'w-1', workOrderTitle: 'Tower check', projectId: 'p-1',
  siteId: 'si-1', siteCode: 'KOS121', attemptNo: 1, submittedBy: SUBMITTER, decision: 'APPROVE',
  reviewedBy: 'u-reviewer', reviewedAt: '2026-10-02T09:00:00Z', comment: null,
};

const envelope = <T>(payload: T): EventEnvelope<T> => ({
  eventId: 'evt-1', subject: 'x', occurredAt: '2026-10-02T08:00:00Z', version: 1, correlationId: 'c-1', actorId: null, payload,
});

function build(holders: string[] | Error = ['u-r1', 'u-r2', SUBMITTER]) {
  const notifications = { createMany: vi.fn().mockResolvedValue(1) };
  const iam = {
    holders: vi.fn(async () => {
      if (holders instanceof Error) throw holders;
      return holders;
    }),
  };
  const consumer = new QcNotificationConsumer(notifications as never, iam as never, {} as never);
  return { consumer, notifications, iam };
}

describe('QcNotificationConsumer.onSubmitted', () => {
  it('notifies every reviewer of the project except the submitter, once each', async () => {
    const { consumer, notifications, iam } = build(['u-r1', 'u-r2', 'u-r1', SUBMITTER]);
    await consumer.onSubmitted(envelope(SUBMITTED));
    expect(iam.holders).toHaveBeenCalledWith(REVIEW_PERMISSION, 'p-1');
    const rows = notifications.createMany.mock.calls[0]?.[0];
    expect(rows.map((r: { recipientId: string }) => r.recipientId)).toEqual(['u-r1', 'u-r2']);
    expect(rows[0]).toMatchObject({ eventId: 'evt-1', type: 'QC_SUBMISSION_SUBMITTED', workOrderId: 'w-1' });
  });

  it('throws when iam fails, so the event is redelivered and nothing is dropped', async () => {
    const { consumer, notifications } = build(new Error('iam down'));
    await expect(consumer.onSubmitted(envelope(SUBMITTED))).rejects.toThrow('iam down');
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('acknowledges a project with no reviewers instead of retrying', async () => {
    const { consumer, notifications } = build([SUBMITTER]);
    await expect(consumer.onSubmitted(envelope(SUBMITTED))).resolves.toBeUndefined();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('skips, without calling iam, an event published before the payload was enriched', async () => {
    const { consumer, notifications, iam } = build();
    const legacy = { submissionId: 's-1', taskId: 'w-1', projectId: 'p-1', attemptNo: 1, submittedBy: SUBMITTER, submittedAt: 'x' };
    await expect(consumer.onSubmitted(envelope(legacy as never))).resolves.toBeUndefined();
    expect(iam.holders).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });
});

describe('QcNotificationConsumer.onReviewed', () => {
  it('tells the submitter their work was approved', async () => {
    const { consumer, notifications } = build();
    await consumer.onReviewed(envelope(REVIEWED));
    expect(notifications.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ recipientId: SUBMITTER, eventId: 'evt-1', type: 'QC_SUBMISSION_APPROVED' }),
    ]);
  });

  it('carries the reviewer’s comment on a rework decision', async () => {
    const { consumer, notifications } = build();
    await consumer.onReviewed(envelope({ ...REVIEWED, decision: 'REJECT_REWORK', comment: 'Photo is blurred' }));
    const [row] = notifications.createMany.mock.calls[0]?.[0];
    expect(row).toMatchObject({ type: 'QC_SUBMISSION_REJECTED', recipientId: SUBMITTER });
    expect(row.body).toContain('Photo is blurred');
  });

  it('skips an event published before the payload was enriched', async () => {
    const { consumer, notifications } = build();
    const legacy = { submissionId: 's-1', taskId: 'w-1', projectId: 'p-1', attemptNo: 1, decision: 'APPROVE', reviewedBy: 'u', reviewedAt: 'x', comment: null };
    await expect(consumer.onReviewed(envelope(legacy as never))).resolves.toBeUndefined();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });
});

describe('QcNotificationConsumer.register', () => {
  it('subscribes one durable per subject', async () => {
    const { consumer } = build();
    const subscribe = vi.fn().mockResolvedValue(undefined);
    await consumer.register({ subscribe } as never);
    expect(subscribe.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [SUBJECTS.QC_SUBMISSION_SUBMITTED, NOTIFICATION_DURABLES.submitted],
      [SUBJECTS.QC_SUBMISSION_REVIEWED, NOTIFICATION_DURABLES.reviewed],
    ]);
    expect(NOTIFICATION_DURABLES).toEqual({
      submitted: 'notification-submission-submitted',
      reviewed: 'notification-submission-reviewed',
    });
  });
});
