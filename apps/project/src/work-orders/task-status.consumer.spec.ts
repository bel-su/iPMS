import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-clients/project';
import { TaskStatusConsumer } from './task-status.consumer.js';

function makePrisma() {
  const prisma = {
    task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue({ id: 't-1' }) },
    workOrderEvent: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    outboxEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return prisma;
}

const SUBMITTED = { submissionId: 'sub-2', taskId: 't-1', projectId: 'p-1', attemptNo: 2, submittedBy: 'u-e', submittedAt: '2026-09-25T08:00:00.000Z' };
const REVIEWED = { ...SUBMITTED, decision: 'APPROVE' as const, reviewedBy: 'u-q', reviewedAt: '2026-09-25T10:00:00.000Z', comment: null };

describe('TaskStatusConsumer', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let consumer: TaskStatusConsumer;
  beforeEach(() => { prisma = makePrisma(); consumer = new TaskStatusConsumer(prisma as unknown as PrismaClient); });

  it('moves a task to review only for a newer attempt, never out of a closed state', async () => {
    await consumer.applySubmitted(SUBMITTED);
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 't-1', status: { notIn: ['CANCELLED', 'COMPLETED'] },
        OR: [{ currentAttemptNo: null }, { currentAttemptNo: { lt: 2 } }],
      },
      data: { status: 'REVIEWING', currentSubmissionId: 'sub-2', currentAttemptNo: 2 },
    });
    expect(prisma.workOrderEvent.create.mock.calls[0]?.[0].data).toMatchObject({ kind: 'SUBMITTED', actorId: 'u-e', detail: { submissionId: 'sub-2', attemptNo: 2 } });
  });

  it('completes on approval, stamping the completion time', async () => {
    await consumer.applyReviewed(REVIEWED);
    const call = prisma.task.updateMany.mock.calls[0]?.[0];
    expect(call.data).toEqual({ status: 'COMPLETED', currentSubmissionId: 'sub-2', currentAttemptNo: 2, actualCompletionAt: new Date('2026-09-25T10:00:00.000Z') });
    expect(call.where.status).toEqual({ not: 'CANCELLED' });
    expect(prisma.workOrderEvent.create.mock.calls[0]?.[0].data.kind).toBe('APPROVED');
  });

  it('sends a rejected submission back for rework', async () => {
    await consumer.applyReviewed({ ...REVIEWED, decision: 'REJECT_REWORK', comment: 'Photos blurred' });
    expect(prisma.task.updateMany.mock.calls[0]?.[0].data).toMatchObject({ status: 'RECTIFYING', actualCompletionAt: null });
    expect(prisma.workOrderEvent.create.mock.calls[0]?.[0].data).toMatchObject({ kind: 'REJECTED', detail: { comment: 'Photos blurred' } });
  });

  it('applies a review that arrives before its submission, and does not re-apply it', async () => {
    const where = (await consumer.applyReviewed(REVIEWED), prisma.task.updateMany.mock.calls[0]?.[0].where);
    // Same attempt may be applied only while not yet reviewed.
    expect(where.OR).toContainEqual({ currentAttemptNo: 2, status: { notIn: ['COMPLETED', 'RECTIFYING'] } });
  });

  it('records each timeline fact once, even when redelivered', async () => {
    prisma.workOrderEvent.findFirst.mockResolvedValue({ id: 'e-1' });
    await consumer.applySubmitted(SUBMITTED);
    expect(prisma.workOrderEvent.create).not.toHaveBeenCalled();
  });

  it('audits a status that moved, as the person behind the fact', async () => {
    await consumer.applyReviewed(REVIEWED);
    expect(prisma.outboxEvent.create.mock.calls[0]?.[0].data.payload).toMatchObject({
      action: 'work_order.status_changed', actorId: 'u-q', objectId: 't-1', newState: { status: 'COMPLETED', attemptNo: 2 },
    });
  });

  it('does not audit a fact that moved nothing', async () => {
    prisma.task.updateMany.mockResolvedValue({ count: 0 });
    await consumer.applySubmitted(SUBMITTED);
    expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('ignores a task this service does not hold', async () => {
    prisma.task.updateMany.mockResolvedValue({ count: 0 });
    prisma.task.findUnique.mockResolvedValue(null);
    await consumer.applyReviewed(REVIEWED);
    expect(prisma.workOrderEvent.create).not.toHaveBeenCalled();
  });
});
