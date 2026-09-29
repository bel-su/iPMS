import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import type { EventBus } from '@ipms/events';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { MediaDiscarder } from '../media/discarder.js';
import { DiscardSweeper, log } from './discard.sweeper.js';
import { WorkOrderCancelledConsumer } from './work-order-cancelled.consumer.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
let consumer: WorkOrderCancelledConsumer;
let discarder: MediaDiscarder;
let sweeper: DiscardSweeper;
beforeAll(async () => {
  [db, minio] = await Promise.all([startTestDb(), startMinio()]);
  prisma = db.prisma;
  consumer = new WorkOrderCancelledConsumer(prisma, {} as EventBus); // handle() is exercised directly
  discarder = new MediaDiscarder(prisma, minio.client);
  sweeper = new DiscardSweeper(prisma, discarder);
});
afterAll(async () => { await db?.stop(); await minio?.stop(); });
beforeEach(async () => { await prisma.mediaObject.deleteMany({}); });

const WORK_ORDER = uuidv7();
const DAY = 86_400_000;

async function media(status: string, workOrderId = WORK_ORDER) {
  const id = uuidv7();
  await minio.client.put(`c/${id}.jpg`, Buffer.from('x'), 'image/jpeg');
  return prisma.mediaObject.create({ data: {
    id, kind: 'PHOTO', category: 'EVIDENCE', contentType: 'image/jpeg', sizeBytes: 1, contentHash: 'a'.repeat(64),
    storageKey: `c/${id}.jpg`, uploadedBy: uuidv7(), status, workOrderId,
  } });
}

describe('cancelled work orders', () => {
  it('schedules unsubmitted evidence for 30 days after cancellation, leaving attached evidence and other work orders alone', async () => {
    const ready = await media('READY');
    const pending = await media('PENDING');
    const attached = await media('ATTACHED');
    const elsewhere = await media('READY', uuidv7());
    const cancelledAt = new Date('2026-09-01T00:00:00Z');

    expect(await consumer.handle({ workOrderId: WORK_ORDER, projectId: uuidv7(), siteId: uuidv7(), cancelledAt: cancelledAt.toISOString() })).toBe(2);
    for (const row of [ready, pending]) {
      expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).discardAfter).toEqual(new Date(cancelledAt.getTime() + 30 * DAY));
    }
    for (const row of [attached, elsewhere]) {
      expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).discardAfter).toBeNull();
    }
    // Redelivery changes nothing.
    expect(await consumer.handle({ workOrderId: WORK_ORDER, projectId: uuidv7(), siteId: uuidv7(), cancelledAt: new Date().toISOString() })).toBe(0);
  });

  it('discards only once the grace period has passed, and never evidence attached meanwhile', async () => {
    const early = await media('READY');
    const due = await media('READY');
    const attachedSince = await media('ATTACHED');
    const now = new Date();
    await prisma.mediaObject.update({ where: { id: early.id }, data: { discardAfter: new Date(now.getTime() + DAY) } });
    await prisma.mediaObject.updateMany({ where: { id: { in: [due.id, attachedSince.id] } }, data: { discardAfter: new Date(now.getTime() - DAY) } });

    expect(await sweeper.sweep(now)).toBe(1);
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: due.id } })).status).toBe('DISCARDED');
    expect(await minio.client.head(due.storageKey)).toBeNull();
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: early.id } })).status).toBe('READY');
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: attachedSince.id } })).status).toBe('ATTACHED');
  });

  it('does not count a row whose claim was lost to a concurrent attach', async () => {
    const lost = await media('READY');
    const now = new Date();
    await prisma.mediaObject.update({ where: { id: lost.id }, data: { discardAfter: new Date(now.getTime() - DAY) } });

    // The row passes the sweeper's own query (still READY when selected), but
    // is attached — by some other request — in the moment before the
    // discarder's claim runs. Simulate that race by mutating the row inside
    // a wrapped discard() call, then delegating to the real implementation,
    // whose conditional claim then matches zero rows.
    const real = discarder.discard.bind(discarder);
    const discardSpy = vi.spyOn(discarder, 'discard').mockImplementationOnce(async (row: MediaObject, actorId, action) => {
      await prisma.mediaObject.update({ where: { id: row.id }, data: { status: 'ATTACHED' } });
      return real(row, actorId, action);
    });

    try {
      expect(await sweeper.sweep(now)).toBe(0);
    } finally {
      discardSpy.mockRestore();
    }
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: lost.id } })).status).toBe('ATTACHED');
    expect(await minio.client.head(lost.storageKey)).not.toBeNull();
  });

  it('keeps sweeping the rest of the batch when one row fails to discard', async () => {
    const failing = await media('READY');
    const due = await media('READY');
    const now = new Date();
    await prisma.mediaObject.updateMany({
      where: { id: { in: [failing.id, due.id] } },
      data: { discardAfter: new Date(now.getTime() - DAY) },
    });

    // Silences the expected "discard failed" error line this test triggers on
    // purpose — same reasoning as verify.worker.spec's crash-handling tests.
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => log);
    // Target `failing` by id rather than call order — sweep()'s findMany has
    // no orderBy, so which of the two due rows is visited first is not
    // guaranteed.
    const real = discarder.discard.bind(discarder);
    const discardSpy = vi.spyOn(discarder, 'discard').mockImplementation(async (row: MediaObject, actorId, action) => {
      if (row.id === failing.id) throw new Error('storage unavailable');
      return real(row, actorId, action);
    });

    let count: number;
    try {
      count = await sweeper.sweep(now);
      expect(count).toBe(1);
      expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: due.id } })).status).toBe('DISCARDED');
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ mediaId: failing.id }), expect.any(String));
    } finally {
      discardSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
