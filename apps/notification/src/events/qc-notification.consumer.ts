import type { OnModuleInit } from '@nestjs/common';
import {
  DurableConsumer, InMemoryDedupeStore, SUBJECTS,
  type EventBus, type EventEnvelope, type QcSubmissionReviewed, type QcSubmissionSubmitted,
} from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { IamDirectoryClient } from '../directory/iam-directory.client.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { reviewedContent, submittedContent } from './content.js';

const log = createLogger('notification');

/** Must match `STREAMS.QC.durableConsumers`. One durable per subject: a durable carries a single filter_subject. */
export const NOTIFICATION_DURABLES = {
  submitted: 'notification-submission-submitted',
  reviewed: 'notification-submission-reviewed',
} as const;

export const REVIEW_PERMISSION = 'qc_review.approve';

/**
 * Events published before the payload carried labels and the submitter lack
 * these fields. Retrying cannot supply them, so such an event is acknowledged
 * rather than redelivered into the dead-letter queue.
 */
const hasLabels = (p: { workOrderId?: unknown; workOrderTitle?: unknown; siteCode?: unknown }): boolean =>
  typeof p.workOrderId === 'string' && typeof p.workOrderTitle === 'string' && typeof p.siteCode === 'string';

/**
 * Turns QC submission facts into in-app notifications.
 *
 * Idempotency lives in the database (unique `(recipientId, eventId)`), so the
 * in-memory dedupe store here only saves repeat work within one process; it
 * does not need to survive a restart or be shared between replicas.
 */
export class QcNotificationConsumer implements OnModuleInit {
  constructor(
    private readonly notifications: NotificationService,
    private readonly iam: IamDirectoryClient,
    private readonly bus: EventBus,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.register(new DurableConsumer(this.bus, new InMemoryDedupeStore()));
    log.info('qc notification consumers started');
  }

  async register(consumer: DurableConsumer): Promise<void> {
    await consumer.subscribe<QcSubmissionSubmitted>(
      SUBJECTS.QC_SUBMISSION_SUBMITTED, NOTIFICATION_DURABLES.submitted, (envelope) => this.onSubmitted(envelope),
    );
    await consumer.subscribe<QcSubmissionReviewed>(
      SUBJECTS.QC_SUBMISSION_REVIEWED, NOTIFICATION_DURABLES.reviewed, (envelope) => this.onReviewed(envelope),
    );
  }

  /** Reviewers of the project, minus the person who submitted (who may hold the permission too). */
  async onSubmitted(envelope: EventEnvelope<QcSubmissionSubmitted>): Promise<void> {
    const p = envelope.payload;
    if (!hasLabels(p)) {
      log.warn({ eventId: envelope.eventId, subject: envelope.subject }, 'event predates enriched payload, skipped');
      return;
    }
    // Throws when iam is unreachable: the durable redelivers, so nothing is dropped.
    const holders = await this.iam.holders(REVIEW_PERMISSION, p.projectId);
    const recipients = [...new Set(holders)].filter((id) => id !== p.submittedBy);
    if (recipients.length === 0) {
      log.warn({ eventId: envelope.eventId, projectId: p.projectId }, 'no reviewers to notify for submission');
      return;
    }
    const draft = submittedContent(p);
    await this.notifications.createMany(recipients.map((recipientId) => ({ recipientId, eventId: envelope.eventId, ...draft })));
  }

  /** The engineer who submitted the work. */
  async onReviewed(envelope: EventEnvelope<QcSubmissionReviewed>): Promise<void> {
    const p = envelope.payload;
    if (!hasLabels(p) || typeof p.submittedBy !== 'string') {
      log.warn({ eventId: envelope.eventId, subject: envelope.subject }, 'event predates enriched payload, skipped');
      return;
    }
    await this.notifications.createMany([{ recipientId: p.submittedBy, eventId: envelope.eventId, ...reviewedContent(p) }]);
  }
}
