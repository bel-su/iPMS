import { describe, expect, it } from 'vitest';
import { extractToken, signToken, verifyToken, type TokenClaims } from './token.js';
import { JwtUserGuard } from './nest/jwt-user.guard.js';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

describe('Inter-Service Controller Token Extraction & Propagation Stress Test', () => {
  const TEST_SECRET = 'c'.repeat(32);
  const sampleClaims: TokenClaims = {
    sub: '01a1a085-444e-7000-8195-134942618695',
    roles: ['QC_INSPECTOR'],
    permissions: ['qc_submission.view', 'task.view'],
    tokenVersion: 1,
  };

  describe('extractToken Edge Cases & Parsing Rules', () => {
    it('extracts standard Bearer token from authorization header', () => {
      const token = extractToken({
        headers: { authorization: 'Bearer standard-token-123' },
      });
      expect(token).toBe('standard-token-123');
    });

    it('extracts Bearer token with whitespace around token body', () => {
      const token = extractToken({
        headers: { authorization: 'Bearer   padded-token-456   ' },
      });
      expect(token).toBe('padded-token-456');
    });

    it('handles array values in authorization headers (Node HTTP parser behavior)', () => {
      const token = extractToken({
        headers: { authorization: ['Bearer first-token', 'Bearer second-token'] },
      });
      expect(token).toBe('first-token');
    });

    it('returns undefined for non-Bearer authorization schemes', () => {
      expect(extractToken({ headers: { authorization: 'Basic dXNlcjpwYXNz' } })).toBeUndefined();
      expect(extractToken({ headers: { authorization: 'Digest username="Mufasa"' } })).toBeUndefined();
      expect(extractToken({ headers: { authorization: 'ApiKey my-secret-api-key' } })).toBeUndefined();
    });

    it('returns undefined for malformed or empty Bearer headers', () => {
      expect(extractToken({ headers: { authorization: 'Bearer' } })).toBeUndefined();
      expect(extractToken({ headers: { authorization: 'Bearer ' } })).toBeUndefined();
      expect(extractToken({ headers: { authorization: 'Bearer       ' } })).toBeUndefined();
    });

    it('extracts token from ipms_access cookie when authorization header is absent', () => {
      const token = extractToken({
        headers: { cookie: 'ipms_access=cookie-token-789' },
      });
      expect(token).toBe('cookie-token-789');
    });

    it('extracts ipms_access cookie when buried among multiple other cookies', () => {
      const cookieHeader =
        'sessionId=s123; theme=dark; ipms_access=deep-cookie-token; trackingId=t999; lang=en';
      const token = extractToken({
        headers: { cookie: cookieHeader },
      });
      expect(token).toBe('deep-cookie-token');
    });

    it('handles cookies with whitespace around names and values', () => {
      const cookieHeader = 'other=val;  ipms_access =  spaced-cookie-token  ; next=val';
      const token = extractToken({
        headers: { cookie: cookieHeader },
      });
      expect(token).toBe('spaced-cookie-token');
    });

    it('returns undefined for empty cookie value', () => {
      expect(extractToken({ headers: { cookie: 'ipms_access=' } })).toBeUndefined();
      expect(extractToken({ headers: { cookie: 'ipms_access=   ' } })).toBeUndefined();
      expect(extractToken({ headers: { cookie: 'other_cookie=value' } })).toBeUndefined();
    });

    it('prioritizes Authorization header over Cookie header (Mobile/Service override Browser)', () => {
      const token = extractToken({
        headers: {
          authorization: 'Bearer header-priority-token',
          cookie: 'ipms_access=cookie-token',
        },
      });
      expect(token).toBe('header-priority-token');
    });

    it('returns undefined when request headers contain neither auth header nor cookie', () => {
      expect(extractToken({ headers: {} })).toBeUndefined();
      expect(extractToken({ headers: { 'content-type': 'application/json' } })).toBeUndefined();
    });
  });

  describe('Downstream Controller Forwarding Pattern', () => {
    // Helper replicating the standardized controller helper used across project, qc, finance, media
    const formatBearer = (req: { headers: Record<string, string | string[] | undefined> }): string => {
      const token = extractToken(req);
      return token ? `Bearer ${token}` : '';
    };

    it('formats downstream bearer string correctly for Header caller', () => {
      const req = { headers: { authorization: 'Bearer my-jwt-token' } };
      expect(formatBearer(req)).toBe('Bearer my-jwt-token');
    });

    it('formats downstream bearer string correctly for Cookie caller', () => {
      const req = { headers: { cookie: 'ipms_access=my-web-cookie-jwt' } };
      expect(formatBearer(req)).toBe('Bearer my-web-cookie-jwt');
    });

    it('formats downstream bearer string as empty string when unauthenticated', () => {
      const req = { headers: {} };
      expect(formatBearer(req)).toBe('');
    });
  });

  describe('Downstream Receiving Guard Zero-Trust Enforcement', () => {
    process.env['JWT_SECRET'] = TEST_SECRET;
    const reflector = { getAllAndOverride: () => false };
    const makeContext = (headers: Record<string, string | string[] | undefined>): ExecutionContext => {
      const req = { headers };
      return {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
        getHandler: () => () => undefined,
        getClass: () => class {},
      } as unknown as ExecutionContext;
    };

    it('accepts valid signed token forwarded from controller', async () => {
      const validToken = signToken(sampleClaims, 'access', TEST_SECRET, 3600);
      const guard = new JwtUserGuard(reflector as never);

      const context = makeContext({ authorization: `Bearer ${validToken}` });
      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);
    });

    it('accepts valid cookie token forwarded from controller as Bearer header', async () => {
      // Browser had cookie: ipms_access=<token>
      // Controller extracted it and forwarded: Authorization: Bearer <token>
      const cookieToken = signToken(sampleClaims, 'access', TEST_SECRET, 3600);
      const guard = new JwtUserGuard(reflector as never);

      const context = makeContext({ authorization: `Bearer ${cookieToken}` });
      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);
    });

    it('strictly throws UnauthorizedException (401) when forwarded bearer is empty string', async () => {
      const guard = new JwtUserGuard(reflector as never);
      const context = makeContext({ authorization: '' });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('strictly throws UnauthorizedException (401) when authorization header is omitted', async () => {
      const guard = new JwtUserGuard(reflector as never);
      const context = makeContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('strictly throws UnauthorizedException (401) when token is expired or tampered', async () => {
      const expiredToken = signToken(sampleClaims, 'access', TEST_SECRET, -10);
      const guard = new JwtUserGuard(reflector as never);

      const context = makeContext({ authorization: `Bearer ${expiredToken}` });
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });
});
