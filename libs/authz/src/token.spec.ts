import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@ipms/contracts';
import { signToken, verifyToken } from './token.js';

const SECRET = 'test-secret-do-not-use-in-production';
const SUB = uuidv7();

function claims(overrides: Record<string, unknown> = {}) {
  return {
    sub: SUB,
    roles: ['FIELD_ENGINEER'],
    permissions: ['task.view'],
    tokenVersion: 3,
    ...overrides,
  };
}

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');

/** Forges a token with an arbitrary header and body, signed correctly for that pair. */
function forge(header: unknown, body: unknown, secret = SECRET): string {
  const h = b64(header);
  const b = b64(body);
  const sig = createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${sig}`;
}

describe('signToken / verifyToken round trip', () => {
  it('verifies an access token it just signed', () => {
    const token = signToken(claims(), 'access', SECRET, 900);
    const payload = verifyToken(token, SECRET, 'access');
    expect(payload.sub).toBe(SUB);
    expect(payload.typ).toBe('access');
    expect(payload.tokenVersion).toBe(3);
  });

  it('verifies a refresh token it just signed', () => {
    const token = signToken(claims(), 'refresh', SECRET, 2_592_000);
    expect(verifyToken(token, SECRET, 'refresh').typ).toBe('refresh');
  });

  it('sets exp from the supplied ttl', () => {
    const payload = verifyToken(signToken(claims(), 'access', SECRET, 900), SECRET, 'access');
    expect(payload.exp - payload.iat).toBe(900);
  });
});

describe('verifyToken — token type confusion', () => {
  // The central reason `typ` exists. A refresh token lives for 30 days; an
  // access token for 15 minutes. Both carry the same signature over the same
  // secret, so without this assertion a stolen refresh token authorizes
  // requests for a month.
  it('refuses a refresh token where an access token is required', () => {
    const refresh = signToken(claims(), 'refresh', SECRET, 2_592_000);
    expect(() => verifyToken(refresh, SECRET, 'access')).toThrow();
  });

  it('refuses an access token where a refresh token is required', () => {
    const access = signToken(claims(), 'access', SECRET, 900);
    expect(() => verifyToken(access, SECRET, 'refresh')).toThrow();
  });

  it('refuses a token whose typ claim was stripped out entirely', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forge({ alg: 'HS256', typ: 'JWT' }, { ...claims(), iat: now, exp: now + 900 });
    expect(() => verifyToken(token, SECRET, 'access')).toThrow();
  });
});

describe('verifyToken — signature', () => {
  it('refuses a token signed with a different secret', () => {
    const token = signToken(claims(), 'access', 'some-other-secret', 900);
    expect(() => verifyToken(token, SECRET, 'access')).toThrow();
  });

  it('refuses a token whose body was edited after signing', () => {
    const token = signToken(claims(), 'access', SECRET, 900);
    const [header, , signature] = token.split('.') as [string, string, string];
    const tampered = b64({ ...claims({ permissions: ['role.delete'] }), typ: 'access', iat: 1, exp: 2 ** 31 });
    expect(() => verifyToken(`${header}.${tampered}.${signature}`, SECRET, 'access')).toThrow();
  });

  it('refuses a token whose header was edited after signing', () => {
    const token = signToken(claims(), 'access', SECRET, 900);
    const [, body, signature] = token.split('.') as [string, string, string];
    expect(() => verifyToken(`${b64({ alg: 'none' })}.${body}.${signature}`, SECRET, 'access')).toThrow();
  });

  // The header is never consulted to choose an algorithm — verification is
  // hard-wired to HMAC-SHA256. A caller who sets `alg: none` and strips the
  // signature therefore fails on the signature comparison, not on a header
  // check that a future edit could remove.
  it('refuses an alg:none token with an empty signature', () => {
    const now = Math.floor(Date.now() / 1000);
    const body = b64({ ...claims(), typ: 'access', iat: now, exp: now + 900 });
    expect(() => verifyToken(`${b64({ alg: 'none' })}.${body}.`, SECRET, 'access')).toThrow();
  });

  it('refuses a signature of a different length without throwing a range error', () => {
    const token = signToken(claims(), 'access', SECRET, 900);
    const [header, body] = token.split('.') as [string, string];
    expect(() => verifyToken(`${header}.${body}.short`, SECRET, 'access')).toThrow(/signature/i);
  });

  it.each([['empty', ''], ['one part', 'abc'], ['two parts', 'a.b'], ['four parts', 'a.b.c.d']])(
    'refuses a structurally malformed token (%s)',
    (_label, token) => {
      expect(() => verifyToken(token, SECRET, 'access')).toThrow();
    },
  );
});

describe('verifyToken — expiry and payload shape', () => {
  it('refuses an expired token', () => {
    const token = signToken(claims(), 'access', SECRET, -1);
    expect(() => verifyToken(token, SECRET, 'access')).toThrow(/expired/i);
  });

  it('accepts a token that expires one second from now', () => {
    expect(verifyToken(signToken(claims(), 'access', SECRET, 1), SECRET, 'access').sub).toBe(SUB);
  });

  it('refuses a correctly signed token whose payload fails the schema', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forge(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'not-a-uuid', roles: [], permissions: [], tokenVersion: 1, typ: 'access', iat: now, exp: now + 900 },
    );
    expect(() => verifyToken(token, SECRET, 'access')).toThrow();
  });

  it('refuses a negative tokenVersion, which could never be a real revocation counter', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forge(
      { alg: 'HS256', typ: 'JWT' },
      { ...claims({ tokenVersion: -1 }), typ: 'access', iat: now, exp: now + 900 },
    );
    expect(() => verifyToken(token, SECRET, 'access')).toThrow();
  });

  it('strips a scope list smuggled into a validly signed token', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forge(
      { alg: 'HS256', typ: 'JWT' },
      { ...claims(), typ: 'access', iat: now, exp: now + 900, siteIds: ['s-1'], global: true },
    );
    const payload = verifyToken(token, SECRET, 'access');
    expect(payload).not.toHaveProperty('siteIds');
    expect(payload).not.toHaveProperty('global');
  });
});

describe('the mustChangePassword claim', () => {
  it('round-trips when set', () => {
    const token = signToken(claims({ mustChangePassword: true }), 'access', SECRET, 900);
    expect(verifyToken(token, SECRET, 'access').mustChangePassword).toBe(true);
  });

  // Tokens minted before this field existed must keep verifying, so it is
  // absent rather than false — and an ordinary token's bytes are unchanged.
  it('is absent, not false, when it was never set', () => {
    const token = signToken(claims(), 'access', SECRET, 900);
    expect(verifyToken(token, SECRET, 'access').mustChangePassword).toBeUndefined();
  });
});
