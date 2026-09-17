import { connect, JSONCodec, type NatsConnection, type JetStreamClient, type JetStreamManager, RetentionPolicy } from 'nats';
import { createEnvelope, type EventEnvelope } from './envelope.js';
import { STREAMS } from './subjects.js';

const codec = JSONCodec();

export class EventBus {
  private nc?: NatsConnection;
  private js?: JetStreamClient;
  private jsm?: JetStreamManager;

  async connect(url: string): Promise<void> {
    this.nc = await connect({ servers: url, name: 'ipms', maxReconnectAttempts: -1 });
    this.js = this.nc.jetstream();
    this.jsm = await this.nc.jetstreamManager();
  }

  async ensureStreams(): Promise<void> {
    if (!this.jsm) throw new Error('EventBus.connect must be called before ensureStreams');
    for (const stream of Object.values(STREAMS)) {
      await this.jsm.streams.add({
        name: stream.name,
        subjects: stream.subjects,
        max_age: stream.maxAgeMs * 1_000_000,   // nanoseconds
        retention: RetentionPolicy.Limits,
      }).catch((err: unknown) => {
        // Re-adding an identical stream is not an error; anything else is.
        if (!String(err).includes('stream name already in use')) throw err;
      });
    }
  }

  async publish<T>(
    subject: string,
    payload: T,
    opts?: { actorId?: string; correlationId?: string; eventId?: string },
  ): Promise<EventEnvelope<T>> {
    if (!this.js) throw new Error('EventBus.connect must be called before publish');
    const envelope = createEnvelope(subject, payload, opts);
    if (opts?.eventId) {
      envelope.eventId = opts.eventId;
    }
    await this.js.publish(subject, codec.encode(envelope), { msgID: envelope.eventId });
    return envelope;
  }

  jetstream(): JetStreamClient {
    if (!this.js) throw new Error('EventBus.connect must be called first');
    return this.js;
  }

  manager(): JetStreamManager {
    if (!this.jsm) throw new Error('EventBus.connect must be called first');
    return this.jsm;
  }

  async isHealthy(): Promise<boolean> {
    return this.nc !== undefined && !this.nc.isClosed();
  }

  async close(): Promise<void> {
    await this.nc?.drain();
  }
}
