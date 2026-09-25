import { describe, expect, it } from 'vitest';
import {
  AssignRolesSchema, ChangePasswordSchema, CreateUserSchema,
  EmailSchema, UpdateUserSchema, UserListQuerySchema,
} from './user.js';

describe('EmailSchema', () => {
  it('trims and lowercases, so the same person cannot register twice', () => {
    expect(EmailSchema.parse('  Field.Engineer@IPMS.local  ')).toBe('field.engineer@ipms.local');
  });

  it('refuses something that is not an address', () => {
    expect(EmailSchema.safeParse('engineer').success).toBe(false);
    expect(EmailSchema.safeParse('').success).toBe(false);
  });
});

describe('CreateUserSchema', () => {
  const valid = {
    email: 'new@ipms.local', fullName: 'New Engineer',
    password: 'Correct-horse-1', roleCodes: ['FIELD_ENGINEER'],
  };

  it('accepts a complete body', () => {
    expect(CreateUserSchema.parse(valid).email).toBe('new@ipms.local');
  });

  it('defaults roleCodes to none', () => {
    const { roleCodes: _omitted, ...withoutRoles } = valid;
    expect(CreateUserSchema.parse(withoutRoles).roleCodes).toEqual([]);
  });

  it('accepts eight characters with every character class', () => {
    expect(CreateUserSchema.safeParse({ ...valid, password: 'Abcdef1!' }).success).toBe(true);
  });

  it.each([
    ['under eight characters', 'Abcde1!'],
    ['no uppercase letter', 'abcdef1!'],
    ['no lowercase letter', 'ABCDEF1!'],
    ['no digit', 'Abcdefg!'],
    ['no symbol', 'Abcdefg1'],
  ])('refuses a password with %s', (_why, password) => {
    expect(CreateUserSchema.safeParse({ ...valid, password }).success).toBe(false);
  });

  it('refuses a malformed email', () => {
    expect(CreateUserSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  /**
   * Strips rather than rejects, per this directory's convention — and these are
   * the two keys it matters for: a client that sends `isActive` or
   * `mustChangePassword` must not have them reach the handler.
   */
  it('strips keys the caller has no business setting', () => {
    const parsed = CreateUserSchema.parse({ ...valid, isActive: false, mustChangePassword: false });
    expect(parsed).not.toHaveProperty('isActive');
    expect(parsed).not.toHaveProperty('mustChangePassword');
  });
});

describe('UpdateUserSchema', () => {
  it('normalizes a changed email the same way creation does', () => {
    expect(UpdateUserSchema.parse({ email: ' Ann@IPMS.local ' }).email).toBe('ann@ipms.local');
  });

  it('has no password field: a credential change must revoke sessions, so it has its own endpoint', () => {
    expect(UpdateUserSchema.parse({ password: 'a-new-password' })).not.toHaveProperty('password');
  });

  it('lets employeeCode be cleared with null but not blanked with a space', () => {
    expect(UpdateUserSchema.parse({ employeeCode: null }).employeeCode).toBeNull();
    expect(UpdateUserSchema.parse({ employeeCode: ' EMP-1 ' }).employeeCode).toBe('EMP-1');
  });
});

describe('AssignRolesSchema', () => {
  // The complete desired set, never a delta: idempotent, and the audit entry is
  // a complete before/after rather than half a story.
  it('takes the whole desired set, including the empty one', () => {
    expect(AssignRolesSchema.parse({ roleCodes: [] }).roleCodes).toEqual([]);
    expect(AssignRolesSchema.parse({ roleCodes: ['QC_MANAGER'] }).roleCodes).toEqual(['QC_MANAGER']);
  });

  it('refuses a role code that is not UPPER_SNAKE_CASE', () => {
    expect(AssignRolesSchema.safeParse({ roleCodes: ['qc_manager'] }).success).toBe(false);
  });
});

describe('ChangePasswordSchema', () => {
  it('requires both halves, and holds only the new one to the policy', () => {
    const parsed = ChangePasswordSchema.parse({ currentPassword: 'old8char', newPassword: 'Long-enough-1' });
    expect(parsed.currentPassword).toBe('old8char');
    expect(ChangePasswordSchema.safeParse({ currentPassword: 'old8char', newPassword: 'tooshort' }).success).toBe(false);
  });
});

describe('UserListQuerySchema', () => {
  it('defaults to the first page, twenty rows, and every status', () => {
    expect(UserListQuerySchema.parse({})).toEqual({ page: 1, limit: 20, status: 'ALL' });
  });

  it('coerces the page and limit a query string delivers as text', () => {
    const parsed = UserListQuerySchema.parse({ page: '3', limit: '50', search: ' ann ' });
    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(50);
    expect(parsed.search).toBe('ann');
  });
});
