import { describe, expect, it } from 'vitest';
import { LoginSchema, TokenPayloadSchema } from './auth.js';
import { uuidv7 } from '../common/ids.js';

describe('LoginSchema', () => {
  it('accepts a valid credential pair', () => {
    expect(LoginSchema.safeParse({ username: 'engineer', password: 'demo12345' }).success).toBe(true);
  });

  it('rejects an empty username', () => {
    expect(LoginSchema.safeParse({ username: '', password: 'demo12345' }).success).toBe(false);
  });

  it('rejects a password under 8 characters', () => {
    expect(LoginSchema.safeParse({ username: 'engineer', password: 'short' }).success).toBe(false);
  });

  it('strips unknown fields so clients cannot inject claims', () => {
    const parsed = LoginSchema.parse({ username: 'a', password: 'demo12345', role: 'SUPER_ADMIN' });
    expect(parsed).toEqual({ username: 'a', password: 'demo12345' });
  });
});

describe('TokenPayloadSchema', () => {
  it('accepts a well-formed payload', () => {
    const payload = {
      sub: uuidv7(),
      roles: ['FIELD_ENGINEER'],
      permissions: ['task.view', 'qc.submission.create'],
      tokenVersion: 1,
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    };
    expect(TokenPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a payload carrying scope lists, which must never be embedded', () => {
    const payload = {
      sub: uuidv7(), roles: [], permissions: [], tokenVersion: 1,
      iat: 1, exp: 2, siteIds: ['a', 'b'],
    };
    expect(TokenPayloadSchema.parse(payload)).not.toHaveProperty('siteIds');
  });
});
