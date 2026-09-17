import { uuidv7 } from '@ipms/contracts';
import { getCorrelationId } from '@ipms/observability';

export interface EventEnvelope<T> {
  eventId: string;
  subject: string;
  occurredAt: string;
  version: number;
  correlationId: string;
  actorId: string | null;
  payload: T;
}

export function createEnvelope<T>(
  subject: string,
  payload: T,
  opts?: { actorId?: string; correlationId?: string; version?: number },
): EventEnvelope<T> {
  return {
    eventId: uuidv7(),
    subject,
    occurredAt: new Date().toISOString(),
    version: opts?.version ?? 1,
    correlationId: opts?.correlationId ?? getCorrelationId() ?? uuidv7(),
    actorId: opts?.actorId ?? null,
    payload,
  };
}
