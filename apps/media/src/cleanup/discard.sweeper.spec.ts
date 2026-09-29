import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import type { MediaDiscarder } from '../media/discarder.js';
import { DiscardSweeper } from './discard.sweeper.js';

function row(id: string): MediaObject {
  return { id } as unknown as MediaObject;
}

function fakePrisma(batches: MediaObject[][]): PrismaClient {
  let call = 0;
  return {
    mediaObject: {
      findMany: vi.fn(async () => batches[Math.min(call++, batches.length - 1)] ?? []),
    },
  } as unknown as PrismaClient;
}

describe('DiscardSweeper.sweep', () => {
  it('keeps pulling full batches while they discard something, and totals across them', async () => {
    const batchSize = 2;
    const batches = [[row('a'), row('b')], [row('c'), row('d')], [row('e')]];
    const prisma = fakePrisma(batches);
    const discarder = { discard: vi.fn(async () => true) } as unknown as MediaDiscarder;
    const sweeper = new DiscardSweeper(prisma, discarder, batchSize);

    const total = await sweeper.sweep();

    expect(total).toBe(5);
    expect((prisma.mediaObject.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  });

  it('stops the pass, without looping forever, when a full batch discards nothing', async () => {
    const batchSize = 2;
    // A batch that comes back full every time (findMany doesn't filter out
    // failed rows), but every discard fails.
    const prisma = fakePrisma([[row('a'), row('b')]]);
    const discarder = { discard: vi.fn(async () => false) } as unknown as MediaDiscarder;
    const sweeper = new DiscardSweeper(prisma, discarder, batchSize);

    const total = await sweeper.sweep();

    expect(total).toBe(0);
    expect((prisma.mediaObject.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('stops after a partial (non-full) batch even if it discarded something', async () => {
    const batchSize = 100;
    const prisma = fakePrisma([[row('a')]]);
    const discarder = { discard: vi.fn(async () => true) } as unknown as MediaDiscarder;
    const sweeper = new DiscardSweeper(prisma, discarder, batchSize);

    expect(await sweeper.sweep()).toBe(1);
    expect((prisma.mediaObject.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});

describe('DiscardSweeper timers', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs a first sweep about a minute after init, and keeps sweeping hourly after that', async () => {
    const prisma = fakePrisma([[]]);
    const discarder = { discard: vi.fn(async () => true) } as unknown as MediaDiscarder;
    const sweeper = new DiscardSweeper(prisma, discarder);

    sweeper.onModuleInit();
    expect(prisma.mediaObject.findMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(prisma.mediaObject.findMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(prisma.mediaObject.findMany).toHaveBeenCalledTimes(2);

    sweeper.onModuleDestroy();
  });

  it('cancels both the initial and the hourly timer on destroy', async () => {
    const prisma = fakePrisma([[]]);
    const discarder = { discard: vi.fn(async () => true) } as unknown as MediaDiscarder;
    const sweeper = new DiscardSweeper(prisma, discarder);

    sweeper.onModuleInit();
    sweeper.onModuleDestroy();

    await vi.advanceTimersByTimeAsync(4_000_000);
    expect(prisma.mediaObject.findMany).not.toHaveBeenCalled();
  });
});
