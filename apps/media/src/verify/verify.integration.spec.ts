import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { MAX_VERIFY_ATTEMPTS, VerifyWorker, backoffSeconds, log } from './verify.worker.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
let worker: VerifyWorker;
beforeAll(async () => {
  [db, minio] = await Promise.all([startTestDb(), startMinio()]);
  prisma = db.prisma;
  worker = new VerifyWorker(prisma, minio.client);
});
afterAll(async () => { await db?.stop(); await minio?.stop(); });
beforeEach(async () => { await prisma.mediaObject.deleteMany({}); await prisma.outboxEvent.deleteMany({}); });

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const jpeg = () => sharp({ create: { width: 1200, height: 900, channels: 3, background: '#3a6' } }).jpeg({ quality: 80 }).toBuffer();

async function queued(body: Buffer, patch: { kind?: 'PHOTO' | 'VIDEO'; contentType?: string; contentHash?: string; sizeBytes?: number } = {}) {
  const id = uuidv7();
  const kind = patch.kind ?? 'PHOTO';
  const storageKey = `v/${id}.${kind === 'PHOTO' ? 'jpg' : 'mp4'}`;
  const thumbnailKey = `v/${id}.${kind === 'PHOTO' ? 'thumb.webp' : 'poster.jpg'}`;
  await minio.client.put(storageKey, body, patch.contentType ?? 'image/jpeg');
  return prisma.mediaObject.create({ data: {
    id, kind, category: 'EVIDENCE', contentType: patch.contentType ?? 'image/jpeg', sizeBytes: patch.sizeBytes ?? body.length,
    contentHash: patch.contentHash ?? sha(body), storageKey, thumbnailKey, uploadedBy: uuidv7(),
    status: 'VERIFYING', nextAttemptAt: new Date(Date.now() - 1000),
  } });
}

describe('VerifyWorker', () => {
  it('verifies a photo, writes a 400 px WebP thumbnail and marks it READY', async () => {
    const row = await queued(await jpeg());
    expect(await worker.runOnce()).toBe(1);
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'READY', hashVerified: true, nextAttemptAt: null });
    const chunks: Buffer[] = [];
    for await (const c of await minio.client.getStream(row.thumbnailKey!)) chunks.push(c as Buffer);
    const meta = await sharp(Buffer.concat(chunks)).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width!, meta.height!)).toBe(400);
  });

  it('rejects bytes that do not match the phone’s hash, and audits it', async () => {
    const row = await queued(await jpeg(), { contentHash: 'c'.repeat(64) });
    await worker.runOnce();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'REJECTED', rejectReason: 'HASH_MISMATCH' });
    const audit = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'audit.event.recorded' } });
    expect(audit.payload).toMatchObject({ action: 'media.rejected', objectId: row.id, actorId: null });
  });

  it('rejects a file that is not what it claims to be', async () => {
    const row = await queued(Buffer.from('<html>not a photo</html>'));
    await worker.runOnce();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'REJECTED', rejectReason: 'TYPE_MISMATCH' });
  });

  it('rejects a video whose poster never arrived, and accepts one whose poster did', async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), randomBytes(4000)]);
    const missing = await queued(mp4, { kind: 'VIDEO', contentType: 'video/mp4' });
    const present = await queued(mp4, { kind: 'VIDEO', contentType: 'video/mp4' });
    await minio.client.put(present.thumbnailKey!, await jpeg(), 'image/jpeg');
    await worker.runOnce();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: missing.id } })).toMatchObject({ status: 'REJECTED', rejectReason: 'POSTER_MISSING' });
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: present.id } })).toMatchObject({ status: 'READY' });
  });

  it('retries a transient failure with backoff, and parks it for an operator after 5 attempts', async () => {
    // Silences only this test's expected NoSuchKey warn/error lines — the
    // failure itself is the point of the test, not something to fix.
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => log);
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => log);
    try {
      const row = await queued(await jpeg());
      await minio.client.delete([row.storageKey]); // storage "loses" it: GetObject fails
      await worker.runOnce();
      const retried = await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } });
      expect(retried).toMatchObject({ status: 'VERIFYING', verifyAttempts: 1 });
      expect(retried.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 25_000);

      await prisma.mediaObject.update({ where: { id: row.id }, data: { verifyAttempts: 4, nextAttemptAt: new Date(Date.now() - 1000) } });
      await worker.runOnce();
      expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'VERIFYING', verifyAttempts: 5, nextAttemptAt: null });
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('backs off 30 s, 60 s, 120 s … capped at an hour', () => {
    expect([1, 2, 3, 8, 20].map(backoffSeconds)).toEqual([30, 60, 120, 3600, 3600]);
  });

  it('does not resurrect a photo discarded mid-verify, and removes the orphaned thumbnail', async () => {
    const row = await queued(await jpeg());
    const originalPut = minio.client.put.bind(minio.client);
    const putSpy = vi.spyOn(minio.client, 'put').mockImplementationOnce(async (key, body, contentType) => {
      // The uploader discards the row (MediaDiscarder) after the worker has
      // already decided to write the thumbnail, but before settle() commits.
      await prisma.mediaObject.update({ where: { id: row.id }, data: { status: 'DISCARDED', discardedAt: new Date() } });
      return originalPut(key, body, contentType);
    });
    try {
      expect(await worker.runOnce()).toBe(1);
    } finally {
      putSpy.mockRestore();
    }

    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'DISCARDED' });
    const audits = await prisma.outboxEvent.findMany({ where: { subject: 'audit.event.recorded' } });
    expect(audits.some((a) => (a.payload as { objectId?: string }).objectId === row.id)).toBe(false);
    expect(await minio.client.head(row.thumbnailKey!)).toBeNull();
  });

  it('does not resurrect a row rejected-then-discarded mid-verify, and writes no audit', async () => {
    const row = await queued(await jpeg(), { contentHash: 'c'.repeat(64) });
    const originalGetStream = minio.client.getStream.bind(minio.client);
    const getStreamSpy = vi.spyOn(minio.client, 'getStream').mockImplementationOnce(async (key) => {
      await prisma.mediaObject.update({ where: { id: row.id }, data: { status: 'DISCARDED', discardedAt: new Date() } });
      return originalGetStream(key);
    });
    try {
      expect(await worker.runOnce()).toBe(1);
    } finally {
      getStreamSpy.mockRestore();
    }

    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'DISCARDED' });
    const audits = await prisma.outboxEvent.findMany({ where: { subject: 'audit.event.recorded' } });
    expect(audits.some((a) => (a.payload as { objectId?: string }).objectId === row.id)).toBe(false);
  });

  it('does not delete a live thumbnail when another worker already settled the row READY first', async () => {
    const row = await queued(await jpeg());
    const originalPut = minio.client.put.bind(minio.client);
    const putSpy = vi.spyOn(minio.client, 'put').mockImplementationOnce(async (key, body, contentType) => {
      // A second worker's pass raced ahead and settled the row READY (e.g.
      // this worker's lease had expired) before this put/settle completed.
      // The thumbnail that lands here is the one a live READY row now points
      // to — it must survive.
      await prisma.mediaObject.update({ where: { id: row.id }, data: { status: 'READY', hashVerified: true, nextAttemptAt: null } });
      return originalPut(key, body, contentType);
    });
    try {
      expect(await worker.runOnce()).toBe(1);
    } finally {
      putSpy.mockRestore();
    }

    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'READY' });
    expect(await minio.client.head(row.thumbnailKey!)).not.toBeNull();
  });

  it('parks a row that kept crashing verification instead of leasing it forever', async () => {
    // Silences the expected "retries exhausted" error line this test triggers
    // on purpose — same reasoning as the retry/backoff test above.
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => log);
    const row = await queued(await jpeg());
    await prisma.mediaObject.update({ where: { id: row.id }, data: { verifyAttempts: MAX_VERIFY_ATTEMPTS, nextAttemptAt: new Date(Date.now() - 1000) } });
    const getStreamSpy = vi.spyOn(minio.client, 'getStream');
    try {
      expect(await worker.runOnce()).toBe(0);
    } finally {
      getStreamSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'VERIFYING', verifyAttempts: MAX_VERIFY_ATTEMPTS, nextAttemptAt: null,
    });
    expect(getStreamSpy).not.toHaveBeenCalled();
  });
});
