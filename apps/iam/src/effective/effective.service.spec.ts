import { describe, expect, it, vi } from 'vitest';
import { EffectiveService } from './effective.service.js';
import { uuidv7 } from '@ipms/contracts';

const USER = uuidv7();
const FUTURE = new Date('2027-01-01T00:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');

function build(overrides: unknown[] = []) {
  const user = {
    id: USER, isActive: true, tokenVersion: 0,
    roles: [{
      role: { code: 'FIELD_ENGINEER', isActive: true, permissions: [
        { permission: { code: 'task.view' } }, { permission: { code: 'task.update' } },
      ] },
      validFrom: null, validUntil: null,
    }],
    projectScopes: [{ projectId: 'p-1' }],
    siteScopes: [{ siteId: 's-1' }],
    overrides,
  };
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
  return { service: new EffectiveService(prisma as never), prisma };
}

describe('EffectiveService.forUser', () => {
  it('lists permissions granted by roles with their source', async () => {
    const { service } = build();
    const result = await service.forUser(USER);
    const taskView = result.find((p) => p.code === 'task.view');
    expect(taskView).toMatchObject({ granted: true, source: 'ROLE', sourceDetail: 'FIELD_ENGINEER' });
  });

  it('adds a permission granted by a live ALLOW override', async () => {
    const { service } = build([{
      permission: { code: 'qc_review.approve' }, effect: 'ALLOW',
      projectId: null, siteId: null, validFrom: null, validUntil: FUTURE, reason: 'cover',
    }]);
    const result = await service.forUser(USER);
    expect(result.find((p) => p.code === 'qc_review.approve')).toMatchObject({
      granted: true, source: 'OVERRIDE_ALLOW',
    });
  });

  it('marks a permission denied by an override as not granted', async () => {
    const { service } = build([{
      permission: { code: 'task.update' }, effect: 'DENY',
      projectId: null, siteId: null, validFrom: null, validUntil: null, reason: 'suspended',
    }]);
    const result = await service.forUser(USER);
    expect(result.find((p) => p.code === 'task.update')).toMatchObject({
      granted: false, source: 'OVERRIDE_DENY',
    });
  });

  it('ignores an expired override', async () => {
    const { service } = build([{
      permission: { code: 'qc_review.approve' }, effect: 'ALLOW',
      projectId: null, siteId: null, validFrom: null, validUntil: PAST, reason: 'old',
    }]);
    const result = await service.forUser(USER);
    expect(result.find((p) => p.code === 'qc_review.approve')).toBeUndefined();
  });

  it('reports the scope level a permission is effective at', async () => {
    const { service } = build();
    const result = await service.forUser(USER);
    expect(result.find((p) => p.code === 'task.view')!.scopeLevel).toBe('SITE');
  });
});

describe('EffectiveService.simulate', () => {
  it('grants when the user holds the permission', async () => {
    const { service } = build();
    const result = await service.simulate({ userId: USER, permissionCode: 'task.view' });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ALLOWED');
  });

  it('denies and names the reason when the permission is missing', async () => {
    const { service } = build();
    const result = await service.simulate({ userId: USER, permissionCode: 'task.delete' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('PERMISSION_MISSING');
  });

  it('returns the full ordered check chain for troubleshooting', async () => {
    const { service } = build();
    const result = await service.simulate({ userId: USER, permissionCode: 'task.view' });
    expect(result.checks.map((c) => c.name)).toEqual(['account_active', 'no_deny_override', 'permission_held']);
  });

  it('denies a deactivated user before anything else', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({
      id: USER, isActive: false, tokenVersion: 0, roles: [], projectScopes: [], siteScopes: [], overrides: [],
    });
    const result = await service.simulate({ userId: USER, permissionCode: 'task.view' });
    expect(result.reason).toBe('USER_INACTIVE');
  });

  it('reflects a DENY override in the simulation', async () => {
    const { service } = build([{
      permission: { code: 'task.update' }, effect: 'DENY',
      projectId: null, siteId: null, validFrom: null, validUntil: null, reason: 'suspended',
    }]);
    const result = await service.simulate({ userId: USER, permissionCode: 'task.update' });
    expect(result.reason).toBe('DENIED_BY_OVERRIDE');
  });
});
