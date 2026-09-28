import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { AttachService } from '../attach/attach.service.js';
import { ViewService } from './view.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
let views: ViewService;
let attach: AttachService;
beforeAll(async () => {
  [db, minio] = await Promise.all([startTestDb(), startMinio()]);
  prisma = db.prisma;
  views = new ViewService(prisma, minio.client);
  attach = new AttachService(prisma);
});
afterAll(async () => { await db?.stop(); await minio?.stop(); });
beforeEach(async () => { await prisma.mediaObject.deleteMany({}); });

const PROJECT = uuidv7();
const SITE = uuidv7();
const WORK_ORDER = uuidv7();
const IN_SCOPE: AuthzScope = { global: false, projectIds: [PROJECT], siteIds: [] };
const OUT_OF_SCOPE: AuthzScope = { global: false, projectIds: [uuidv7()], siteIds: [] };

async function media(status: string, patch: Record<string, unknown> = {}) {
  const id = uuidv7();
  await minio.client.put(`m/${id}.jpg`, Buffer.from('jpeg'), 'image/jpeg');
  await minio.client.put(`m/${id}.thumb.webp`, Buffer.from('webp'), 'image/webp');
  return prisma.mediaObject.create({ data: {
    id, kind: 'PHOTO', category: 'EVIDENCE', contentType: 'image/jpeg', sizeBytes: 4, contentHash: 'a'.repeat(64),
    storageKey: `m/${id}.jpg`, thumbnailKey: `m/${id}.thumb.webp`, uploadedBy: uuidv7(), status,
    projectId: PROJECT, siteId: SITE, siteCode: 'KOS121', workOrderId: WORK_ORDER,
    capturedAt: new Date('2026-09-28T08:00:00Z'), latitude: 26.4525, longitude: 87.2718, distanceFromSiteM: 12, ...patch,
  } });
}

describe('ViewService', () => {
  it('signs a 5-minute link with a readable name for anyone in scope', async () => {
    const row = await media('READY');
    const signed = await views.url(row.id, 'original', IN_SCOPE);
    const response = await fetch(signed.signedUrl);
    expect(await response.text()).toBe('jpeg');
    expect(response.headers.get('content-disposition')).toContain('KOS121_20260928-080000');
    expect(new Date(signed.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
  });

  it('hides media outside the caller’s scope as not found', async () => {
    const row = await media('READY');
    await expect(views.url(row.id, 'original', OUT_OF_SCOPE)).rejects.toMatchObject({ status: 404 });
  });

  it('serves only verified, stored files', async () => {
    for (const status of ['PENDING', 'VERIFYING', 'REJECTED', 'DISCARDED', 'PURGED']) {
      const row = await media(status);
      await expect(views.url(row.id, 'original', IN_SCOPE)).rejects.toMatchObject({ status: 409 });
    }
  });

  it('lists a work order’s evidence with thumbnails, leaving out discarded files', async () => {
    const ready = await media('READY');
    const pending = await media('PENDING');
    await media('DISCARDED');
    const list = await views.listForWorkOrder(WORK_ORDER, IN_SCOPE);
    expect(list.map((m) => m.id).sort()).toEqual([ready.id, pending.id].sort());
    expect(list.find((m) => m.id === ready.id)).toMatchObject({ distanceFromSiteM: 12, latitude: 26.4525, capturedAt: '2026-09-28T08:00:00.000Z' });
    expect(list.find((m) => m.id === ready.id)!.thumbnailUrl).toContain('X-Amz-Signature');
    expect(list.find((m) => m.id === pending.id)!.thumbnailUrl).toBeNull();
    expect(await views.listForWorkOrder(WORK_ORDER, OUT_OF_SCOPE)).toEqual([]);
  });
});

describe('AttachService', () => {
  const SUBMISSION = uuidv7();

  it('attaches READY files on the submission’s site and returns their capture facts', async () => {
    const a = await media('READY');
    const b = await media('READY');
    const out = await attach.attach({ submissionId: SUBMISSION, siteId: SITE, mediaIds: [b.id, a.id] });
    expect(out.map((m) => m.id)).toEqual([b.id, a.id]);
    expect(out[0]).toMatchObject({ contentHash: 'a'.repeat(64), distanceFromSiteM: 12, kind: 'PHOTO' });
    expect(await prisma.mediaObject.count({ where: { status: 'ATTACHED', attachedToSubmissionId: SUBMISSION } })).toBe(2);
    // Repeat for the same submission is harmless.
    expect((await attach.attach({ submissionId: SUBMISSION, siteId: SITE, mediaIds: [a.id] })).map((m) => m.id)).toEqual([a.id]);
  });

  it('changes nothing when any file is missing, unverified, on another site or already in another submission', async () => {
    const good = await media('READY');
    const cases = [
      [uuidv7()],
      [(await media('VERIFYING')).id],
      [(await media('READY', { siteId: uuidv7() })).id],
      [(await media('ATTACHED', { attachedToSubmissionId: uuidv7() })).id],
    ];
    for (const extra of cases) {
      await expect(attach.attach({ submissionId: SUBMISSION, siteId: SITE, mediaIds: [good.id, ...extra] })).rejects.toMatchObject({ status: 409 });
    }
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: good.id } })).status).toBe('READY');
  });
});
