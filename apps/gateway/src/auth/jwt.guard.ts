import {
  CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  extractToken, verifyToken, IS_PUBLIC_KEY,
  type AuthzUser, type HeaderCarrier,
} from '@ipms/authz';
import type { TokenPayload } from '@ipms/contracts';
import { createLogger } from '@ipms/observability';
import { isPublicPath } from '../proxy/routes.js';

const log = createLogger('gateway');

/** Never distinguishes missing from expired from revoked — see the class doc. */
const GENERIC = 'Authentication required';

export const TOKEN_VERSIONS = 'GATEWAY_TOKEN_VERSIONS';

/**
 * Reads the revocation counter iam publishes for each user.
 *
 * `read` resolves to the stored version, or `undefined` when there is no entry.
 * It must **throw** rather than return `undefined` if the store itself is
 * unreachable: the two cases get opposite treatment below, so collapsing them
 * would turn a Redis outage into a silent authorization bypass.
 */
export interface TokenVersionReader {
  read(userId: string): Promise<number | undefined>;
}

/**
 * The gateway's authentication hop: verify the token, then check it has not
 * been revoked.
 *
 * Revocation fails **closed**, and that is the whole point of this guard
 * existing on top of each service's own `JwtUserGuard`. iam publishes a user's
 * `tokenVersion` on every token issuance with a TTL outlasting a refresh
 * token, so any user holding a live token has an entry. A missing entry
 * therefore means the session was revoked, or the record aged out past any
 * token's lifetime — in both cases the token must not be honoured. Treating a
 * missing entry as "no revocation on record, allow" (the original shape) meant
 * a Redis eviction or restart erased every revocation and reinstated exactly
 * the tokens the mechanism existed to kill.
 *
 * A store *error* is also refused, for the same reason: if the gateway cannot
 * tell whether a token was revoked, it is not entitled to assume it was not.
 * That makes Redis a hard dependency of authenticated traffic, which is why
 * it is a readiness check — an unreachable Redis should take the gateway out
 * of the load balancer rather than quietly widen access.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    // Both dependencies are injected by explicit token, and neither @Inject is
    // optional.
    //
    // `TokenVersionReader` is an interface: TypeScript erases it, so
    // `emitDecoratorMetadata` would record `Object` and Nest could not resolve
    // it at all.
    //
    // `Reflector` is a real class, so reflected injection *would* work — but
    // only under a compiler that implements `emitDecoratorMetadata`. esbuild
    // does not, by design, because it never has whole-program type
    // information. Any esbuild-based runner or bundler (tsx, vitest, an
    // esbuild bundle step in a Dockerfile) therefore injects `undefined` here
    // and the guard fails open-ish with a 500 on every request. Naming the
    // token makes the injection independent of the toolchain.
    @Inject(TOKEN_VERSIONS) private readonly versions: TokenVersionReader,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {
    const secret = process.env['JWT_SECRET'];
    if (!secret) throw new Error('JWT_SECRET is not set');
    this.secret = secret;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<
      HeaderCarrier & { url?: string; user?: AuthzUser }
    >();

    // Login and refresh must be reachable without a token, or no caller could
    // ever obtain one. `@Public()` cannot mark them: a single catch-all handler
    // serves every proxied path, so the exemption has to be keyed on the URL.
    // The list is matched exactly, never by prefix — see PUBLIC_PATHS.
    if (request.url !== undefined && isPublicPath(request.url)) return true;

    const token = extractToken(request);
    if (!token) throw new UnauthorizedException(GENERIC);

    let payload: TokenPayload;
    try {
      // 'access' explicitly: a refresh token is signed with the same secret
      // and lives 30 days rather than 15 minutes.
      payload = verifyToken(token, this.secret, 'access');
    } catch {
      throw new UnauthorizedException(GENERIC);
    }

    let current: number | undefined;
    try {
      current = await this.versions.read(payload.sub);
    } catch (err) {
      log.error({ err, sub: payload.sub }, 'token version store unreachable; refusing request');
      throw new UnauthorizedException(GENERIC);
    }

    if (current === undefined || current !== payload.tokenVersion) {
      throw new UnauthorizedException(GENERIC);
    }

    request.user = {
      id: payload.sub,
      roles: payload.roles,
      permissions: payload.permissions,
      tokenVersion: payload.tokenVersion,
      // True by construction rather than by assumption: login refuses an
      // inactive user, and any path that deactivates one must call
      // AuthService.revokeAll, which bumps the published version and so fails
      // the comparison above. Deactivation without that call would leave this
      // claiming an inactive user is active.
      isActive: true,
    };
    return true;
  }
}
