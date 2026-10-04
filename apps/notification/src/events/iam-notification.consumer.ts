import type { OnModuleInit } from '@nestjs/common';
import {
  DurableConsumer, InMemoryDedupeStore, SUBJECTS,
  type EventBus, type EventEnvelope, type IamScopeExpiring,
} from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { NotificationService } from '../notifications/notification.service.js';
import { accessExpiringForEngineer, accessExpiringForManager } from './content.js';

const log = createLogger('notification');

/** Must match `STREAMS.IAM.durableConsumers`. */
export const IAM_NOTIFICATION_DURABLES = { expiring: 'notification-scope-expiring' } as const;

/** Tells an engineer, and the people who can renew it, that project access is about to lapse. */
export class IamNotificationConsumer implements OnModuleInit {
  constructor(private readonly notifications: NotificationService, private readonly bus: EventBus) {}

  async onModuleInit(): Promise<void> {
    await this.register(new DurableConsumer(this.bus, new InMemoryDedupeStore()));
    log.info('iam notification consumers started');
  }

  async register(consumer: DurableConsumer): Promise<void> {
    await consumer.subscribe<IamScopeExpiring>(
      SUBJECTS.IAM_SCOPE_EXPIRING, IAM_NOTIFICATION_DURABLES.expiring, (envelope) => this.onExpiring(envelope),
    );
  }

  async onExpiring(envelope: EventEnvelope<IamScopeExpiring>): Promise<void> {
    const p = envelope.payload;
    const managers = [...new Set(p.managerIds)].filter((id) => id !== p.userId);
    await this.notifications.createMany([
      { recipientId: p.userId, eventId: envelope.eventId, ...accessExpiringForEngineer(p) },
      ...managers.map((recipientId) => ({ recipientId, eventId: envelope.eventId, ...accessExpiringForManager(p) })),
    ]);
  }
}
