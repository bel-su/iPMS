import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/qc';
import type { EventBus } from '@ipms/events';
import { createLogger } from '@ipms/observability';

const log = createLogger('qc');
const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 100;

@Injectable()
export class OutboxDrainer implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaClient, private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.drain().catch((err: unknown) => log.error({ err }, 'outbox drain failed'));
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    const pending = await this.prisma.outboxEvent.findMany({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' }, take: BATCH_SIZE });
    for (const row of pending) {
      try {
        await this.bus.publish(row.subject, row.payload, {
          correlationId: row.correlationId,
          eventId: row.id,
          ...(row.actorId === null ? {} : { actorId: row.actorId }),
        });
        await this.prisma.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date() } });
      } catch (err) {
        // Left pending; the next poll retries. Consumers dedupe on eventId.
        log.warn({ err, outboxId: row.id, subject: row.subject }, 'outbox publish failed, will retry');
      }
    }
  }
}
