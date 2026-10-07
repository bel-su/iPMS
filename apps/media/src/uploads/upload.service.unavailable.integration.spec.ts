import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/media';
import { MULTIPART_THRESHOLD_BYTES, uuidv7, type RegisterUploadDto } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { isServiceUnavailable } from '../http/availability.js';
import { StorageClient } from '../storage/storage.client.js';
import { MediaDiscarder } from '../media/discarder.js';
import { UploadService } from './upload.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; });
afterAll(async () => { await db?.stop(); });

/**
 * §5.3 promises 503 when storage is unavailable. UploadService.register()
 * itself throws the raw SDK/network error — it is the media-local
 * ServiceUnavailableInterceptor (apps/media/src/http/) that turns that into
 * a 503 for the HTTP caller. This exercises the service call end to end
 * against an endpoint nothing is listening on (immediate ECONNREFUSED, no
 * timeout needed) and confirms the error it throws is one the interceptor's
 * mapper recognizes.
 */
describe('UploadService against unreachable storage', () => {
  it('throws a raw error that the availability mapper classifies as a service outage', async () => {
    const unreachable = new StorageClient({
      endpoint: 'http://127.0.0.1:1', publicEndpoint: 'http://127.0.0.1:1', region: 'us-east-1',
      bucket: 'ipms-media-test', accessKeyId: 'x', secretAccessKey: 'x', forcePathStyle: true, autoCreateBucket: false,
    });
    const workOrderId = uuidv7();
    const qc = { workOrder: async () => ({ state: 'found' as const, value: { id: workOrderId, projectId: uuidv7(), siteId: uuidv7(), siteCode: 'KOS121', status: 'ONGOING' as const } }) };
    const project = {
      geofence: async () => ({ latitude: 26.4525, longitude: 87.2718, effectiveRadiusM: 100 }),
      scope: async () => ({ state: 'found' as const, value: { global: true, projectIds: [], siteIds: [] } }),
    };
    const service = new UploadService(prisma, unreachable, qc, project, new MediaDiscarder(prisma, unreachable));

    // A multipart-threshold video: register() calls storage.createMultipart(),
    // an actual network round trip (unlike presigning, which is local).
    const body = randomBytes(16);
    const dto: RegisterUploadDto = {
      id: uuidv7(), category: 'EVIDENCE', workOrderId, checklistItemId: uuidv7(), kind: 'VIDEO',
      contentType: 'video/mp4', sizeBytes: MULTIPART_THRESHOLD_BYTES + 1, contentHash: createHash('sha256').update(body).digest('hex'),
      capturedAt: new Date('2026-09-28T08:00:00Z'), latitude: 26.4525, longitude: 87.2718, deviceId: 'RMX3630',
    };

    let caught: unknown;
    try {
      await service.register(dto, uuidv7(), 'Bearer t');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isServiceUnavailable(caught)).toBe(true);
  });
});
