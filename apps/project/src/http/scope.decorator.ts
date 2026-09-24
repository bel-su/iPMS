import { createParamDecorator, InternalServerErrorException, type ExecutionContext } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';

/**
 * The caller's replicated scope, as resolved by `AuthzGuard`.
 *
 * Throws rather than defaulting when it is absent. An absent scope means the
 * route carries no `@RequirePermission`, so the guard short-circuited and never
 * resolved one -- and every available default is wrong: a permissive default
 * silently disables enforcement, and a deny-everything default presents as a
 * mysterious empty list rather than as the wiring bug it is.
 */
export const ScopeOf = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthzScope => {
  const request = ctx.switchToHttp().getRequest<{ authzScope?: AuthzScope }>();
  if (!request.authzScope) {
    throw new InternalServerErrorException('Route is missing @RequirePermission; no scope was resolved');
  }
  return request.authzScope;
});
