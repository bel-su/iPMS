import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';
import { DraftService } from '../src/drafts/draft.service.js';
import { ACTOR, resetDb, seedPublishedTemplate, seedWorkOrder } from './fixtures.js';
import { startTestDb } from './test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let drafts: DraftService;
beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; drafts = new DraftService(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const PHONE = { deviceId: 'phone-a', deviceLabel: 'Pixel 7' };
const TABLET = { deviceId: 'tab-b', deviceLabel: 'Galaxy Tab' };
const order = async (status = 'NOT_STARTED') => {
  const { templateId, itemId } = await seedPublishedTemplate(prisma);
  return { ...(await seedWorkOrder(prisma, templateId, { status })), itemId };
};

describe('drafts', () => {
  it('creates on first save, moves NOT_STARTED to ONGOING with a STARTED entry, and reads back', async () => {
    const wo = await order();
    const saved = await drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [{ itemId: wo.itemId, selfCheckResult: 'PASS', mediaIds: [] }] }, ACTOR);
    expect(saved).toMatchObject({ version: 1, deviceId: 'phone-a', deviceLabel: 'Pixel 7' });
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status).toBe('ONGOING');
    expect((await prisma.workOrderEvent.findMany({ where: { workOrderId: wo.id } })).map((e) => e.kind)).toEqual(['STARTED']);
    expect((await drafts.get(wo.id, ACTOR)).responses).toEqual([{ itemId: wo.itemId, selfCheckResult: 'PASS', mediaIds: [] }]);
  });

  it('refuses a stale save and a save from another device', async () => {
    const wo = await order('ONGOING');
    await drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR);
    await expect(drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR)).rejects.toMatchObject({ status: 409, response: { details: { reason: 'DRAFT_STALE', version: 1 } } });
    await expect(drafts.save(wo.id, { ...TABLET, baseVersion: 1, responses: [] }, ACTOR)).rejects.toMatchObject({ status: 409, response: { details: { reason: 'DRAFT_HELD_ELSEWHERE', deviceLabel: 'Pixel 7' } } });
  });

  it('hands over on takeover; the old device is then refused', async () => {
    const wo = await order('ONGOING');
    await drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR);
    expect(await drafts.takeover(wo.id, TABLET, ACTOR)).toMatchObject({ version: 2, deviceId: 'tab-b' });
    await expect(drafts.save(wo.id, { ...PHONE, baseVersion: 2, responses: [] }, ACTOR)).rejects.toMatchObject({ response: { details: { reason: 'DRAFT_HELD_ELSEWHERE', deviceLabel: 'Galaxy Tab' } } });
    await expect(drafts.save(wo.id, { ...TABLET, baseVersion: 2, responses: [] }, ACTOR)).resolves.toMatchObject({ version: 3 });
  });

  it('serialises concurrent first saves: one creates, the other is stale', async () => {
    const wo = await order('ONGOING');
    const results = await Promise.allSettled([
      drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR),
      drafts.save(wo.id, { ...TABLET, baseVersion: 0, responses: [] }, ACTOR),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.workOrderDraft.count()).toBe(1);
  });

  it('is only for the assignee, and only while the work order is open for changes', async () => {
    const wo = await order('ONGOING');
    await expect(drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses: [] }, uuidv7())).rejects.toMatchObject({ status: 403 });
    const reviewing = await seedWorkOrder(prisma, wo.templateId, { status: 'REVIEWING' });
    await expect(drafts.save(reviewing.id, { ...PHONE, baseVersion: 0, responses: [] }, ACTOR)).rejects.toMatchObject({ status: 409, response: { details: { reason: 'WORK_ORDER_CLOSED' } } });
    await expect(drafts.get(uuidv7(), ACTOR)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a draft over 256 KB', async () => {
    const wo = await order('ONGOING');
    const big = 'x'.repeat(5000);
    const responses = Array.from({ length: 60 }, () => ({ itemId: wo.itemId, selfCheckDescription: big, mediaIds: [] }));
    await expect(drafts.save(wo.id, { ...PHONE, baseVersion: 0, responses }, ACTOR)).rejects.toMatchObject({ status: 413 });
  });

  it('pre-fills a rework draft from the last attempt without saving it', async () => {
    const wo = await order('RECTIFYING');
    const submissionId = uuidv7();
    const responseId = uuidv7();
    const photo = uuidv7();
    const version = await prisma.templateVersion.findFirstOrThrow({ where: { templateId: wo.templateId } });
    await prisma.submission.create({ data: {
      id: submissionId, taskId: wo.id, siteId: wo.siteId, projectId: wo.projectId, templateId: wo.templateId, templateVersionId: version.id,
      templateVersion: 1, attemptNo: 1, status: 'REJECTED_REWORK', submittedBy: ACTOR, integrityHash: 'h', idempotencyKey: `k-${uuidv7()}`,
    } });
    await prisma.itemResponse.create({ data: { id: responseId, submissionId, itemId: wo.itemId, selfCheckResult: 'PASS', numberValue: 12.5, selfCheckDescription: 'ok' } });
    await prisma.itemMedia.create({ data: { id: uuidv7(), itemResponseId: responseId, mediaId: photo, kind: 'PHOTO', sequence: 0 } });
    await prisma.workOrder.update({ where: { id: wo.id }, data: { currentSubmissionId: submissionId, currentAttemptNo: 1 } });

    expect(await drafts.get(wo.id, ACTOR)).toEqual({
      workOrderId: wo.id, version: 0, deviceId: null, deviceLabel: null, updatedAt: null,
      responses: [{ itemId: wo.itemId, selfCheckResult: 'PASS', selfCheckDescription: 'ok', numberValue: 12.5, mediaIds: [photo] }],
    });
    expect(await prisma.workOrderDraft.count()).toBe(0);
  });
});
