import {
  CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TokenPayload } from '@ipms/contracts';
import { extractToken, verifyToken, type HeaderCarrier } from '../token.js';
import type { AuthzUser } from '../types.js';

export const IS_PUBLIC_KEY = 'ipms:public';

/** Marks a route (or a whole controller) reachable without a token — health probes, metrics scrapes. */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);

/** Never distinguishes "missing" from "expired" from "bad signature" from "tampered". */
const GENERIC_MESSAGE = 'Authentication required';

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

  // @Inject is explicit rather than reflected: esbuild does not implement
  // `emitDecoratorMetadata` (it has no whole-program type information), so
  // under any esbuild-based runner or bundler a reflected `Reflector` arrives
  // as `undefined` and every guarded request 500s.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

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
