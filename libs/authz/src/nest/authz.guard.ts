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
import type { AuthzScope, AuthzUser } from '../types.js';
import { PERMISSION_KEY, type PermissionMetadata } from './require-permission.decorator.js';

export interface ScopeProvider {
  for(userId: string): Promise<AuthzScope>;
}

export const SCOPE_PROVIDER = Symbol('SCOPE_PROVIDER');

@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SCOPE_PROVIDER) private readonly scopeProvider: ScopeProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<PermissionMetadata | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthzUser; authzDecision?: unknown }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Authentication required');

    const decision = check({
      user,
      permission: metadata.permission,
      scope: await this.scopeProvider.for(user.id),
      ...(metadata.requireAssignment === undefined ? {} : { requireAssignment: metadata.requireAssignment }),
    });

    request.authzDecision = decision;

    // The reason is recorded server-side but never returned to the client.
    if (!decision.allowed) throw new ForbiddenException('Forbidden');
    return true;
  }
}
