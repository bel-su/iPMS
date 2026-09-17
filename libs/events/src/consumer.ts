import { AckPolicy, DeliverPolicy, JSONCodec, type JsMsg } from 'nats';
import type { EventBus } from './bus.service.js';
import type { DedupeStore } from './dedupe.js';
import type { EventEnvelope } from './envelope.js';
import { createLogger, runWithCorrelation } from '@ipms/observability';
import { eventsConsumed } from '@ipms/observability';

const codec = JSONCodec<EventEnvelope<unknown>>();
const log = createLogger('events');

export type Handler<T> = (envelope: EventEnvelope<T>) => Promise<void>;

const MAX_DELIVERIES = 5;

export class DurableConsumer {
  private readonly handlers = new Map<string, Handler<never>>();
  private running = true;

  constructor(
    private readonly bus: EventBus,
    private readonly dedupe: DedupeStore,
  ) {}

  async subscribe<T>(subject: string, durable: string, handler: Handler<T>): Promise<void> {
    this.handlers.set(subject, handler as Handler<never>);

    const jsm = this.bus.manager();
    const streamName = await jsm.streams.find(subject);
    await jsm.consumers.add(streamName, {
      durable_name: durable,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subject: subject,
      max_deliver: MAX_DELIVERIES,
    }).catch((err: unknown) => {
      if (!String(err).includes('consumer already exists')) throw err;
    });

    const consumer = await this.bus.jetstream().consumers.get(streamName, durable);
    const messages = await consumer.consume();

    void (async () => {
      for await (const msg of messages) {
        if (!this.running) break;
        await this.processMessage(msg);
      }
    })();
  }

  private async processMessage(msg: JsMsg): Promise<void> {
    const envelope = codec.decode(msg.data);
    try {
      await this.handleEnvelope(envelope);
      msg.ack();
      eventsConsumed.inc({ subject: envelope.subject, outcome: 'ok' });
    } catch (err) {
      const deliveries = msg.info.redeliveryCount;
      if (deliveries >= MAX_DELIVERIES) {
        log.error({ err, eventId: envelope.eventId, subject: envelope.subject }, 'event exhausted retries, terminating to DLQ');
        msg.term();
        eventsConsumed.inc({ subject: envelope.subject, outcome: 'dead_lettered' });
      } else {
        log.warn({ err, eventId: envelope.eventId, deliveries }, 'event handling failed, will redeliver');
        msg.nak(Math.min(2 ** deliveries, 30) * 1000);
        eventsConsumed.inc({ subject: envelope.subject, outcome: 'retried' });
      }
    }
  }

  /** Exposed so tests can simulate a redelivery without a broker round-trip. */
  async handleEnvelope(envelope: EventEnvelope<unknown>): Promise<void> {
    if (await this.dedupe.seen(envelope.eventId)) {
      log.debug({ eventId: envelope.eventId }, 'duplicate event ignored');
      return;
    }
    const handler = this.handlers.get(envelope.subject);
    if (!handler) return;

    await runWithCorrelation(envelope.correlationId, async () => {
      await (handler as Handler<unknown>)(envelope);
    });
    await this.dedupe.remember(envelope.eventId);
  }

  async close(): Promise<void> {
    this.running = false;
  }
}
