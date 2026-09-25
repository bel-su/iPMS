import type { PrismaClient } from '@prisma-clients/project';
import {
  SUBJECTS, type DurableConsumer, type QcSubmissionReviewed, type QcSubmissionSubmitted,
} from '@ipms/events';
import { uuidv7 } from '@ipms/contracts';
import { createLogger } from '@ipms/observability';

const log = createLogger('project');

/** One durable per subject, matching STREAMS.QC.durableConsumers. */
export const TASK_STATUS_DURABLES: Readonly<Record<string, string>> = {
  [SUBJECTS.QC_SUBMISSION_SUBMITTED]: 'project-task-submitted',
  [SUBJECTS.QC_SUBMISSION_REVIEWED]: 'project-task-reviewed',
};

export const TASK_STATUS_DEDUPE_PREFIX = 'project-task';

/**
 * Moves a task's status from qc's submission facts:
 *
 *   submitted            → REVIEWING
 *   reviewed, approved   → COMPLETED (actualCompletionAt = review time)
 *   reviewed, rejected   → RECTIFYING
 *
 * The two subjects travel on separate durables, so a review can arrive before
 * the submission it reviews, and a redelivery can arrive after a newer fact.
 * Every write is therefore conditional on the attempt number, not on arrival
 * order: a submission applies only when newer than the task's current attempt,
 * a review when it is at least as new and not already applied. A late or
 * repeated event changes nothing, which also makes both handlers idempotent
 * on top of the dedupe store. A cancelled task is never moved.
 *
 * The timeline entry is written even when the status write is a no-op, once per
 * submission and kind, so the history is complete whatever order facts arrive in.
 */
export class TaskStatusConsumer {
  constructor(private readonly prisma: PrismaClient) {}

  async register(consumer: DurableConsumer): Promise<void> {
    await consumer.subscribe<QcSubmissionSubmitted>(
      SUBJECTS.QC_SUBMISSION_SUBMITTED, TASK_STATUS_DURABLES[SUBJECTS.QC_SUBMISSION_SUBMITTED]!,
      async (envelope) => { await this.applySubmitted(envelope.payload); },
    );
    await consumer.subscribe<QcSubmissionReviewed>(
      SUBJECTS.QC_SUBMISSION_REVIEWED, TASK_STATUS_DURABLES[SUBJECTS.QC_SUBMISSION_REVIEWED]!,
      async (envelope) => { await this.applyReviewed(envelope.payload); },
    );
  }

  async applySubmitted(fact: QcSubmissionSubmitted): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.task.updateMany({
        where: {
          id: fact.taskId,
          status: { notIn: ['CANCELLED', 'COMPLETED'] },
          OR: [{ currentAttemptNo: null }, { currentAttemptNo: { lt: fact.attemptNo } }],
        },
        data: { status: 'REVIEWING', currentSubmissionId: fact.submissionId, currentAttemptNo: fact.attemptNo },
      });
      const recorded = await this.record(tx, fact.taskId, 'SUBMITTED', fact.submissionId, new Date(fact.submittedAt), fact.submittedBy, { attemptNo: fact.attemptNo });
      log.debug({ taskId: fact.taskId, attemptNo: fact.attemptNo, applied: changed.count > 0, recorded }, 'submission applied');
    });
  }

  async applyReviewed(fact: QcSubmissionReviewed): Promise<void> {
    const approved = fact.decision === 'APPROVE';
    const at = new Date(fact.reviewedAt);
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.task.updateMany({
        where: {
          id: fact.taskId,
          status: { not: 'CANCELLED' },
          OR: [
            { currentAttemptNo: null },
            { currentAttemptNo: { lt: fact.attemptNo } },
            // Same attempt, not yet reviewed — the ordinary case.
            { currentAttemptNo: fact.attemptNo, status: { notIn: ['COMPLETED', 'RECTIFYING'] } },
          ],
        },
        data: {
          status: approved ? 'COMPLETED' : 'RECTIFYING',
          currentSubmissionId: fact.submissionId,
          currentAttemptNo: fact.attemptNo,
          actualCompletionAt: approved ? at : null,
        },
      });
      const recorded = await this.record(tx, fact.taskId, approved ? 'APPROVED' : 'REJECTED', fact.submissionId, at, fact.reviewedBy, {
        attemptNo: fact.attemptNo, comment: fact.comment,
      });
      log.debug({ taskId: fact.taskId, attemptNo: fact.attemptNo, applied: changed.count > 0, recorded }, 'review applied');
    });
  }

  /** Once per task, kind and submission. Skipped for a task this service does not hold. */
  private async record(
    tx: Pick<PrismaClient, 'task' | 'workOrderEvent'>, taskId: string, kind: string, submissionId: string,
    at: Date, actorId: string, detail: Record<string, string | number | null>,
  ): Promise<boolean> {
    const task = await tx.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) return false;
    const existing = await tx.workOrderEvent.findFirst({ where: { taskId, kind, detail: { path: ['submissionId'], equals: submissionId } }, select: { id: true } });
    if (existing) return false;
    await tx.workOrderEvent.create({ data: { id: uuidv7(), taskId, kind, at, actorId, detail: { submissionId, ...detail } } });
    return true;
  }
}
