import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { AttachService } from '../attach/attach.service.js';
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

    expect(await new MediaDiscarder(prisma, minio.client).discard(row, row.uploadedBy, 'media.discarded')).toBe(true);

    expect(await minio.client.head(`k/${id}.jpg`)).toBeNull();
    expect(await minio.client.head(`k/${id}.thumb.webp`)).toBeNull();
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'DISCARDED' });
    const audit = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'audit.event.recorded' } });
    expect(audit.payload).toMatchObject({ action: 'media.discarded', objectType: 'MediaObject', objectId: id, newState: { status: 'DISCARDED' } });
  });

  it('races a discard against an attach of the same file: exactly one side wins, never both', async () => {
    const discarder = new MediaDiscarder(prisma, minio.client);
    const attach = new AttachService(prisma);
    const siteId = uuidv7();
    const workOrderId = uuidv7();

    for (let i = 0; i < 5; i++) {
      const id = uuidv7();
      await minio.client.put(`r/${id}.jpg`, Buffer.from('x'), 'image/jpeg');
      const row = await prisma.mediaObject.create({ data: {
        id, kind: 'PHOTO', category: 'EVIDENCE', contentType: 'image/jpeg', sizeBytes: 1, contentHash: 'a'.repeat(64),
        storageKey: `r/${id}.jpg`, uploadedBy: uuidv7(), status: 'READY', siteId, workOrderId,
      } });
      const submissionId = uuidv7();

      const [discardResult, attachResult] = await Promise.allSettled([
        discarder.discard(row, row.uploadedBy, 'media.discarded'),
        attach.attach({ submissionId, workOrderId, siteId, mediaIds: [id] }),
      ]);

      const final = await prisma.mediaObject.findUniqueOrThrow({ where: { id } });
      const objectStillThere = await minio.client.head(`r/${id}.jpg`);

      if (final.status === 'ATTACHED') {
        // Attach won: discard must have lost (returned false, or the
        // discarder never got the chance to touch storage), and the object
        // must still be in storage.
        expect(attachResult.status).toBe('fulfilled');
        expect(discardResult.status === 'fulfilled' ? discardResult.value : false).toBe(false);
        expect(objectStillThere).not.toBeNull();
      } else {
        // Discard won: the row is DISCARDED, the attach must have been
        // refused, and the object must be gone from storage.
        expect(final.status).toBe('DISCARDED');
        expect(discardResult.status === 'fulfilled' ? discardResult.value : false).toBe(true);
        expect(attachResult.status).toBe('rejected');
        expect(objectStillThere).toBeNull();
      }
    }
  });
});
