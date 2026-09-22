import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtUserGuard, IS_PUBLIC_KEY } from './jwt-user.guard.js';

const SECRET = 'test-only-fixture-secret-do-not-use-in-prod';
const SUB = '018f0000-0000-7000-8000-000000000001';

const b64 = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const iat = Math.floor(Date.now() / 1000);
  return {
    sub: SUB,
    roles: ['FIELD_ENGINEER'],
    permissions: ['audit.view'],
    tokenVersion: 1,
    typ: 'access',
    iat,
    exp: iat + 900,
    ...overrides,
  };
}

function ctx(request: Record<string, unknown>, isPublic = false): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
    isPublic,
  } as unknown as ExecutionContext;
}

/** A stand-in for @nestjs/core's Reflector: returns whatever @Public() metadata was set. */
function reflectorFor(isPublic: boolean) {
  return { getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? isPublic : undefined) };
}

function request(token?: string, via: 'header' | 'cookie' = 'header'): Record<string, unknown> {
  if (token === undefined) return { headers: {} };
  return via === 'header'
    ? { headers: { authorization: `Bearer ${token}` } }
    : { headers: { cookie: `ipms_access=${token}` } };
}

describe('JwtUserGuard', () => {
  beforeEach(() => {
    process.env['JWT_SECRET'] = SECRET;
  });

  afterEach(() => {
    delete process.env['JWT_SECRET'];
  });

  function guard(isPublic = false): JwtUserGuard {
    const g = new JwtUserGuard(reflectorFor(isPublic) as never);
    return g;
  }

  it('populates request.user with the right id, roles and permissions for a valid token', async () => {
    const token = sign(validPayload());
    const req = request(token);
    await guard().canActivate(ctx(req));
    expect(req['user']).toEqual({
      id: SUB,
      roles: ['FIELD_ENGINEER'],
      permissions: ['audit.view'],
      tokenVersion: 1,
      isActive: true,
    });
  });

  it('reads the token from the ipms_access cookie when no header is present', async () => {
    const token = sign(validPayload());
    const req = request(token, 'cookie');
    await guard().canActivate(ctx(req));
    expect(req['user']).toMatchObject({ id: SUB });
  });

  it('throws UnauthorizedException when no token is present', async () => {
    await expect(guard().canActivate(ctx(request()))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = sign(validPayload(), 'a-completely-different-secret-value');
    await expect(guard().canActivate(ctx(request(token)))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign(validPayload({ iat: now - 1000, exp: now - 1 }));
    await expect(guard().canActivate(ctx(request(token)))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a tampered payload', async () => {
    const token = sign(validPayload());
    const [header, , signature] = token.split('.') as [string, string, string];
    const tamperedBody = b64(JSON.stringify(validPayload({ permissions: ['audit.view', 'audit.verify'] })));
    const tampered = `${header}.${tamperedBody}.${signature}`;
    await expect(guard().canActivate(ctx(request(tampered)))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a @Public() route with no token', async () => {
    await expect(guard(true).canActivate(ctx(request()))).resolves.toBe(true);
  });

  it('never leaks a specific failure reason — missing token', async () => {
    await expect(guard().canActivate(ctx(request()))).rejects.toThrow('Authentication required');
  });

  it('never leaks a specific failure reason — wrong secret', async () => {
    const token = sign(validPayload(), 'wrong-secret');
    await expect(guard().canActivate(ctx(request(token)))).rejects.toThrow('Authentication required');
  });

  it('never leaks a specific failure reason — expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign(validPayload({ iat: now - 1000, exp: now - 1 }));
    await expect(guard().canActivate(ctx(request(token)))).rejects.toThrow('Authentication required');
  });

  it('never leaks a specific failure reason — tampered payload', async () => {
    const token = sign(validPayload());
    const [header, , signature] = token.split('.') as [string, string, string];
    const tamperedBody = b64(JSON.stringify(validPayload({ roles: ['SUPER_ADMIN'] })));
    const tampered = `${header}.${tamperedBody}.${signature}`;
    await expect(guard().canActivate(ctx(request(tampered)))).rejects.toThrow('Authentication required');
  });

  it('never leaks a specific failure reason — malformed token', async () => {
    await expect(guard().canActivate(ctx(request('not-a-jwt')))).rejects.toThrow('Authentication required');
  });

  // A refresh token is signed with the same secret as an access token and
  // lives for 30 days rather than 15 minutes. If this guard accepted one,
  // every service would honour a stolen refresh token for a month — and the
  // gateway's revocation check is the only thing that would ever notice.
  it('rejects a refresh token presented as an access token', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const refresh = sign(validPayload({ typ: 'refresh', exp: iat + 2_592_000 }));
    await expect(guard().canActivate(ctx(request(refresh)))).rejects.toThrow('Authentication required');
  });

  it('rejects a token with no typ claim at all', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const untyped = sign({
      sub: SUB, roles: ['FIELD_ENGINEER'], permissions: ['audit.view'],
      tokenVersion: 1, iat, exp: iat + 900,
    });
    await expect(guard().canActivate(ctx(request(untyped)))).rejects.toThrow('Authentication required');
  });
});

describe('JwtUserGuard and the mustChangePassword claim', () => {
  beforeEach(() => {
    process.env['JWT_SECRET'] = SECRET;
  });

  afterEach(() => {
    delete process.env['JWT_SECRET'];
  });

  /**
   * A user who owes a password change holds a token with no roles and no
   * permissions; a service that wants to say so needs the claim on
   * `request.user` rather than re-parsing the token itself.
   */
  it('copies the claim onto request.user', async () => {
    const token = sign(validPayload({ roles: [], permissions: [], mustChangePassword: true }));
    const req = request(token);
    await new JwtUserGuard(reflectorFor(false) as never).canActivate(ctx(req));
    expect(req['user']).toMatchObject({ roles: [], permissions: [], mustChangePassword: true });
  });

  it('leaves it off an ordinary token rather than setting it false', async () => {
    const req = request(sign(validPayload()));
    await new JwtUserGuard(reflectorFor(false) as never).canActivate(ctx(req));
    expect(req['user']).not.toHaveProperty('mustChangePassword');
  });
});
