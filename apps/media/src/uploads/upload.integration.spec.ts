import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  const project = { geofence: async () => ({ latitude: 26.4525, longitude: 87.2718, effectiveRadiusM: 100 }) };
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
