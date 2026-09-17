import { describe, expect, it } from 'vitest';
import { check } from './evaluate.js';
import type { AuthzRequest, AuthzResource, AuthzScope, AuthzUser } from './types.js';

const NOW = new Date('2026-09-15T12:00:00.000Z');

function user(overrides: Partial<AuthzUser> = {}): AuthzUser {
  return {
    id: 'u-1', roles: ['FIELD_ENGINEER'],
    permissions: ['task.view', 'task.update'],
    tokenVersion: 1, isActive: true, ...overrides,
  };
}

function scope(overrides: Partial<AuthzScope> = {}): AuthzScope {
  return { global: false, projectIds: ['p-1'], siteIds: ['s-1'], ...overrides };
}

// `resource` is widened to accept an explicit `undefined` alongside `Partial<AuthzRequest>`'s
// other fields: under `exactOptionalPropertyTypes`, `Partial<T>` does not by itself allow an
// already-optional property to be assigned `undefined` explicitly (a known TS/Partial
// interaction, https://github.com/microsoft/TypeScript/issues/46969), and this test needs
// `resource: undefined` to assert "no resource given" as a request override.
type ReqOverrides = Partial<Omit<AuthzRequest, 'resource'>> & { resource?: AuthzResource | undefined };

function req(overrides: ReqOverrides = {}): AuthzRequest {
  // Spread `resource` conditionally: under `exactOptionalPropertyTypes`, `AuthzRequest` allows
  // the `resource` key to be *absent* but not present with value `undefined`, so an explicit
  // `resource: undefined` override (used below to assert the "no resource" case) must drop the
  // key entirely rather than carry it through as `resource: undefined`.
  const { resource, ...rest } = overrides;
  return {
    user: user(), permission: 'task.update', scope: scope(), now: NOW,
    ...rest,
    ...(resource !== undefined ? { resource } : {}),
  };
}

describe('check — account state', () => {
  it('denies an inactive user even with the permission', () => {
    const d = check(req({ user: user({ isActive: false }) }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('USER_INACTIVE');
  });
});

describe('check — permission', () => {
  it('allows when the permission is held and no resource is given', () => {
    expect(check(req({ permission: 'task.view', resource: undefined })).allowed).toBe(true);
  });

  it('denies when the permission is absent', () => {
    const d = check(req({ permission: 'task.delete' }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('PERMISSION_MISSING');
  });
});

describe('check — overrides', () => {
  it('grants a permission the roles do not carry via an ALLOW override', () => {
    const d = check(req({
      permission: 'qc_review.approve',
      overrides: [{ permission: 'qc_review.approve', effect: 'ALLOW', projectId: null, siteId: null, validFrom: null, validUntil: null }],
    }));
    expect(d.allowed).toBe(true);
  });

  it('lets DENY beat a permission held through a role', () => {
    const d = check(req({
      overrides: [{ permission: 'task.update', effect: 'DENY', projectId: null, siteId: null, validFrom: null, validUntil: null }],
    }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('DENIED_BY_OVERRIDE');
  });

  it('lets DENY beat an ALLOW override for the same permission', () => {
    const d = check(req({
      permission: 'qc_review.approve',
      overrides: [
        { permission: 'qc_review.approve', effect: 'ALLOW', projectId: null, siteId: null, validFrom: null, validUntil: null },
        { permission: 'qc_review.approve', effect: 'DENY', projectId: null, siteId: null, validFrom: null, validUntil: null },
      ],
    }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('DENIED_BY_OVERRIDE');
  });

  it('ignores an expired ALLOW override', () => {
    const d = check(req({
      permission: 'qc_review.approve',
      overrides: [{
        permission: 'qc_review.approve', effect: 'ALLOW', projectId: null, siteId: null,
        validFrom: new Date('2026-09-01T00:00:00Z'), validUntil: new Date('2026-09-10T00:00:00Z'),
      }],
    }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('PERMISSION_MISSING');
  });

  it('ignores an override that has not started yet', () => {
    const d = check(req({
      permission: 'qc_review.approve',
      overrides: [{
        permission: 'qc_review.approve', effect: 'ALLOW', projectId: null, siteId: null,
        validFrom: new Date('2026-10-01T00:00:00Z'), validUntil: null,
      }],
    }));
    expect(d.allowed).toBe(false);
  });

  it('applies a project-scoped override only inside that project', () => {
    const override = {
      permission: 'qc_review.approve', effect: 'ALLOW' as const,
      projectId: 'p-1', siteId: null, validFrom: null, validUntil: null,
    };
    const inside = check(req({
      permission: 'qc_review.approve', overrides: [override],
      resource: { type: 'Submission', id: 'x', projectId: 'p-1', siteId: 's-1' },
    }));
    expect(inside.allowed).toBe(true);

    const outside = check(req({
      permission: 'qc_review.approve', overrides: [override],
      scope: scope({ projectIds: ['p-1', 'p-2'], siteIds: ['s-1', 's-2'] }),
      resource: { type: 'Submission', id: 'x', projectId: 'p-2', siteId: 's-2' },
    }));
    expect(outside.allowed).toBe(false);
  });
});

describe('check — project and site scope', () => {
  it('denies a resource in an unscoped project', () => {
    const d = check(req({ resource: { type: 'Task', id: 't-1', projectId: 'p-9' } }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('OUT_OF_PROJECT_SCOPE');
  });

  it('denies a resource on an unscoped site', () => {
    const d = check(req({ resource: { type: 'Task', id: 't-1', projectId: 'p-1', siteId: 's-9' } }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('OUT_OF_SITE_SCOPE');
  });

  it('allows any project or site for a globally scoped user', () => {
    const d = check(req({
      scope: scope({ global: true, projectIds: [], siteIds: [] }),
      resource: { type: 'Task', id: 't-1', projectId: 'p-9', siteId: 's-9' },
    }));
    expect(d.allowed).toBe(true);
  });

  it('skips site scope when the resource carries no site', () => {
    expect(check(req({ resource: { type: 'Project', id: 'p-1', projectId: 'p-1' } })).allowed).toBe(true);
  });
});

describe('check — assignment', () => {
  it('denies a task assigned to someone else when assignment is required', () => {
    const d = check(req({
      requireAssignment: true,
      resource: { type: 'Task', id: 't-1', projectId: 'p-1', siteId: 's-1', assigneeId: 'u-2' },
    }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('NOT_ASSIGNED');
  });

  it('allows a task assigned to the user', () => {
    const d = check(req({
      requireAssignment: true,
      resource: { type: 'Task', id: 't-1', projectId: 'p-1', siteId: 's-1', assigneeId: 'u-1' },
    }));
    expect(d.allowed).toBe(true);
  });

  it('accepts ownership as assignment', () => {
    const d = check(req({
      requireAssignment: true,
      resource: { type: 'Submission', id: 'x', projectId: 'p-1', siteId: 's-1', ownerId: 'u-1' },
    }));
    expect(d.allowed).toBe(true);
  });

  it('ignores assignment when it is not required', () => {
    const d = check(req({
      resource: { type: 'Task', id: 't-1', projectId: 'p-1', siteId: 's-1', assigneeId: 'u-2' },
    }));
    expect(d.allowed).toBe(true);
  });
});

describe('check — resource state', () => {
  const stateRules = [{ permission: 'task.update', allowedStates: ['NOT_STARTED', 'ONGOING', 'RECTIFYING'] }];

  it('denies editing a completed task', () => {
    const d = check(req({
      stateRules,
      resource: { type: 'Task', id: 't-1', projectId: 'p-1', siteId: 's-1', state: 'COMPLETED' },
    }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('RESOURCE_STATE_FORBIDS');
  });

  it('allows editing a task under rectification', () => {
    const d = check(req({
      stateRules,
      resource: { type: 'Task', id: 't-1', projectId: 'p-1', siteId: 's-1', state: 'RECTIFYING' },
    }));
    expect(d.allowed).toBe(true);
  });

  it('ignores state when no rule covers the permission', () => {
    const d = check(req({
      stateRules: [{ permission: 'task.delete', allowedStates: ['NOT_STARTED'] }],
      resource: { type: 'Task', id: 't-1', projectId: 'p-1', siteId: 's-1', state: 'COMPLETED' },
    }));
    expect(d.allowed).toBe(true);
  });
});

describe('check — evaluation order', () => {
  it('reports the earliest failing gate, not a later one', () => {
    const d = check(req({
      permission: 'task.delete',
      resource: { type: 'Task', id: 't-1', projectId: 'p-9', siteId: 's-9', state: 'COMPLETED' },
    }));
    expect(d.reason).toBe('PERMISSION_MISSING');
  });

  it('records every gate it evaluated in order', () => {
    const d = check(req({ resource: { type: 'Task', id: 't-1', projectId: 'p-1', siteId: 's-1' } }));
    expect(d.checks.map((c) => c.name)).toEqual([
      'account_active', 'no_deny_override', 'permission_held', 'project_scope', 'site_scope',
    ]);
    expect(d.checks.every((c) => c.passed)).toBe(true);
  });
});
