import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { AuthzGuard } from './authz.guard.js';
import { PERMISSION_KEY } from './require-permission.decorator.js';

function ctx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const activeUser = { id: 'u-1', roles: [], permissions: ['task.view'], tokenVersion: 1, isActive: true };

function guardWith(metadata: unknown, scope = { global: true, projectIds: [], siteIds: [] }) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(metadata) };
  const scopeProvider = { for: vi.fn().mockResolvedValue(scope) };
  return new AuthzGuard(reflector as never, scopeProvider as never);
}

describe('AuthzGuard', () => {
  it('allows a route with no permission metadata', async () => {
    expect(await guardWith(undefined).canActivate(ctx(activeUser))).toBe(true);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const guard = guardWith({ permission: 'task.view' });
    await expect(guard.canActivate(ctx(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows when the user holds the permission', async () => {
    const guard = guardWith({ permission: 'task.view' });
    expect(await guard.canActivate(ctx(activeUser))).toBe(true);
  });

  it('rejects with 403 when the permission is missing', async () => {
    const guard = guardWith({ permission: 'task.delete' });
    await expect(guard.canActivate(ctx(activeUser))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not leak the reason in the client-facing message', async () => {
    const guard = guardWith({ permission: 'task.delete' });
    await expect(guard.canActivate(ctx(activeUser))).rejects.toThrow('Forbidden');
  });

  it('attaches the decision to the request for downstream handlers', async () => {
    const guard = guardWith({ permission: 'task.view' });
    const request: Record<string, unknown> = { user: activeUser };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    await guard.canActivate(context);
    expect(request['authzDecision']).toMatchObject({ allowed: true, reason: 'ALLOWED' });
  });
});
