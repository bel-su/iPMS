import { describe, expect, it, vi } from 'vitest';
import { OutboxDrainer } from './outbox.drainer.js';

const pending = [
  { id: 'e-1', subject: 'iam.scope.granted', payload: { userId: 'u-1' }, correlationId: 'c-1', actorId: 'a-1' },
  { id: 'e-2', subject: 'audit.event.recorded', payload: { action: 'role.created' }, correlationId: 'c-1', actorId: 'a-1' },
];

function build(rows = pending) {
  const prisma = {
    outboxEvent: {
      findMany: vi.fn().mockResolvedValue(rows),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const bus = { publish: vi.fn().mockResolvedValue({ eventId: 'x' }) };
  return { drainer: new OutboxDrainer(prisma as never, bus as never), prisma, bus };
}

describe('OutboxDrainer.drain', () => {
  it('publishes every pending row', async () => {
    const { drainer, bus } = build();
    await drainer.drain();
    expect(bus.publish).toHaveBeenCalledTimes(2);
  });

  it('publishes with the row id as the event id, so redelivery is deduplicated', async () => {
    const { drainer, bus } = build();
    await drainer.drain();
    expect(bus.publish).toHaveBeenCalledWith('iam.scope.granted', { userId: 'u-1' },
      expect.objectContaining({ correlationId: 'c-1', eventId: 'e-1' }));
  });

  it('marks a row published only after a successful publish', async () => {
    const { drainer, prisma } = build();
    await drainer.drain();
    expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(2);
  });

  it('leaves a row unpublished when publishing throws, so it retries', async () => {
    const { drainer, prisma, bus } = build();
    bus.publish.mockRejectedValueOnce(new Error('nats down'));
    await drainer.drain();
    expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is nothing pending', async () => {
    const { drainer, bus } = build([]);
    await drainer.drain();
    expect(bus.publish).not.toHaveBeenCalled();
  });
});
