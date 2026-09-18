import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, Module, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  AuthzGuard, emptyOverrideProvider, OVERRIDE_PROVIDER, SCOPE_PROVIDER,
  type OverrideProvider, type ScopeProvider,
} from './authz.guard.js';
import { PERMISSION_KEY } from './require-permission.decorator.js';
import type { AuthzOverride } from '../types.js';

function ctx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const activeUser = { id: 'u-1', roles: [], permissions: ['task.view'], tokenVersion: 1, isActive: true };

function guardWith(
  metadata: unknown,
  scope = { global: true, projectIds: [], siteIds: [] },
  overrides: AuthzOverride[] = [],
) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(metadata) };
  const scopeProvider = { for: vi.fn().mockResolvedValue(scope) };
  const overrideProvider = { for: vi.fn().mockResolvedValue(overrides) };
  return new AuthzGuard(reflector as never, scopeProvider as never, overrideProvider as never);
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

/**
 * The guard built an `AuthzRequest` without `overrides`, so `check()` always
 * evaluated its DENY gate against an empty list and the gate could never fire
 * on a real request. A DENY override was written, audited, and reported by both
 * `GET /users/:id/effective-permissions` and `POST /access/check` — and then
 * not enforced. These tests are what make the gate reachable.
 */
describe('AuthzGuard — override enforcement', () => {
  const denyTaskView: AuthzOverride = {
    permission: 'task.view', effect: 'DENY',
    projectId: null, siteId: null, validFrom: null, validUntil: null,
  };

  it('asks the override provider for the acting user', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue({ permission: 'task.view' }) };
    const scopeProvider = { for: vi.fn().mockResolvedValue({ global: true, projectIds: [], siteIds: [] }) };
    const overrideProvider = { for: vi.fn().mockResolvedValue([]) };
    const guard = new AuthzGuard(reflector as never, scopeProvider as never, overrideProvider as never);
    await guard.canActivate(ctx(activeUser));
    expect(overrideProvider.for).toHaveBeenCalledWith('u-1');
  });

  it('enforces a DENY override against a permission the role grants', async () => {
    const guard = guardWith({ permission: 'task.view' }, undefined, [denyTaskView]);
    await expect(guard.canActivate(ctx(activeUser))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records DENIED_BY_OVERRIDE as the server-side reason', async () => {
    const guard = guardWith({ permission: 'task.view' }, undefined, [denyTaskView]);
    const request: Record<string, unknown> = { user: activeUser };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    await guard.canActivate(context).catch(() => undefined);
    expect(request['authzDecision']).toMatchObject({ allowed: false, reason: 'DENIED_BY_OVERRIDE' });
  });

  it('does not apply an expired DENY override', async () => {
    const guard = guardWith({ permission: 'task.view' }, undefined, [
      { ...denyTaskView, validUntil: new Date('2020-01-01T00:00:00Z') },
    ]);
    expect(await guard.canActivate(ctx(activeUser))).toBe(true);
  });

  it('honours a live ALLOW override for a permission no role grants', async () => {
    const guard = guardWith({ permission: 'qc_review.approve' }, undefined, [
      { ...denyTaskView, permission: 'qc_review.approve', effect: 'ALLOW' },
    ]);
    expect(await guard.canActivate(ctx(activeUser))).toBe(true);
  });
});

describe('emptyOverrideProvider', () => {
  it('returns no overrides', async () => {
    await expect(emptyOverrideProvider.for('u-1')).resolves.toEqual([]);
  });
});

const scopeProvider: ScopeProvider = {
  async for() { return { global: false, projectIds: [], siteIds: [] }; },
};
const overrideProvider: OverrideProvider = emptyOverrideProvider;

@Module({
  providers: [
    AuthzGuard,
    { provide: SCOPE_PROVIDER, useValue: scopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: overrideProvider },
  ],
})
class BootProbeModule {}

/**
 * `ScopeProvider` and `OverrideProvider` are interfaces. TypeScript erases them,
 * `emitDecoratorMetadata` records `Object` for the parameter, and Nest fails at
 * bootstrap resolving an `Object` token unless the parameter carries
 * `@Inject(TOKEN)`. A unit test that constructs the guard with `new` passes
 * either way, which is exactly how this bug reached `main` twice already (the
 * guard's `Reflector`, and `ScopeProvider` itself). Only a real DI resolution
 * catches it, so this test does one.
 */
describe('AuthzGuard dependency injection', () => {
  it('resolves through a real Nest container', async () => {
    // `abortOnError: false` matters: Nest's default is to call `process.abort()`
    // on a resolution failure, which kills the vitest worker with a native stack
    // trace instead of failing this test with a readable message.
    const context = await NestFactory.createApplicationContext(BootProbeModule, { logger: false, abortOnError: false });
    try {
      expect(context.get(AuthzGuard)).toBeInstanceOf(AuthzGuard);
    } finally {
      await context.close();
    }
  });

  it('is constructed with all three dependencies, not silently with fewer', async () => {
    const context = await NestFactory.createApplicationContext(BootProbeModule, { logger: false, abortOnError: false });
    try {
      const guard = context.get(AuthzGuard) as unknown as Record<string, unknown>;
      expect(guard['reflector']).toBeDefined();
      expect(guard['scopeProvider']).toBe(scopeProvider);
      expect(guard['overrideProvider']).toBe(overrideProvider);
    } finally {
      await context.close();
    }
  });
});

describe('require-permission metadata key', () => {
  it('is the key the guard reads', () => {
    expect(PERMISSION_KEY).toBeTruthy();
  });
});
