import { describe, expect, it } from 'vitest';
import { CloneRoleSchema, CreateRoleSchema, GrantScopeSchema } from './role.js';
import { AccessCheckSchema, CreateOverrideSchema } from './scope.js';
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

describe('CloneRoleSchema', () => {
  it('accepts a valid clone request', () => {
    const input = { name: 'QC Inspector Copy', code: 'QC_INSPECTOR_COPY', sourceRoleId: uuidv7() };
    expect(CloneRoleSchema.safeParse(input).success).toBe(true);
  });

  it('strips unknown fields instead of rejecting, so an out-of-date client is not hard-failed', () => {
    const input = { name: 'QC Inspector Copy', code: 'QC_INSPECTOR_COPY', sourceRoleId: uuidv7(), isSystemRole: true };
    const parsed = CloneRoleSchema.parse(input);
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

  it('rejects an empty reason, not just a missing one', () => {
    const input = {
      permissionCode: 'qc.review.approve', effect: 'ALLOW',
      validUntil: '2026-09-30T00:00:00.000Z', reason: '',
    };
    expect(CreateOverrideSchema.safeParse(input).success).toBe(false);
  });

  it('strips unknown fields instead of rejecting, so an out-of-date client is not hard-failed', () => {
    const input = {
      permissionCode: 'qc.review.approve', effect: 'ALLOW',
      reason: 'Temporary QC cover', legacyApprovalFlag: true,
    };
    const parsed = CreateOverrideSchema.parse(input);
    expect(parsed).not.toHaveProperty('legacyApprovalFlag');
  });
});

describe('AccessCheckSchema', () => {
  it('accepts a valid access check', () => {
    const input = { userId: uuidv7(), permissionCode: 'qc.review.approve' };
    expect(AccessCheckSchema.safeParse(input).success).toBe(true);
  });

  it('strips unknown fields instead of rejecting, so an out-of-date client is not hard-failed', () => {
    const input = { userId: uuidv7(), permissionCode: 'qc.review.approve', legacyClientHint: 'v1' };
    const parsed = AccessCheckSchema.parse(input);
    expect(parsed).not.toHaveProperty('legacyClientHint');
  });
});
