import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { VerifyWorker, backoffSeconds } from './verify.worker.js';

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
    const row = await queued(await jpeg());
    await minio.client.delete([row.storageKey]); // storage "loses" it: GetObject fails
    await worker.runOnce();
    const retried = await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } });
    expect(retried).toMatchObject({ status: 'VERIFYING', verifyAttempts: 1 });
    expect(retried.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 25_000);

    await prisma.mediaObject.update({ where: { id: row.id }, data: { verifyAttempts: 4, nextAttemptAt: new Date(Date.now() - 1000) } });
    await worker.runOnce();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'VERIFYING', verifyAttempts: 5, nextAttemptAt: null });
  });

  it('backs off 30 s, 60 s, 120 s … capped at an hour', () => {
    expect([1, 2, 3, 8, 20].map(backoffSeconds)).toEqual([30, 60, 120, 3600, 3600]);
  });
});
