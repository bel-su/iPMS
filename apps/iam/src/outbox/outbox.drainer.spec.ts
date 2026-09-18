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

  it('marks every successfully published row', async () => {
    const { drainer, prisma } = build();
    await drainer.drain();
    expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(2);
  });

  /**
   * Asserts the *value*, not just that an update happened. A drainer that set
   * `publishedAt: null` would republish every row on every poll forever — an
   * unbounded event loop — and passed all five tests in this file while it
   * only counted calls.
   */
  it('stamps publishedAt with a real timestamp, so the row is not picked up again', async () => {
    const { drainer, prisma } = build();
    await drainer.drain();
    for (const [args] of prisma.outboxEvent.update.mock.calls) {
      expect((args as { data: { publishedAt: unknown } }).data.publishedAt).toBeInstanceOf(Date);
    }
  });

  it('publishes before marking, so a crash between the two retries rather than loses', async () => {
    const order: string[] = [];
    const { drainer, prisma, bus } = build([pending[0] as (typeof pending)[number]]);
    bus.publish.mockImplementation(async () => { order.push('publish'); return { eventId: 'x' }; });
    prisma.outboxEvent.update.mockImplementation(async () => { order.push('mark'); return {}; });
    await drainer.drain();
    expect(order).toEqual(['publish', 'mark']);
  });

  /**
   * Names the row, rather than counting updates. Counting alone passes for a
   * drainer that marks the row that *failed* and skips the one that succeeded
   * — the exact inversion that would silently drop an event.
   */
  it('leaves the failed row unpublished and marks only the one that succeeded', async () => {
    const { drainer, prisma, bus } = build();
    bus.publish.mockRejectedValueOnce(new Error('nats down'));
    await drainer.drain();
    expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'e-2' },
      data: { publishedAt: expect.any(Date) },
    });
  });

  it('keeps draining the rest of the batch after one row fails', async () => {
    const { drainer, bus } = build();
    bus.publish.mockRejectedValueOnce(new Error('nats down'));
    await drainer.drain();
    expect(bus.publish).toHaveBeenCalledTimes(2);
  });

  it('selects only unpublished rows, oldest first', async () => {
    const { drainer, prisma } = build();
    await drainer.drain();
    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('does nothing when there is nothing pending', async () => {
    const { drainer, bus } = build([]);
    await drainer.drain();
    expect(bus.publish).not.toHaveBeenCalled();
  });
});
