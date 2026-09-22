import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import type { EventBus } from '@ipms/events';
import { OutboxDrainer } from './outbox.drainer.js';

const row = { id: 'e-1', subject: 'audit.event.recorded', payload: { action: 'x' }, correlationId: 'c-1', actorId: 'u-1' };

function setup(publish: () => Promise<void>) {
  const prisma = { outboxEvent: { findMany: vi.fn().mockResolvedValue([row]), update: vi.fn() } };
  const bus = { publish: vi.fn(publish) };
  return { prisma, bus, drainer: new OutboxDrainer(prisma as unknown as PrismaClient, bus as unknown as EventBus) };
}

describe('OutboxDrainer.drain', () => {
  it('publishes pending rows with their event id and marks them published', async () => {
    const { prisma, bus, drainer } = setup(async () => {});
    await drainer.drain();
    expect(bus.publish).toHaveBeenCalledWith('audit.event.recorded', { action: 'x' }, { correlationId: 'c-1', eventId: 'e-1', actorId: 'u-1' });
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({ where: { id: 'e-1' }, data: { publishedAt: expect.any(Date) } });
  });

  it('leaves a row pending when publishing fails, so the next poll retries', async () => {
    const { prisma, drainer } = setup(async () => { throw new Error('nats down'); });
    await drainer.drain();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
  });
});
