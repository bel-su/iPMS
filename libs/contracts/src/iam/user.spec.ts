import { describe, expect, it } from 'vitest';
import {
  AssignRolesSchema, ChangePasswordSchema, CreateUserSchema,
  UpdateUserSchema, UserListQuerySchema, UsernameSchema,
} from './user.js';

describe('UsernameSchema', () => {
  it('trims and lowercases, so the same person cannot register twice', () => {
    expect(UsernameSchema.parse('  Field.Engineer_01  ')).toBe('field.engineer_01');
  });

  // The seeded `qc` account is two characters; a policy the repository's own
  // seed violates is the wrong policy.
  it('accepts a two-character username', () => {
    expect(UsernameSchema.parse('qc')).toBe('qc');
  });

  it('refuses a single character, a leading digit, and a space', () => {
    expect(UsernameSchema.safeParse('a').success).toBe(false);
    expect(UsernameSchema.safeParse('1abc').success).toBe(false);
    expect(UsernameSchema.safeParse('ab cd').success).toBe(false);
  });
});

describe('CreateUserSchema', () => {
  const valid = {
    username: 'new.engineer', email: 'new@ipms.local', fullName: 'New Engineer',
    password: 'correct-horse-battery', roleCodes: ['FIELD_ENGINEER'],
  };

  it('accepts a complete body', () => {
    expect(CreateUserSchema.parse(valid).username).toBe('new.engineer');
  });

  it('defaults roleCodes to none', () => {
    const { roleCodes: _omitted, ...withoutRoles } = valid;
    expect(CreateUserSchema.parse(withoutRoles).roleCodes).toEqual([]);
  });

  it('refuses a password under twelve characters', () => {
    expect(CreateUserSchema.safeParse({ ...valid, password: 'short11chars' }).success).toBe(true);
    expect(CreateUserSchema.safeParse({ ...valid, password: 'tooshort' }).success).toBe(false);
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
  it('has no username field: renaming would rewrite who past audit entries are about', () => {
    expect(UpdateUserSchema.parse({ username: 'renamed' })).not.toHaveProperty('username');
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
    const parsed = ChangePasswordSchema.parse({ currentPassword: 'old8char', newPassword: 'a-long-enough-one' });
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
