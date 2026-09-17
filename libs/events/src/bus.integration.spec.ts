import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { EventBus } from './bus.service.js';
import { DurableConsumer } from './consumer.js';
import { InMemoryDedupeStore } from './dedupe.js';

let container: StartedTestContainer;
let url: string;

beforeAll(async () => {
  container = await new GenericContainer('nats:2.10-alpine')
    .withCommand(['-js'])
    .withExposedPorts(4222)
    .start();
  url = `nats://${container.getHost()}:${container.getMappedPort(4222)}`;
}, 120_000);

afterAll(async () => { await container?.stop(); });

describe('EventBus over JetStream', () => {
  it('delivers a published event to a durable consumer', async () => {
    const bus = new EventBus();
    await bus.connect(url);
    await bus.ensureStreams();

    const received: unknown[] = [];
    const consumer = new DurableConsumer(bus, new InMemoryDedupeStore());
    await consumer.subscribe('iam.scope.granted', 'test-consumer', async (env) => {
      received.push(env.payload);
    });

    await bus.publish('iam.scope.granted', { userId: 'u1', level: 'PROJECT', projectId: 'p1', siteId: null });

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5000 });
    expect(received[0]).toMatchObject({ userId: 'u1', projectId: 'p1' });

    await consumer.close();
    await bus.close();
  }, 30_000);

  it('processes a redelivered event exactly once', async () => {
    const bus = new EventBus();
    await bus.connect(url);
    await bus.ensureStreams();

    let handled = 0;
    const dedupe = new InMemoryDedupeStore();
    const consumer = new DurableConsumer(bus, dedupe);
    await consumer.subscribe('iam.role.assigned', 'dedupe-consumer', async () => { handled += 1; });

    const envelope = await bus.publish('iam.role.assigned', { userId: 'u1', roleCode: 'FIELD_ENGINEER' });
    await vi.waitFor(() => expect(handled).toBe(1), { timeout: 5000 });

    await consumer.handleEnvelope(envelope);   // simulate redelivery
    expect(handled).toBe(1);

    await consumer.close();
    await bus.close();
  }, 30_000);
});
