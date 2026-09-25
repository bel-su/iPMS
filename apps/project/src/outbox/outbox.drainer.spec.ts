import { describe, expect, it, vi } from 'vitest';
import { OutboxDrainer } from './outbox.drainer.js';

const row = (id: string) => ({
  id, subject: 'audit.event.recorded', payload: { action: 'project.created' },
  correlationId: 'c-1', actorId: null, createdAt: new Date(), publishedAt: null as Date | null,
});

function fakePrisma(rows: Array<ReturnType<typeof row>>) {
  return {
    outboxEvent: {
      async findMany() { return rows.filter((r) => r.publishedAt === null); },
      async update({ where, data }: { where: { id: string }; data: { publishedAt: Date } }) {
        const found = rows.find((r) => r.id === where.id);
        if (found) found.publishedAt = data.publishedAt;
        return found;
      },
    },
  };
}

describe('OutboxDrainer', () => {
  it('publishes pending rows and marks them published', async () => {
    const rows = [row('r-1'), row('r-2')];
    const bus = { publish: vi.fn().mockResolvedValue(undefined) };
    await new OutboxDrainer(fakePrisma(rows) as never, bus as never).drain();
    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect(rows.every((r) => r.publishedAt !== null)).toBe(true);
  });

  it('leaves a row pending when the publish fails', async () => {
    // publishedAt stays null so the next poll retries. Marking it published
    // regardless would silently drop an audit record -- the one thing the ledger
    // must never do.
    const rows = [row('r-1')];
    const bus = { publish: vi.fn().mockRejectedValue(new Error('NATS down')) };
    await new OutboxDrainer(fakePrisma(rows) as never, bus as never).drain();
    expect(rows[0]!.publishedAt).toBeNull();
  });

  it('keeps draining after one row fails', async () => {
    // A single poisoned row must not block every audit record behind it.
    const rows = [row('r-1'), row('r-2')];
    const bus = {
      publish: vi.fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue(undefined),
    };
    await new OutboxDrainer(fakePrisma(rows) as never, bus as never).drain();
    expect(rows[0]!.publishedAt).toBeNull();
    expect(rows[1]!.publishedAt).not.toBeNull();
  });

  it('publishes with the row id as the event id, so a retry deduplicates', async () => {
    const rows = [row('r-1')];
    const bus = { publish: vi.fn().mockResolvedValue(undefined) };
    await new OutboxDrainer(fakePrisma(rows) as never, bus as never).drain();
    expect(bus.publish).toHaveBeenCalledWith(
      'audit.event.recorded', { action: 'project.created' },
      expect.objectContaining({ eventId: 'r-1' }),
    );
  });

  it('omits actorId rather than sending null for a system-originated event', async () => {
    const rows = [row('r-1')];
    const bus = { publish: vi.fn().mockResolvedValue(undefined) };
    await new OutboxDrainer(fakePrisma(rows) as never, bus as never).drain();
    expect(bus.publish.mock.calls[0]![2]).not.toHaveProperty('actorId');
  });
});
