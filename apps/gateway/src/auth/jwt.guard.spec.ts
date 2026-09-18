import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { signToken, IS_PUBLIC_KEY } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { JwtGuard, type TokenVersionReader } from './jwt.guard.js';

const SECRET = 'gateway-test-secret-not-for-production';
const SUB = uuidv7();

function claims(tokenVersion = 1) {
  return { sub: SUB, roles: ['FIELD_ENGINEER'], permissions: ['task.view'], tokenVersion };
}

function ctx(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function reflectorFor(isPublic: boolean) {
  return { getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? isPublic : undefined) };
}

function guard(versions: TokenVersionReader, isPublic = false): JwtGuard {
  return new JwtGuard(versions, reflectorFor(isPublic) as never);
}

/** Resolves a stored version. */
const storeWith = (version: number | undefined): TokenVersionReader => ({
  read: vi.fn().mockResolvedValue(version),
});

/** Models the store being unreachable, which must be distinguishable from "no entry". */
const brokenStore = (): TokenVersionReader => ({
  read: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
});

function headerRequest(token: string): Record<string, unknown> {
  return { headers: { authorization: `Bearer ${token}` } };
}

describe('JwtGuard — happy path', () => {
  beforeEach(() => { process.env['JWT_SECRET'] = SECRET; });
  afterEach(() => { delete process.env['JWT_SECRET']; });

  it('admits a valid token whose version matches the published one', async () => {
    const req = headerRequest(signToken(claims(4), 'access', SECRET, 900));
    await expect(guard(storeWith(4)).canActivate(ctx(req))).resolves.toBe(true);
  });

  it('populates request.user from the token', async () => {
    const req = headerRequest(signToken(claims(1), 'access', SECRET, 900));
    await guard(storeWith(1)).canActivate(ctx(req));
    expect(req['user']).toEqual({
      id: SUB, roles: ['FIELD_ENGINEER'], permissions: ['task.view'],
      tokenVersion: 1, isActive: true,
    });
  });

  it('reads the token from the ipms_access cookie when there is no header', async () => {
    const token = signToken(claims(1), 'access', SECRET, 900);
    const req = { headers: { cookie: `other=x; ipms_access=${token}` } };
    await expect(guard(storeWith(1)).canActivate(ctx(req))).resolves.toBe(true);
  });

  it('lets a @Public() route through with no token and never touches the store', async () => {
    const store = storeWith(1);
    await expect(guard(store, true).canActivate(ctx({ headers: {} }))).resolves.toBe(true);
    expect(store.read).not.toHaveBeenCalled();
  });
});

describe('JwtGuard — revocation fails closed', () => {
  beforeEach(() => { process.env['JWT_SECRET'] = SECRET; });
  afterEach(() => { delete process.env['JWT_SECRET']; });

  it('refuses a token whose version is behind the published one', async () => {
    const req = headerRequest(signToken(claims(1), 'access', SECRET, 900));
    await expect(guard(storeWith(2)).canActivate(ctx(req)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  /**
   * The defect this guard was rewritten to fix. iam publishes a version on
   * every issuance with a TTL outlasting a refresh token, so a live token
   * always has an entry — a missing one means the session was revoked or the
   * record aged out. Treating absence as "nothing revoked, allow" meant one
   * Redis eviction or restart silently reinstated every revoked token.
   */
  it('refuses a token when the store holds no entry for the user', async () => {
    const req = headerRequest(signToken(claims(1), 'access', SECRET, 900));
    await expect(guard(storeWith(undefined)).canActivate(ctx(req)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses the request when the store itself is unreachable', async () => {
    const req = headerRequest(signToken(claims(1), 'access', SECRET, 900));
    await expect(guard(brokenStore()).canActivate(ctx(req)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('JwtGuard — token validity', () => {
  beforeEach(() => { process.env['JWT_SECRET'] = SECRET; });
  afterEach(() => { delete process.env['JWT_SECRET']; });

  it('refuses a request with no token at all', async () => {
    await expect(guard(storeWith(1)).canActivate(ctx({ headers: {} })))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a token signed with a different secret', async () => {
    const req = headerRequest(signToken(claims(1), 'access', 'a-different-secret', 900));
    await expect(guard(storeWith(1)).canActivate(ctx(req)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an expired token', async () => {
    const req = headerRequest(signToken(claims(1), 'access', SECRET, -1));
    await expect(guard(storeWith(1)).canActivate(ctx(req)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  /**
   * A refresh token is signed with the same secret and lives 30 days. The
   * gateway previously verified with `jsonwebtoken` and never looked at `typ`,
   * so a stolen refresh token authorized requests for a month.
   */
  it('refuses a refresh token presented as an access token', async () => {
    const req = headerRequest(signToken(claims(1), 'refresh', SECRET, 2_592_000));
    await expect(guard(storeWith(1)).canActivate(ctx(req)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a malformed token without consulting the store', async () => {
    const store = storeWith(1);
    await expect(guard(store).canActivate(ctx(headerRequest('not-a-jwt'))))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.read).not.toHaveBeenCalled();
  });

  it.each([
    ['missing token', {}],
    ['bad signature', { authorization: `Bearer ${signToken(claims(1), 'access', 'wrong', 900)}` }],
  ])('gives the same generic message for %s', async (_label, headers) => {
    await expect(guard(storeWith(1)).canActivate(ctx({ headers })))
      .rejects.toThrow('Authentication required');
  });

  it('refuses to construct without JWT_SECRET, rather than running unauthenticated', () => {
    delete process.env['JWT_SECRET'];
    expect(() => guard(storeWith(1))).toThrow(/JWT_SECRET/);
  });
});
