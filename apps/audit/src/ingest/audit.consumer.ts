import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DurableConsumer, EventBus, RedisDedupeStore, SUBJECTS, type AuditEventPayload, type EventEnvelope } from '@ipms/events';
import { createLogger } from '@ipms/observability';
import { ChainService } from '../chain/chain.service.js';

const log = createLogger('audit');

@Injectable()
export class AuditConsumer implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly chain: ChainService,
    private readonly dedupe: RedisDedupeStore,
  ) {}

  async onModuleInit(): Promise<void> {
    const consumer = new DurableConsumer(this.bus, this.dedupe);
    // Exactly one durable consumer. Adding a second would fork the hash chain.
    await consumer.subscribe<AuditEventPayload>(
      SUBJECTS.AUDIT_EVENT,
      'audit-ledger-writer',
      async (envelope: EventEnvelope<AuditEventPayload>) => {
        await this.chain.append(envelope.payload, new Date(envelope.occurredAt), envelope.eventId);
        log.debug({ eventId: envelope.eventId, action: envelope.payload.action }, 'appended to ledger');
      },
    );
    log.info('audit ledger writer subscribed');
  }
}
