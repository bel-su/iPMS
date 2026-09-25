import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import type { Tx } from './document.js';

/** The objects this service is accountable for; a closed union so a typo is a compile error, not an orphan row. */
export type AuditObject = 'ChecklistTemplate' | 'WorkOrder';

/** Written inside the action's own transaction, so an action and its audit entry commit together. */
export async function recordAudit(
  tx: Tx,
  entry: { actorId: string; action: string; objectType?: AuditObject; objectId: string; previousState: JsonObject; newState: JsonObject },
): Promise<void> {
  await tx.outboxEvent.create({
    data: buildOutboxRecord(SUBJECTS.AUDIT_EVENT, {
      actorId: entry.actorId, action: entry.action, objectType: entry.objectType ?? 'ChecklistTemplate', objectId: entry.objectId,
      previousState: entry.previousState, newState: entry.newState, details: {},
    }, getCorrelationId() ?? 'unknown', entry.actorId),
  });
}

/** A value as a ledger-safe JSON object: dates become ISO strings, undefined keys drop out. */
export function asJson(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
