import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

/** Pulled out of the decorator so it can be tested without a Nest execution context. */
export function userIdFrom(request: { user?: { id: string } }): string {
  if (!request.user) throw new UnauthorizedException('Authentication required');
  return request.user.id;
}

/**
 * The caller, from the token `JwtUserGuard` verified. Handlers take their
 * recipient id from here and never from the URL or body, which is what keeps a
 * user from naming someone else's notifications.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    userIdFrom(context.switchToHttp().getRequest<{ user?: { id: string } }>()),
);
