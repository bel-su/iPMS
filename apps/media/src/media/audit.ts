import type { Prisma } from '@prisma-clients/media';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';

export type Tx = Prisma.TransactionClient;

/** Written inside the action's own transaction. A null actor is media itself (verifier, sweeper). */
export async function recordAudit(
  tx: Tx,
  e: { actorId: string | null; action: string; objectId: string; previousState: JsonObject; newState: JsonObject },
): Promise<void> {
  await tx.outboxEvent.create({
    data: buildOutboxRecord(SUBJECTS.AUDIT_EVENT, {
      actorId: e.actorId, action: e.action, objectType: 'MediaObject', objectId: e.objectId,
      previousState: e.previousState, newState: e.newState, details: {},
    }, getCorrelationId() ?? 'system', e.actorId ?? undefined),
  });
}
