import {
  CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TokenPayload } from '@ipms/contracts';
import { verifyToken } from '../token.js';
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
      // 'access' is passed explicitly: a refresh token carries the same
      // signature over the same secret and lives 30 days rather than 15
      // minutes, so accepting one here would hand a stolen refresh token a
      // month of authorized requests.
      payload = verifyToken(token, this.secret, 'access');
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
