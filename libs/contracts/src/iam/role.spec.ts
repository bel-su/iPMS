import { describe, expect, it } from 'vitest';
import { CreateRoleSchema, GrantScopeSchema } from './role.js';
import { CreateOverrideSchema } from './scope.js';
import { uuidv7 } from '../common/ids.js';

describe('CreateRoleSchema', () => {
  it('accepts an uppercase snake-case code', () => {
    const input = { name: 'QC Inspector', code: 'QC_INSPECTOR', description: '', permissionCodes: ['qc.review.approve'] };
    expect(CreateRoleSchema.safeParse(input).success).toBe(true);
  });

  it('rejects a lowercase code', () => {
    const input = { name: 'QC', code: 'qc_inspector', permissionCodes: [] };
    expect(CreateRoleSchema.safeParse(input).success).toBe(false);
  });

  it('never lets a client mark a role as a system role', () => {
    const parsed = CreateRoleSchema.parse({ name: 'X', code: 'X_ROLE', permissionCodes: [], isSystemRole: true });
    expect(parsed).not.toHaveProperty('isSystemRole');
  });
});

describe('GrantScopeSchema', () => {
  it('accepts a project grant', () => {
    expect(GrantScopeSchema.safeParse({ level: 'PROJECT', projectId: uuidv7() }).success).toBe(true);
  });

  it('requires projectId when the level is PROJECT', () => {
    expect(GrantScopeSchema.safeParse({ level: 'PROJECT' }).success).toBe(false);
  });

  it('requires siteId when the level is SITE', () => {
    expect(GrantScopeSchema.safeParse({ level: 'SITE', projectId: uuidv7() }).success).toBe(false);
  });
});

describe('CreateOverrideSchema', () => {
  it('requires a reason so overrides are always justified', () => {
    const input = { permissionCode: 'qc.review.approve', effect: 'ALLOW', validUntil: '2026-09-30T00:00:00.000Z' };
    expect(CreateOverrideSchema.safeParse(input).success).toBe(false);
  });

  it('accepts an override with a reason', () => {
    const input = {
      permissionCode: 'qc.review.approve', effect: 'ALLOW',
      validUntil: '2026-09-30T00:00:00.000Z', reason: 'Temporary QC cover',
    };
    expect(CreateOverrideSchema.safeParse(input).success).toBe(true);
  });
});
