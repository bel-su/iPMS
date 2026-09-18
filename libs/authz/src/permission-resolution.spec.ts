import { describe, expect, it } from 'vitest';
import { resolvePermissions } from './permission-resolution.js';
import type { AuthzOverride } from './types.js';

const NOW = new Date('2026-06-15T12:00:00Z');

function override(partial: Partial<AuthzOverride> & { permission: string; effect: 'ALLOW' | 'DENY' }): AuthzOverride {
  return {
    projectId: null, siteId: null, validFrom: null, validUntil: null, ...partial,
  };
}

describe('resolvePermissions', () => {
  it('returns the role permissions unchanged when there are no overrides', () => {
    expect(resolvePermissions(['task.view', 'task.update'], [], NOW).sort())
      .toEqual(['task.update', 'task.view']);
  });

  it('deduplicates role permissions', () => {
    expect(resolvePermissions(['task.view', 'task.view'], [], NOW)).toEqual(['task.view']);
  });

  it('adds a permission granted by a live global ALLOW override', () => {
    const result = resolvePermissions(
      ['task.view'],
      [override({ permission: 'qc_review.approve', effect: 'ALLOW' })],
      NOW,
    );
    expect(result).toContain('qc_review.approve');
  });

  it('removes a permission denied by a live global DENY override', () => {
    const result = resolvePermissions(
      ['task.view', 'qc_review.approve'],
      [override({ permission: 'qc_review.approve', effect: 'DENY' })],
      NOW,
    );
    expect(result).not.toContain('qc_review.approve');
    expect(result).toContain('task.view');
  });

  /**
   * The invariant that makes a suspension real. `check()` evaluates DENY before
   * it evaluates whether the permission is held, so a DENY wins there even over
   * a role grant; the token claim must agree or the two disagree about the same
   * user. Applying the two effects in row order instead ("last one wins") is the
   * bug this test exists to catch.
   */
  it('lets DENY win over an ALLOW for the same permission, whichever order they arrive in', () => {
    const allow = override({ permission: 'qc_review.approve', effect: 'ALLOW' });
    const deny = override({ permission: 'qc_review.approve', effect: 'DENY' });

    expect(resolvePermissions([], [allow, deny], NOW)).not.toContain('qc_review.approve');
    expect(resolvePermissions([], [deny, allow], NOW)).not.toContain('qc_review.approve');
  });

  it('lets DENY win over a role grant', () => {
    const result = resolvePermissions(
      ['qc_review.approve'],
      [override({ permission: 'qc_review.approve', effect: 'DENY' })],
      NOW,
    );
    expect(result).not.toContain('qc_review.approve');
  });

  it('ignores an override that has not started yet', () => {
    const result = resolvePermissions(
      ['task.view'],
      [override({
        permission: 'qc_review.approve', effect: 'ALLOW',
        validFrom: new Date('2026-07-01T00:00:00Z'),
      })],
      NOW,
    );
    expect(result).not.toContain('qc_review.approve');
  });

  it('ignores an override that has expired', () => {
    const result = resolvePermissions(
      ['task.view'],
      [override({
        permission: 'qc_review.approve', effect: 'ALLOW',
        validUntil: new Date('2026-01-01T00:00:00Z'),
      })],
      NOW,
    );
    expect(result).not.toContain('qc_review.approve');
  });

  it('does not let an expired DENY remove a role permission', () => {
    const result = resolvePermissions(
      ['qc_review.approve'],
      [override({
        permission: 'qc_review.approve', effect: 'DENY',
        validUntil: new Date('2026-01-01T00:00:00Z'),
      })],
      NOW,
    );
    expect(result).toContain('qc_review.approve');
  });

  /**
   * A project- or site-scoped override cannot be folded into a token claim: the
   * claim carries no resource, so folding one in would apply it to every
   * resource everywhere. Scoped overrides reach `check()` through
   * `OVERRIDE_PROVIDER` instead, where a resource is in hand.
   */
  it('ignores a project-scoped ALLOW override', () => {
    const result = resolvePermissions(
      ['task.view'],
      [override({ permission: 'qc_review.approve', effect: 'ALLOW', projectId: 'p-1' })],
      NOW,
    );
    expect(result).not.toContain('qc_review.approve');
  });

  it('ignores a project-scoped DENY override, leaving the role grant in place', () => {
    const result = resolvePermissions(
      ['qc_review.approve'],
      [override({ permission: 'qc_review.approve', effect: 'DENY', projectId: 'p-1' })],
      NOW,
    );
    expect(result).toContain('qc_review.approve');
  });

  it('ignores a site-scoped override', () => {
    const result = resolvePermissions(
      ['qc_review.approve'],
      [override({ permission: 'qc_review.approve', effect: 'DENY', projectId: 'p-1', siteId: 's-1' })],
      NOW,
    );
    expect(result).toContain('qc_review.approve');
  });

  it('does not mutate the role permission array it was given', () => {
    const roles = ['task.view'];
    resolvePermissions(roles, [override({ permission: 'task.view', effect: 'DENY' })], NOW);
    expect(roles).toEqual(['task.view']);
  });
});
