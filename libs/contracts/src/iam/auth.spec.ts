import { describe, expect, it } from 'vitest';
import { LoginSchema, RefreshSchema, TokenPayloadSchema } from './auth.js';
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
      typ: 'access',
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    };
    expect(TokenPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('strips scope-list fields, which must never travel in a token', () => {
    const payload = {
      sub: uuidv7(), roles: [], permissions: [], tokenVersion: 1, typ: 'access',
      iat: 1, exp: 2, siteIds: ['a', 'b'],
    };
    expect(TokenPayloadSchema.parse(payload)).not.toHaveProperty('siteIds');
  });

  // `typ` distinguishes a 15-minute access token from a 30-day refresh token.
  // Both are signed with the same secret, so the claim is the *only* thing
  // stopping a refresh token from being replayed as an access token — and it
  // has to be a required, retained field to do that job. When it was merely
  // absent from this schema, `.strip()` silently discarded it, and every
  // verifier downstream saw a valid payload either way.
  it('requires typ, so a verifier can tell the two token kinds apart', () => {
    const payload = { sub: uuidv7(), roles: [], permissions: [], tokenVersion: 1, iat: 1, exp: 2 };
    expect(TokenPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('retains typ rather than stripping it', () => {
    const payload = { sub: uuidv7(), roles: [], permissions: [], tokenVersion: 1, typ: 'refresh', iat: 1, exp: 2 };
    expect(TokenPayloadSchema.parse(payload).typ).toBe('refresh');
  });

  it('rejects a typ outside the two known kinds', () => {
    const payload = { sub: uuidv7(), roles: [], permissions: [], tokenVersion: 1, typ: 'admin', iat: 1, exp: 2 };
    expect(TokenPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe('RefreshSchema', () => {
  it('accepts a valid refresh token', () => {
    expect(RefreshSchema.safeParse({ refreshToken: 'a-valid-refresh-token' }).success).toBe(true);
  });

  it('strips unknown fields instead of rejecting, so an out-of-date client is not hard-failed', () => {
    const parsed = RefreshSchema.parse({ refreshToken: 'a-valid-refresh-token', deviceId: 'unknown-future-field' });
    expect(parsed).toEqual({ refreshToken: 'a-valid-refresh-token' });
  });
});
