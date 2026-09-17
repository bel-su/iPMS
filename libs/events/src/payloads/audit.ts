export interface AuditEventPayload {
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  details: Record<string, unknown>;
}
