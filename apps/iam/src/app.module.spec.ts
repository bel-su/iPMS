import { describe, expect, it } from 'vitest';
import { APP_GUARD } from '@nestjs/core';
import { AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER } from '@ipms/authz';
import { AppModule } from './app.module.js';

interface Provider {
  provide: unknown;
  useClass?: unknown;
  useFactory?: unknown;
  useValue?: unknown;
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'object' && value !== null && 'provide' in value;
}

/** See the same note in apps/audit/src/app.module.spec.ts. */
const reflectMetadata = Reflect as unknown as { getMetadata(key: string, target: object): unknown };

/**
 * Reads the module's own `@Module()` metadata — the metadata Nest's container
 * reads to build the app — rather than booting it, because every factory in
 * this module dials Postgres, NATS or Redis. The DI hazard itself (an interface
 * parameter with no `@Inject`) is boot-tested in
 * libs/authz/src/nest/authz.guard.spec.ts, against a real container.
 */
describe('AppModule guard registration', () => {
  const providers = reflectMetadata.getMetadata('providers', AppModule) as unknown[];
  const registered = providers.filter(isProvider);

  it('registers JwtUserGuard before AuthzGuard, so request.user exists before AuthzGuard reads it', () => {
    const guards = registered.filter((p) => p.provide === APP_GUARD);
    expect(guards[0]?.useClass).toBe(JwtUserGuard);
    expect(guards[1]?.useClass).toBe(AuthzGuard);
  });

  it('provides SCOPE_PROVIDER for AuthzGuard to inject', () => {
    expect(registered.some((p) => p.provide === SCOPE_PROVIDER)).toBe(true);
  });

  /**
   * Without this token the app does not boot at all, since `AuthzGuard` injects
   * it. With a *stubbed* one it would boot and silently stop enforcing every
   * override — so iam, which owns the table, must back it with a real query.
   */
  it('provides OVERRIDE_PROVIDER, backed by a factory over the override table', () => {
    const provider = registered.find((p) => p.provide === OVERRIDE_PROVIDER);
    expect(provider).toBeDefined();
    expect(typeof provider?.useFactory).toBe('function');
  });
});
