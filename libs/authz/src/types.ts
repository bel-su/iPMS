export type Effect = 'ALLOW' | 'DENY';
export type ScopeLevel = 'GLOBAL' | 'PROJECT' | 'SITE' | 'ASSIGNED_RESOURCE';

export interface AuthzUser {
  id: string;
  roles: string[];
  permissions: string[];
  tokenVersion: number;
  isActive: boolean;
}

/** Replicated from iam over NATS and cached per service. Never embedded in a JWT. */
export interface AuthzScope {
  global: boolean;
  projectIds: string[];
  siteIds: string[];
}

export interface AuthzResource {
  type: string;
  id: string;
  projectId?: string;
  siteId?: string;
  assigneeId?: string;
  ownerId?: string;
  state?: string;
}

export interface AuthzOverride {
  permission: string;
  effect: Effect;
  projectId: string | null;
  siteId: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
}

/** Which resource states permit which permissions, e.g. a COMPLETED task is not editable. */
export interface StateRule {
  permission: string;
  allowedStates: string[];
}

export type AuthzReason =
  | 'ALLOWED'
  | 'USER_INACTIVE'
  | 'PERMISSION_MISSING'
  | 'DENIED_BY_OVERRIDE'
  | 'OUT_OF_PROJECT_SCOPE'
  | 'OUT_OF_SITE_SCOPE'
  | 'NOT_ASSIGNED'
  | 'RESOURCE_STATE_FORBIDS';

export interface AuthzCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface AuthzRequest {
  user: AuthzUser;
  permission: string;
  resource?: AuthzResource;
  scope: AuthzScope;
  overrides?: AuthzOverride[];
  stateRules?: StateRule[];
  /** When the assigned-resource rule applies to this permission for this user. */
  requireAssignment?: boolean;
  now?: Date;
}

export interface AuthzDecision {
  allowed: boolean;
  reason: AuthzReason;
  checks: AuthzCheck[];
}
