import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';
import { SubmissionService } from '../src/submissions/submission.service.js';
import type { SiteGeofenceClient } from '../src/submissions/site-geofence.client.js';
import type { TaskLookupClient, TaskRef } from '../src/tasks/task-lookup.client.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: SubmissionService;
const noGeofence = { fetch: async () => null } as unknown as SiteGeofenceClient;
/** project's view of each task, keyed by id; a test registers the task it submits against. */
const tasks = new Map<string, TaskRef>();
const taskLookup = { fetch: async (id: string) => (tasks.has(id) ? { state: 'found', task: tasks.get(id)! } : { state: 'not_found' }) } as unknown as TaskLookupClient;
const DAY = 86_400_000;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  service = new SubmissionService(prisma, noGeofence, 7, taskLookup);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); tasks.clear(); });

function assignTask(templateId: string, overrides: Partial<TaskRef> = {}): TaskRef {
  const task: TaskRef = { id: uuidv7(), projectId: uuidv7(), siteId: uuidv7(), assigneeId: ACTOR, templateId, status: 'NOT_STARTED', ...overrides };
  tasks.set(task.id, task);
  return task;
}

const submitFor = (task: TaskRef, templateVersionId: string, itemId: string, actor = ACTOR) => service.createSubmission({
  taskId: task.id, siteId: task.siteId, projectId: task.projectId, templateVersionId,
  idempotencyKey: `key-${uuidv7()}`,
  responses: [{ itemId, selfCheckResult: 'PASS', photoMediaIds: [] }],
}, actor, 'Bearer t');

const submit = async (templateVersionId: string, itemId: string) => {
  const version = await prisma.templateVersion.findUniqueOrThrow({ where: { id: templateVersionId } });
  return submitFor(assignTask(version.templateId), templateVersionId, itemId);
};

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

describe('createSubmission against its task', () => {
  it('refuses someone the task is not assigned to', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    await expect(submitFor(assignTask(templateId), versionId, itemId, uuidv7())).rejects.toThrow('This task is not assigned to you');
  });

  it('refuses a checklist other than the task’s own', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma);
    await expect(submitFor(assignTask(uuidv7()), versionId, itemId)).rejects.toThrow('not the checklist assigned');
  });

  it('refuses a cancelled task', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    await expect(submitFor(assignTask(templateId, { status: 'CANCELLED' }), versionId, itemId)).rejects.toThrow('cancelled');
  });

  it('refuses a second submission while the first awaits review', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    const task = assignTask(templateId);
    await submitFor(task, versionId, itemId);
    await expect(submitFor(task, versionId, itemId)).rejects.toThrow('awaiting review');
  });

  it('accepts a new attempt after rework is requested, and tells project about both facts', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    const task = assignTask(templateId);
    const first = await submitFor(task, versionId, itemId);
    await service.reviewSubmission(first.id, { decision: 'REJECT_REWORK', comment: 'Blurred', itemReviews: [{ itemId, result: 'REJECTED' }] }, ACTOR);
    const second = await submitFor(task, versionId, itemId);
    expect(second.attemptNo).toBe(2);

    const events = await prisma.outboxEvent.findMany({ where: { subject: { startsWith: 'qc.submission.' } }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => [e.subject, (e.payload as { attemptNo: number }).attemptNo])).toEqual([
      ['qc.submission.submitted', 1], ['qc.submission.reviewed', 1], ['qc.submission.submitted', 2],
    ]);
    expect(events[1]!.payload).toMatchObject({ taskId: task.id, decision: 'REJECT_REWORK', comment: 'Blurred' });
  });
});
