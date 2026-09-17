import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenPayloadSchema, type TokenPayload } from '@ipms/contracts';
import type { AuthzUser } from '../types.js';

export const IS_PUBLIC_KEY = 'ipms:public';

/** Marks a route (or a whole controller) reachable without a token — health probes, metrics scrapes. */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);

const ACCESS_COOKIE = 'ipms_access';

/** Never distinguishes "missing" from "expired" from "bad signature" from "tampered" — see class doc. */
const GENERIC_MESSAGE = 'Authentication required';

interface HeaderCarrier {
  headers: Record<string, string | string[] | undefined>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Header first (mobile / service-to-service callers), then the `ipms_access` cookie (browser). */
function extractToken(request: HeaderCarrier): string | undefined {
  const auth = firstValue(request.headers['authorization']);
  if (auth?.startsWith('Bearer ')) {
    const value = auth.slice(7).trim();
    if (value.length > 0) return value;
  }

  const cookieHeader = firstValue(request.headers['cookie']);
  if (!cookieHeader) return undefined;

  // Parsed by hand rather than requiring a cookie-parser plugin to be registered
  // in every service: the raw `Cookie` header is present regardless of whether
  // one is.
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== ACCESS_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function requireSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

/**
 * Verifies an HS256-signed `header.body.signature` token: recomputes the HMAC
 * over `header.body` and compares it (constant-time) against the supplied
 * signature. Throws on any structural or cryptographic mismatch — malformed
 * token, wrong secret, or a body that was edited after signing.
 */
function verifySignature(token: string, secret: string): unknown {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [header, body, signature] = parts as [string, string, string];

  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    throw new Error('Invalid signature');
  }

  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
}

/**
 * Zero-trust JWT verification, run independently by every service.
 *
 * The gateway authenticates the caller, but it proxies a *new* HTTP request
 * upstream — the authenticated principal does not survive that hop on its
 * own. Rather than trust a header the gateway attaches (which any caller who
 * reaches the service directly could forge), every service verifies the
 * token's HS256 signature and expiry itself. That verification is pure and
 * needs no I/O, so it costs nothing to duplicate.
 *
 * What this guard deliberately does NOT do: check the Redis-held
 * `tokenVersion` for revocation. That check stays at the gateway only. A
 * service accepting a token that was revoked less than its TTL ago (15
 * minutes) is the accepted exposure — duplicating the Redis dependency into
 * every service to close that window was judged not worth it.
 *
 * Must run before `AuthzGuard` (`APP_GUARD` providers execute in
 * registration order): `AuthzGuard` reads `request.user`, which this guard
 * populates.
 */
@Injectable()
export class JwtUserGuard implements CanActivate {
  private readonly secret = requireSecret();

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<HeaderCarrier & { user?: AuthzUser }>();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedException(GENERIC_MESSAGE);

    let payload: TokenPayload;
    try {
      const raw = verifySignature(token, this.secret);
      payload = TokenPayloadSchema.parse(raw);
      if (payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    } catch {
      throw new UnauthorizedException(GENERIC_MESSAGE);
    }

    const user: AuthzUser = {
      id: payload.sub,
      roles: payload.roles,
      permissions: payload.permissions,
      tokenVersion: payload.tokenVersion,
      isActive: true,
    };
    request.user = user;
    return true;
  }
}
