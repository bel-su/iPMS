import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { MediaDiscarder } from './discarder.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
beforeAll(async () => { [db, minio] = await Promise.all([startTestDb(), startMinio()]); prisma = db.prisma; });
afterAll(async () => { await db?.stop(); await minio?.stop(); });

describe('MediaDiscarder', () => {
  it('deletes the object and its thumbnail, keeps a tombstone, and audits', async () => {
    const id = uuidv7();
    await minio.client.put(`k/${id}.jpg`, Buffer.from('x'), 'image/jpeg');
    await minio.client.put(`k/${id}.thumb.webp`, Buffer.from('y'), 'image/webp');
    const row = await prisma.mediaObject.create({ data: {
      id, kind: 'PHOTO', category: 'EVIDENCE', contentType: 'image/jpeg', sizeBytes: 1, contentHash: 'a'.repeat(64),
      storageKey: `k/${id}.jpg`, thumbnailKey: `k/${id}.thumb.webp`, uploadedBy: uuidv7(), status: 'READY',
    } });

    await new MediaDiscarder(prisma, minio.client).discard(row, row.uploadedBy, 'media.discarded');

    expect(await minio.client.head(`k/${id}.jpg`)).toBeNull();
    expect(await minio.client.head(`k/${id}.thumb.webp`)).toBeNull();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'DISCARDED' });
    const audit = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'audit.event.recorded' } });
    expect(audit.payload).toMatchObject({ action: 'media.discarded', objectType: 'MediaObject', objectId: id, newState: { status: 'DISCARDED' } });
  });
});
