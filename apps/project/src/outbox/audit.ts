import type { PrismaClient } from '@prisma-clients/project';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';

/** The transaction-scoped client Prisma hands a `$transaction` callback. */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * The objects this service is accountable for. A closed union rather than a
 * free string so a typo becomes a compile error instead of an orphan row that
 * no audit query will ever match.
 */
export type AuditObject = 'Project' | 'Site' | 'TaskType' | 'Milestone' | 'Task';

export interface AuditEntry {
  actorId: string;
  action: string;
  objectType: AuditObject;
  objectId: string;
  previousState: JsonObject;
  newState: JsonObject;
}

/**
 * Records a mutation in the ledger, inside the caller's own transaction.
 *
 * The atomicity is the point, not the indirection. Publishing to NATS from a
 * service method loses the event when the process dies between the commit and
 * the publish -- a mutation that happened and was never recorded, which is
 * exactly the hole an append-only ledger exists to close. A row committed with
 * the change cannot be lost; the drainer retries until it is published, and
 * `audit` deduplicates on eventId.
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.outboxEvent.create({
    data: buildOutboxRecord(
      SUBJECTS.AUDIT_EVENT,
      {
        actorId: entry.actorId,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        previousState: entry.previousState,
        newState: entry.newState,
        details: {},
      },
      getCorrelationId() ?? 'unknown',
      entry.actorId,
    ),
  });
}

/**
 * A DTO as a ledger-safe JSON object.
 *
 * `JSON.stringify` turns the `Date` values Zod coerces into ISO strings, which
 * `InputJsonObject` accepts. Passing a DTO straight through would hand Prisma a
 * `Date` in a JSON column and fail at the type level, or worse, serialize to
 * something the audit consumer cannot read back.
 */
export const asJson = (value: unknown): JsonObject =>
  JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
