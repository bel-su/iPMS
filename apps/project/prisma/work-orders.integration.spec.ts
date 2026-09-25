import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { UserScopeRepository } from '../src/scope/user-scope.repository.js';
import { TaskStatusConsumer } from '../src/work-orders/task-status.consumer.js';
import type { TemplateLookupClient } from '../src/work-orders/template-lookup.client.js';
import { WorkOrderService } from '../src/work-orders/work-order.service.js';
import { startTestDb } from './test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: WorkOrderService;
let consumer: TaskStatusConsumer;
const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const ACTOR = uuidv7();
const ENGINEER = uuidv7();
const TEMPLATE_ID = uuidv7();
const S1 = uuidv7();
const S2 = uuidv7();
const templates = {
  fetch: async () => ({ state: 'found', template: { id: TEMPLATE_ID, code: 'Q1', name: 'Antenna + RRU', category: 'QUALITY', disabled: false, publishedVersion: 1 } }),
} as unknown as TemplateLookupClient;

let antenna: string;
let power: string;
let antennaSite: string;
let powerSite: string;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  service = new WorkOrderService(prisma, templates, new UserScopeRepository(prisma));
  consumer = new TaskStatusConsumer(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });

beforeEach(async () => {
  await prisma.task.deleteMany({});
  await prisma.site.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.userScope.deleteMany({});
  // The same site code in two projects: an antenna upgrade and a power upgrade.
  antenna = uuidv7(); power = uuidv7(); antennaSite = uuidv7(); powerSite = uuidv7();
  await prisma.project.create({ data: { id: antenna, code: 'TI-L2100', name: 'Antenna upgrade' } });
  await prisma.project.create({ data: { id: power, code: 'PWR-2026', name: 'Power upgrade' } });
  await prisma.site.create({ data: { id: antennaSite, projectId: antenna, siteCode: 'KOS102X', name: 'KOS102X' } });
  await prisma.site.create({ data: { id: powerSite, projectId: power, siteCode: 'KOS102X', name: 'KOS102X' } });
  await prisma.userScope.create({ data: { id: uuidv7(), userId: ENGINEER, level: 'PROJECT', projectId: antenna } });
});

const create = (projectId: string, siteId: string) => service.create(GLOBAL, projectId, {
  workOrderType: 'QUALITY_SELF_CHECK', templateId: TEMPLATE_ID, siteIds: [siteId], assigneeId: ENGINEER,
  plannedCompletionAt: new Date('2026-09-30T18:14:59Z'),
}, ACTOR, 'Bearer t');

describe('work orders against a real database', () => {
  it('tells the same site code apart by project', async () => {
    const { created } = await create(antenna, antennaSite);
    expect(created[0]).toMatchObject({ project: { code: 'TI-L2100' }, site: { siteCode: 'KOS102X' } });
    const page = await service.list(GLOBAL, { page: 1, limit: 20, q: 'PWR' });
    expect(page.total).toBe(0);
  });

  it('refuses an engineer with no scope on the other project', async () => {
    await expect(create(power, powerSite)).rejects.toThrow(/no access to site KOS102X/);
  });

  it('lists across projects with counts and the overdue view', async () => {
    await prisma.userScope.create({ data: { id: uuidv7(), userId: ENGINEER, level: 'SITE', siteId: powerSite } });
    await create(antenna, antennaSite);
    await create(power, powerSite);
    const all = await service.list(GLOBAL, { page: 1, limit: 20 }, new Date('2026-10-05T00:00:00Z'));
    expect(all.total).toBe(2);
    expect(all.counts).toMatchObject({ ALL: 2, NOT_STARTED: 2, OVERDUE: 2 });
    const one = await service.list(GLOBAL, { page: 1, limit: 20, projectId: power });
    expect(one.items.map((item) => item.project.code)).toEqual(['PWR-2026']);
  });

  it('follows submission and review facts in any order, and applies each once', async () => {
    const { created } = await create(antenna, antennaSite);
    const taskId = created[0]!.id;
    const base = { taskId, projectId: antenna, submittedBy: ENGINEER, reviewedBy: ACTOR, comment: null };

    await consumer.applySubmitted({ ...base, submissionId: S1, attemptNo: 1, submittedAt: '2026-09-25T08:00:00Z' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('REVIEWING');

    await consumer.applyReviewed({ ...base, submissionId: S1, attemptNo: 1, decision: 'REJECT_REWORK', reviewedAt: '2026-09-25T09:00:00Z' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('RECTIFYING');

    // Attempt 2's review overtakes its submission.
    await consumer.applyReviewed({ ...base, submissionId: S2, attemptNo: 2, decision: 'APPROVE', reviewedAt: '2026-09-26T09:00:00Z' });
    await consumer.applySubmitted({ ...base, submissionId: S2, attemptNo: 2, submittedAt: '2026-09-26T08:00:00Z' });
    // A stale redelivery of attempt 1's rejection.
    await consumer.applyReviewed({ ...base, submissionId: S1, attemptNo: 1, decision: 'REJECT_REWORK', reviewedAt: '2026-09-25T09:00:00Z' });

    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task).toMatchObject({ status: 'COMPLETED', currentAttemptNo: 2, currentSubmissionId: S2 });
    expect(task.actualCompletionAt?.toISOString()).toBe('2026-09-26T09:00:00.000Z');

    const detail = await service.get(GLOBAL, taskId);
    expect(detail.events.map((event) => event.kind)).toEqual(['CREATED', 'SUBMITTED', 'REJECTED', 'SUBMITTED', 'APPROVED']);
  });

  it('never moves a cancelled work order, and cannot change a closed one', async () => {
    const { created } = await create(antenna, antennaSite);
    const taskId = created[0]!.id;
    await service.cancel(GLOBAL, taskId, { reason: 'Site handed back' }, ACTOR);
    await consumer.applySubmitted({ taskId, projectId: antenna, submittedBy: ENGINEER, submissionId: S1, attemptNo: 1, submittedAt: '2026-09-25T08:00:00Z' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } }))).toMatchObject({ status: 'CANCELLED', cancelReason: 'Site handed back' });
    await expect(service.update(GLOBAL, taskId, { assigneeId: ENGINEER }, ACTOR)).rejects.toThrow('cancelled');
  });

  it('lists who may be made responsible, per project', async () => {
    await prisma.userScope.create({ data: { id: uuidv7(), userId: ACTOR, level: 'GLOBAL' } });
    expect(await service.assignable(GLOBAL, antenna)).toEqual(expect.arrayContaining([
      { userId: ENGINEER, wholeProject: true, siteIds: [] }, { userId: ACTOR, wholeProject: true, siteIds: [] },
    ]));
    expect((await service.assignable(GLOBAL, power)).map((row) => row.userId)).toEqual([ACTOR]);
  });
});
