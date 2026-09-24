import {
  CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException,
} from '@nestjs/common';
// A real (not `import type`) binding: Nest resolves this constructor parameter via
// `design:paramtypes` reflection, which needs the runtime class reference — an
// `import type` erases it, leaving `Object` in the emitted metadata and breaking DI
// at real bootstrap even though unit tests (which construct the guard directly) never
// notice (see apps/audit/src/api/audit.controller.ts for the same trap with PrismaClient).
import { Reflector } from '@nestjs/core';
import { check } from '../evaluate.js';
import type { AuthzOverride, AuthzScope, AuthzUser } from '../types.js';
import { PERMISSION_KEY, type PermissionMetadata } from './require-permission.decorator.js';

export interface ScopeProvider {
  for(userId: string): Promise<AuthzScope>;
}

export const SCOPE_PROVIDER = Symbol('SCOPE_PROVIDER');

/**
 * Supplies the user's permission overrides so `check()` can evaluate its DENY
 * gate against real rows.
 *
 * Only *scoped* overrides need to travel this way. Global ones
 * (`projectId === null && siteId === null`) are already folded into the JWT
 * `permissions` claim by `resolvePermissions` at token issuance, so a provider
 * that returns only scoped rows — or none at all, in a service that owns no
 * project/site resources — enforces global suspensions correctly regardless.
 */
export interface OverrideProvider {
  for(userId: string): Promise<AuthzOverride[]>;
}

export const OVERRIDE_PROVIDER = Symbol('OVERRIDE_PROVIDER');

/**
 * The default for a service that cannot yet read override rows.
 *
 * This is the *least* permissive option available to such a service, not a
 * permissive stub: global overrides are resolved into the token claim, so
 * nothing is silently unenforced by returning `[]` — only project/site-scoped
 * overrides go unapplied, and a service with no project/site resources never
 * passes a `resource` to `check()` for one to apply to. Cross-service override
 * replication over NATS is sub-project 2's work.
 *
 * Returning a fabricated ALLOW here, or skipping the seam entirely, would be
 * the unsafe direction.
 */
export const emptyOverrideProvider: OverrideProvider = {
  async for(): Promise<AuthzOverride[]> {
    return [];
  },
};

@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SCOPE_PROVIDER) private readonly scopeProvider: ScopeProvider,
    // `@Inject` is mandatory, not stylistic: `OverrideProvider` is an interface,
    // TypeScript erases it, `emitDecoratorMetadata` records `Object`, and Nest
    // fails at bootstrap on an unresolvable token. See the DI test in
    // authz.guard.spec.ts — a `new AuthzGuard(...)` unit test cannot catch this.
    @Inject(OVERRIDE_PROVIDER) private readonly overrideProvider: OverrideProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<PermissionMetadata | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AuthzUser; authzDecision?: unknown; authzScope?: AuthzScope;
    }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Authentication required');

    const [scope, overrides] = await Promise.all([
      this.scopeProvider.for(user.id),
      this.overrideProvider.for(user.id),
    ]);

    const decision = check({
      user,
      permission: metadata.permission,
      scope,
      // Without this, `check()`'s DENY gate evaluates against `[]` on every real
      // request and can never fire — the defect this seam exists to close.
      overrides,
      ...(metadata.requireAssignment === undefined ? {} : { requireAssignment: metadata.requireAssignment }),
    });

    request.authzDecision = decision;

    /**
     * The guard has already resolved this user's replicated scope to answer the
     * permission question. Handlers need the same value to constrain their
     * queries -- `scopeWhere(scope)` is the platform's actual authorization
     * boundary, because `check()` returns allowed as soon as the permission is
     * held when no resource is passed, and this guard passes none.
     *
     * Stashed rather than re-read, so a handler cannot see a different scope
     * from the one the guard just decided on. Two independent reads either side
     * of a concurrent revocation would disagree, and the handler's read is the
     * one that governs what data leaves the process.
     */
    request.authzScope = scope;

    // The reason is recorded server-side but never returned to the client.
    if (!decision.allowed) throw new ForbiddenException('Forbidden');
    return true;
  }
}
