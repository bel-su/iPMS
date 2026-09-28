import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PART_SIZE_BYTES } from '@ipms/contracts';
import { startMinio } from '../testing/minio.js';
import { StorageClient } from './storage.client.js';

let minio: Awaited<ReturnType<typeof startMinio>>;
let storage: StorageClient;
beforeAll(async () => { minio = await startMinio(); storage = minio.client; });
afterAll(async () => { await minio?.stop(); });

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const put = (url: string, body: Buffer, headers: Record<string, string>) =>
  fetch(url, { method: 'PUT', body, headers });

describe('StorageClient against MinIO', () => {
  it('reports a reachable bucket as healthy', async () => {
    expect(await storage.isHealthy()).toBe(true);
  });

  it('accepts exactly the bytes a presigned PUT was signed for', async () => {
    const body = randomBytes(2048);
    const signed = await storage.presignPut('t/ok.jpg', { contentType: 'image/jpeg', sizeBytes: body.length, sha256Hex: sha(body) }, 3600);
    expect(signed.headers).toMatchObject({ 'content-type': 'image/jpeg' });
    expect((await put(signed.signedUrl, body, signed.headers)).status).toBe(200);
    expect(await storage.head('t/ok.jpg')).toEqual({ sizeBytes: 2048 });
  });

  it('refuses different bytes of the same length under the same signature', async () => {
    const body = randomBytes(2048);
    const signed = await storage.presignPut('t/tampered.jpg', { contentType: 'image/jpeg', sizeBytes: body.length, sha256Hex: sha(body) }, 3600);
    const response = await put(signed.signedUrl, randomBytes(2048), signed.headers);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.head('t/tampered.jpg')).toBeNull();
  });

  it('resumes a multipart upload from the parts already stored', async () => {
    const body = randomBytes(PART_SIZE_BYTES * 2 + 1234);
    const uploadId = await storage.createMultipart('t/video.mp4', 'video/mp4');
    const partOf = (n: number) => body.subarray((n - 1) * PART_SIZE_BYTES, n * PART_SIZE_BYTES);
    const first = await fetch(await storage.presignPart('t/video.mp4', uploadId, 1, 3600), { method: 'PUT', body: partOf(1) });
    expect(first.status).toBe(200);

    // The phone reconnects and asks what arrived.
    expect((await storage.listParts('t/video.mp4', uploadId))?.map((p) => p.partNumber)).toEqual([1]);
    for (const n of [2, 3]) {
      await fetch(await storage.presignPart('t/video.mp4', uploadId, n, 3600), { method: 'PUT', body: partOf(n) });
    }
    const parts = (await storage.listParts('t/video.mp4', uploadId))!;
    await storage.completeMultipart('t/video.mp4', uploadId, parts);

    const chunks: Buffer[] = [];
    for await (const chunk of await storage.getStream('t/video.mp4')) chunks.push(chunk as Buffer);
    expect(sha(Buffer.concat(chunks))).toBe(sha(body));
  });

  it('answers null for parts of an upload that no longer exists', async () => {
    const uploadId = await storage.createMultipart('t/gone.mp4', 'video/mp4');
    await storage.abortMultipart('t/gone.mp4', uploadId);
    expect(await storage.listParts('t/gone.mp4', uploadId)).toBeNull();
    await storage.abortMultipart('t/gone.mp4', uploadId); // idempotent
  });

  it('signs a short-lived download with a readable name, and deletes', async () => {
    await storage.put('t/dl.jpg', Buffer.from('jpeg'), 'image/jpeg');
    const signed = await storage.presignGet('t/dl.jpg', 300, 'KOS121_20260928-080000_abc123.jpg');
    const response = await fetch(signed.signedUrl);
    expect(response.headers.get('content-disposition')).toContain('KOS121_20260928-080000_abc123.jpg');
    await storage.delete(['t/dl.jpg']);
    expect(await storage.head('t/dl.jpg')).toBeNull();
  });

  it('deletes more than 1000 keys in one call, batching under S3\'s per-request limit', async () => {
    // None of these exist. S3 does not treat deleting a missing key as an
    // error, so this must not throw even though nothing was ever put.
    const keys = Array.from({ length: 1001 }, (_, i) => `t/batch/${i}.jpg`);
    await expect(storage.delete(keys)).resolves.toBeUndefined();
  });

  it('rejects object-level calls against a bucket that does not exist, rather than reporting them as missing', async () => {
    const missingBucket = new StorageClient({ ...minio.storage, bucket: 'ipms-media-test-does-not-exist' });
    await expect(missingBucket.head('whatever')).rejects.toThrow();
    await expect(missingBucket.listParts('whatever', 'fake-upload-id')).rejects.toThrow();
    await expect(missingBucket.abortMultipart('whatever', 'fake-upload-id')).rejects.toThrow();
  });
});
