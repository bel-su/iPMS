import 'server-only';
import { authFetch, type ApiResult } from './api-client';

/**
 * The audit ledger as the gateway serves it (`/api/v1/audit/events`, newest
 * first). Read-only: the ledger is append-only and needs `audit.view`.
 */
export interface AuditEvent {
  id: string;
  sequence: number;
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface AuditPage { items: AuditEvent[]; total: number; page: number; limit: number }

export async function listAuditEvents(limit = 40): Promise<ApiResult<AuditPage>> {
  return authFetch<AuditPage>('/api/v1/audit/events', { query: { limit: String(limit) } });
}
