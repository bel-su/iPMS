import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import { MIB, PART_SIZE_BYTES, uuidv7, type RegisterUploadDto, type UploadInstructions } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { startMinio } from '../testing/minio.js';
import { MediaDiscarder } from '../media/discarder.js';
import type { Lookup } from '../directory/lookup.js';
import type { WorkOrderRef } from '../directory/qc.client.js';
import { UploadService } from './upload.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let minio: Awaited<ReturnType<typeof startMinio>>;
let prisma: PrismaClient;
let service: UploadService;

const ENGINEER = uuidv7();
const OTHER = uuidv7();
const PROJECT = uuidv7();
const SITE = uuidv7();
const WORK_ORDER = uuidv7();
let workOrder: Lookup<WorkOrderRef>;

beforeAll(async () => {
  [db, minio] = await Promise.all([startTestDb(), startMinio()]);
  prisma = db.prisma;
  const qc = { workOrder: async () => workOrder };
  const project = {
    geofence: async () => ({ latitude: 26.4525, longitude: 87.2718, effectiveRadiusM: 100 }),
    scope: async () => ({ state: 'found' as const, value: { global: true, projectIds: [], siteIds: [] } }),
  };
  service = new UploadService(prisma, minio.client, qc, project, new MediaDiscarder(prisma, minio.client));
});
afterAll(async () => { await db?.stop(); await minio?.stop(); });
beforeEach(async () => {
  await prisma.mediaObject.deleteMany({});
  workOrder = { state: 'found', value: { id: WORK_ORDER, projectId: PROJECT, siteId: SITE, siteCode: 'KOS121', status: 'ONGOING' } };
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function photo(body: Buffer, patch: Partial<RegisterUploadDto> = {}): RegisterUploadDto {
  return {
    id: uuidv7(), category: 'EVIDENCE', workOrderId: WORK_ORDER, checklistItemId: uuidv7(), kind: 'PHOTO',
    contentType: 'image/jpeg', sizeBytes: body.length, contentHash: sha(body), capturedAt: new Date('2026-09-28T08:00:00Z'),
    latitude: 26.4525, longitude: 87.2718, deviceId: 'RMX3630', ...patch,
  };
}
async function send(upload: UploadInstructions, body: Buffer): Promise<void> {
  if (upload.mode !== 'single') throw new Error('expected a single PUT');
  expect((await fetch(upload.signedUrl, { method: 'PUT', body, headers: upload.headers })).status).toBe(200);
}

describe('registering', () => {
  it('files a photo under its work order’s project and site, with distance, and returns a single PUT', async () => {
    const body = randomBytes(2000);
    const dto = photo(body);
    const out = await service.register(dto, ENGINEER, 'Bearer t');
    expect(out).toMatchObject({ id: dto.id, status: 'PENDING', upload: { mode: 'single' }, posterUpload: null });
    expect(await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } })).toMatchObject({
      projectId: PROJECT, siteId: SITE, siteCode: 'KOS121', workOrderId: WORK_ORDER, distanceFromSiteM: 0,
      storageKey: `projects/${PROJECT}/sites/${SITE}/evidence/${dto.id}.jpg`,
    });
  });

  it('is repeat-safe: the same id and hash return fresh URLs for the same row', async () => {
    const dto = photo(randomBytes(10));
    await service.register(dto, ENGINEER, 'Bearer t');
    const again = await service.register(dto, ENGINEER, 'Bearer t');
    expect(again.status).toBe('PENDING');
    expect(await prisma.mediaObject.count()).toBe(1);
  });

  it('refuses the same id with different bytes, or from another user', async () => {
    const dto = photo(randomBytes(10));
    await service.register(dto, ENGINEER, 'Bearer t');
    await expect(service.register({ ...dto, contentHash: 'b'.repeat(64) }, ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 409 });
    await expect(service.register(dto, OTHER, 'Bearer t')).rejects.toMatchObject({ status: 409 });
  });

  it('enforces type and size limits', async () => {
    await expect(service.register(photo(randomBytes(10), { contentType: 'image/png' }), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 400 });
    await expect(service.register(photo(randomBytes(10), { sizeBytes: 5 * MIB + 1 }), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 413 });
  });

  it('refuses a closed work order, and passes through qc’s answer when it is out of reach', async () => {
    workOrder = { state: 'found', value: { id: WORK_ORDER, projectId: PROJECT, siteId: SITE, siteCode: 'KOS121', status: 'COMPLETED' } };
    await expect(service.register(photo(randomBytes(10)), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 422 });
    workOrder = { state: 'forbidden' };
    await expect(service.register(photo(randomBytes(10)), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 403 });
    workOrder = { state: 'unavailable' };
    await expect(service.register(photo(randomBytes(10)), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 503 });
  });

  it('caps an uploader at 500 pending files', async () => {
    await prisma.mediaObject.createMany({ data: Array.from({ length: 500 }, () => {
      const id = uuidv7();
      return { id, kind: 'PHOTO', category: 'EVIDENCE', contentType: 'image/jpeg', sizeBytes: 1, contentHash: 'a'.repeat(64), storageKey: `x/${id}`, uploadedBy: ENGINEER };
    }) });
    await expect(service.register(photo(randomBytes(10)), ENGINEER, 'Bearer t')).rejects.toMatchObject({ status: 429 });
  });
});

describe('uploading and completing', () => {
  it('moves a photo to VERIFYING once its bytes arrived, and says so again on repeat', async () => {
    const body = randomBytes(3000);
    const dto = photo(body);
    await expect(service.complete(dto.id, {}, ENGINEER)).rejects.toMatchObject({ status: 404 });
    const out = await service.register(dto, ENGINEER, 'Bearer t');
    await expect(service.complete(dto.id, {}, ENGINEER)).rejects.toMatchObject({ status: 412 });
    await send(out.upload!, body);
    expect(await service.complete(dto.id, {}, ENGINEER)).toEqual({ id: dto.id, status: 'VERIFYING' });
    expect(await service.complete(dto.id, {}, ENGINEER)).toEqual({ id: dto.id, status: 'VERIFYING' });
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    expect(row.receivedAt).not.toBeNull();
    expect(row.nextAttemptAt).not.toBeNull();
  });

  it('resumes a video: status reports stored parts, fresh part URLs, then completes', async () => {
    // 11 MiB is over the 10 MiB threshold, so it goes up in three 5 MiB parts.
    const video = randomBytes(11 * MIB);
    const dto = photo(video, { kind: 'VIDEO', contentType: 'video/mp4' });
    const out = await service.register(dto, ENGINEER, 'Bearer t');
    expect(out.upload).toMatchObject({ mode: 'multipart', partCount: 3, partSize: PART_SIZE_BYTES });
    expect(out.posterUpload).not.toBeNull();
    if (out.upload?.mode !== 'multipart') throw new Error('expected multipart');
    const partBody = (n: number) => video.subarray((n - 1) * PART_SIZE_BYTES, n * PART_SIZE_BYTES);

    // First part only, then the signal drops.
    await fetch(out.upload.parts[0]!.signedUrl, { method: 'PUT', body: partBody(1) });
    expect(await service.status([dto.id], ENGINEER)).toEqual([{ id: dto.id, status: 'PENDING', completedParts: [1] }]);

    // Hours later the old URLs have expired: ask for the missing parts only.
    const fresh = await service.parts(dto.id, [2, 3], ENGINEER);
    const etags: { partNumber: number; etag: string }[] = [];
    for (const part of fresh.parts) {
      const response = await fetch(part.signedUrl, { method: 'PUT', body: partBody(part.partNumber) });
      etags.push({ partNumber: part.partNumber, etag: response.headers.get('etag')! });
    }
    expect((await service.status([dto.id], ENGINEER))[0]!.completedParts).toEqual([1, 2, 3]);

    // The phone kept part 1's ETag from the first session; here we read it back from storage.
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    const first = (await minio.client.listParts(row.storageKey, row.multipartUploadId!))!.find((p) => p.partNumber === 1)!;
    expect(await service.complete(dto.id, { parts: [first, ...etags] }, ENGINEER)).toEqual({ id: dto.id, status: 'VERIFYING' });
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } })).multipartUploadId).toBeNull();
  });
});

describe('status and discard', () => {
  it('reports unknown ids, and only the caller’s own uploads', async () => {
    const dto = photo(randomBytes(10));
    await service.register(dto, ENGINEER, 'Bearer t');
    const unknown = uuidv7();
    expect(await service.status([dto.id, unknown], ENGINEER)).toEqual([
      { id: dto.id, status: 'PENDING' }, { id: unknown, status: 'UNKNOWN' },
    ]);
    expect(await service.status([dto.id], OTHER)).toEqual([{ id: dto.id, status: 'UNKNOWN' }]);
  });

  it('discards a retake for its uploader only, and never evidence already attached', async () => {
    const body = randomBytes(10);
    const dto = photo(body);
    const out = await service.register(dto, ENGINEER, 'Bearer t');
    await send(out.upload!, body);
    await expect(service.discard(dto.id, OTHER)).rejects.toMatchObject({ status: 403 });
    expect(await service.discard(dto.id, ENGINEER)).toEqual({ id: dto.id, status: 'DISCARDED' });
    expect(await service.discard(dto.id, ENGINEER)).toEqual({ id: dto.id, status: 'DISCARDED' });

    const kept = photo(randomBytes(10));
    await service.register(kept, ENGINEER, 'Bearer t');
    await prisma.mediaObject.update({ where: { id: kept.id }, data: { status: 'ATTACHED' } });
    await expect(service.discard(kept.id, ENGINEER)).rejects.toMatchObject({ status: 409 });
  });
});

describe('repeat-safety when storage and the row disagree', () => {
  async function registeredVideo() {
    const video = randomBytes(11 * MIB);
    const dto = photo(video, { kind: 'VIDEO', contentType: 'video/mp4' });
    const out = await service.register(dto, ENGINEER, 'Bearer t');
    if (out.upload?.mode !== 'multipart') throw new Error('expected multipart');
    return { dto, video, out, upload: out.upload };
  }
  const partBody = (video: Buffer, n: number) => video.subarray((n - 1) * PART_SIZE_BYTES, n * PART_SIZE_BYTES);

  it('treats a completion storage already finished, but the row never recorded, as success — repeatably', async () => {
    const { dto, video, upload } = await registeredVideo();
    for (const part of upload.parts) {
      await fetch(part.signedUrl, { method: 'PUT', body: partBody(video, part.partNumber) });
    }
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    const stored = (await minio.client.listParts(row.storageKey, upload.uploadId))!;
    // Storage finishes the upload directly, as if the server had crashed right after telling it to.
    expect(await minio.client.completeMultipart(row.storageKey, upload.uploadId, stored)).toBe('completed');
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } })).status).toBe('PENDING');

    expect(await service.complete(dto.id, { parts: stored }, ENGINEER)).toEqual({ id: dto.id, status: 'VERIFYING' });
    expect(await service.complete(dto.id, { parts: stored }, ENGINEER)).toEqual({ id: dto.id, status: 'VERIFYING' });
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } })).multipartUploadId).toBeNull();
  });

  it('resolves the same mismatch when discovered through register’s resume path, without opening a new upload', async () => {
    const { dto, video, upload } = await registeredVideo();
    for (const part of upload.parts) {
      await fetch(part.signedUrl, { method: 'PUT', body: partBody(video, part.partNumber) });
    }
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    const stored = (await minio.client.listParts(row.storageKey, upload.uploadId))!;
    await minio.client.completeMultipart(row.storageKey, upload.uploadId, stored);

    const again = await service.register(dto, ENGINEER, 'Bearer t');
    expect(again).toMatchObject({ id: dto.id, status: 'VERIFYING', upload: null, posterUpload: null });
    const after = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    expect(after.status).toBe('VERIFYING');
    expect(after.multipartUploadId).toBeNull();
  });

  it('reports 412 and deletes the object when its stored size does not match what was registered', async () => {
    const { dto, video, upload } = await registeredVideo();
    for (const part of upload.parts) {
      await fetch(part.signedUrl, { method: 'PUT', body: partBody(video, part.partNumber) });
    }
    // Simulate the row's declared size disagreeing with what storage actually
    // ends up holding (a bug, or a race between two registrations) — the
    // parts themselves are exactly what was signed, so completion succeeds,
    // but the final object is not the size the row promises.
    await prisma.mediaObject.update({ where: { id: dto.id }, data: { sizeBytes: video.length + 1000 } });
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    const stored = (await minio.client.listParts(row.storageKey, upload.uploadId))!;

    await expect(service.complete(dto.id, { parts: stored }, ENGINEER)).rejects.toMatchObject({ status: 412 });
    expect(await minio.client.head(row.storageKey)).toBeNull();
    expect((await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } })).status).toBe('PENDING');
  });

  it('reports 412 when the upload was aborted and no object ever landed in storage', async () => {
    const { dto, upload } = await registeredVideo();
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    await minio.client.abortMultipart(row.storageKey, upload.uploadId);
    const parts = [1, 2, 3].map((partNumber) => ({ partNumber, etag: '"x"' }));
    await expect(service.complete(dto.id, { parts }, ENGINEER)).rejects.toMatchObject({ status: 412 });
  });

  it('reports 412 for a part list that does not match what storage actually holds', async () => {
    const { dto, video, upload } = await registeredVideo();
    for (const part of upload.parts) {
      await fetch(part.signedUrl, { method: 'PUT', body: partBody(video, part.partNumber) });
    }
    const wrong = [1, 2, 3].map((partNumber) => ({ partNumber, etag: '"00000000000000000000000000000000"' }));
    await expect(service.complete(dto.id, { parts: wrong }, ENGINEER)).rejects.toMatchObject({ status: 412 });
  });

  it('resolves two concurrent part requests after expiry onto a single winning upload, aborting the loser', async () => {
    const { dto, upload } = await registeredVideo();
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } });
    await minio.client.abortMultipart(row.storageKey, upload.uploadId);

    const created: string[] = [];
    const original = minio.client.createMultipart.bind(minio.client);
    const spy = vi.spyOn(minio.client, 'createMultipart').mockImplementation(async (key: string, contentType: string) => {
      const id = await original(key, contentType);
      created.push(id);
      return id;
    });
    try {
      const [a, b] = await Promise.all([
        service.parts(dto.id, [1], ENGINEER),
        service.parts(dto.id, [1], ENGINEER),
      ]);
      const uploadIdOf = (signedUrl: string) => new URL(signedUrl).searchParams.get('uploadId');
      const winner = (await prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } })).multipartUploadId!;
      expect(winner).not.toBe(upload.uploadId);
      expect(uploadIdOf(a.parts[0]!.signedUrl)).toBe(winner);
      expect(uploadIdOf(b.parts[0]!.signedUrl)).toBe(winner);

      expect(created).toHaveLength(2);
      const loser = created.find((id) => id !== winner)!;
      expect(loser).toBeDefined();
      expect(await minio.client.listParts(row.storageKey, loser)).toBeNull();
      expect(await minio.client.listParts(row.storageKey, winner)).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
