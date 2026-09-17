import type {
  AuthzCheck, AuthzDecision, AuthzOverride, AuthzReason, AuthzRequest, AuthzResource,
} from './types.js';

function withinValidity(o: AuthzOverride, now: Date): boolean {
  if (o.validFrom && now < o.validFrom) return false;
  if (o.validUntil && now > o.validUntil) return false;
  return true;
}

/** An override with a project or site applies only to a resource in that project or site. */
function appliesToResource(o: AuthzOverride, resource: AuthzResource | undefined): boolean {
  if (o.siteId !== null) return resource?.siteId === o.siteId;
  if (o.projectId !== null) return resource?.projectId === o.projectId;
  return true;
}

function relevantOverrides(req: AuthzRequest, now: Date): AuthzOverride[] {
  return (req.overrides ?? []).filter(
    (o) => o.permission === req.permission && withinValidity(o, now) && appliesToResource(o, req.resource),
  );
}

export function check(req: AuthzRequest): AuthzDecision {
  const now = req.now ?? new Date();
  const checks: AuthzCheck[] = [];

  const deny = (reason: AuthzReason, name: string, detail: string): AuthzDecision => {
    checks.push({ name, passed: false, detail });
    return { allowed: false, reason, checks };
  };
  const pass = (name: string, detail?: string): void => {
    checks.push(detail === undefined ? { name, passed: true } : { name, passed: true, detail });
  };

  // 1. Account state
  if (!req.user.isActive) {
    return deny('USER_INACTIVE', 'account_active', 'Account is deactivated');
  }
  pass('account_active');

  const applicable = relevantOverrides(req, now);

  // 2. DENY always wins, even over a role-granted permission.
  if (applicable.some((o) => o.effect === 'DENY')) {
    return deny('DENIED_BY_OVERRIDE', 'no_deny_override', `Explicitly denied: ${req.permission}`);
  }
  pass('no_deny_override');

  // 3. Permission held through a role, or granted by a live ALLOW override.
  const heldByRole = req.user.permissions.includes(req.permission);
  const grantedByOverride = applicable.some((o) => o.effect === 'ALLOW');
  if (!heldByRole && !grantedByOverride) {
    return deny('PERMISSION_MISSING', 'permission_held', `Missing permission: ${req.permission}`);
  }
  pass('permission_held', heldByRole ? 'granted by role' : 'granted by override');

  const resource = req.resource;
  if (!resource) {
    return { allowed: true, reason: 'ALLOWED', checks };
  }

  // 4. Project scope
  if (!req.scope.global && resource.projectId !== undefined) {
    if (!req.scope.projectIds.includes(resource.projectId)) {
      return deny('OUT_OF_PROJECT_SCOPE', 'project_scope', `No access to project ${resource.projectId}`);
    }
  }
  pass('project_scope', req.scope.global ? 'global scope' : 'project in scope');

  // 5. Site scope
  if (!req.scope.global && resource.siteId !== undefined) {
    if (!req.scope.siteIds.includes(resource.siteId)) {
      return deny('OUT_OF_SITE_SCOPE', 'site_scope', `No access to site ${resource.siteId}`);
    }
    pass('site_scope', 'site in scope');
  } else if (!req.scope.global) {
    pass('site_scope', 'resource has no site');
  } else {
    pass('site_scope', 'global scope');
  }

  // 6. Assignment or ownership
  if (req.requireAssignment === true) {
    const isAssigned = resource.assigneeId === req.user.id || resource.ownerId === req.user.id;
    if (!isAssigned) {
      return deny('NOT_ASSIGNED', 'assignment', 'Resource is not assigned to this user');
    }
    pass('assignment', 'assigned to user');
  }

  // 7. Resource state
  const rule = (req.stateRules ?? []).find((r) => r.permission === req.permission);
  if (rule && resource.state !== undefined) {
    if (!rule.allowedStates.includes(resource.state)) {
      return deny('RESOURCE_STATE_FORBIDS', 'resource_state', `Not permitted while state is ${resource.state}`);
    }
    pass('resource_state', `state ${resource.state} permits ${req.permission}`);
  }

  return { allowed: true, reason: 'ALLOWED', checks };
}
