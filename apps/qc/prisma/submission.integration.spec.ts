import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';
import { SubmissionService } from '../src/submissions/submission.service.js';
import type { SiteGeofenceClient } from '../src/submissions/site-geofence.client.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: SubmissionService;
const noGeofence = { fetch: async () => null } as unknown as SiteGeofenceClient;
const DAY = 86_400_000;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  service = new SubmissionService(prisma, noGeofence, 7);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const submit = (templateVersionId: string, itemId: string) => service.createSubmission({
  taskId: uuidv7(), siteId: uuidv7(), projectId: uuidv7(), templateVersionId,
  idempotencyKey: `key-${uuidv7()}`,
  responses: [{ itemId, selfCheckResult: 'PASS', photoMediaIds: [] }],
}, ACTOR, 'Bearer t');

describe('createSubmission against template versions', () => {
  it('accepts the published version and records its number', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    const submission = await submit(versionId, itemId);
    expect(submission).toMatchObject({ templateId, templateVersionId: versionId, templateVersion: 1, geofenceStatus: 'UNVERIFIED' });
  });

  it('accepts a version retired within the grace window', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma, { status: 'RETIRED', retiredAt: new Date(Date.now() - 2 * DAY) });
    await expect(submit(versionId, itemId)).resolves.toBeTruthy();
  });

  it('refuses a version retired before the grace window', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma, { status: 'RETIRED', retiredAt: new Date(Date.now() - 9 * DAY) });
    await expect(submit(versionId, itemId)).rejects.toThrow('This checklist has been updated');
  });

  it('refuses a disabled template', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma, { disabled: true });
    await expect(submit(versionId, itemId)).rejects.toThrow('This checklist has been disabled');
  });
});
