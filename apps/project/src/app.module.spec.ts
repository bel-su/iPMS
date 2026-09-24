import { describe, expect, it } from 'vitest';
import { APP_GUARD } from '@nestjs/core';
import { AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER } from '@ipms/authz';
import { AppModule } from './app.module.js';

interface Provider {
  provide: unknown;
  useClass?: unknown;
  useFactory?: (...args: never[]) => unknown;
  useValue?: unknown;
  inject?: unknown[];
}

const isProvider = (v: unknown): v is Provider =>
  typeof v === 'object' && v !== null && 'provide' in v;

/**
 * Reads the module's own `@Module()` metadata rather than booting it, because
 * every factory here dials Postgres, NATS or Redis. Same approach as
 * apps/iam/src/app.module.spec.ts.
 */
const reflectMetadata = Reflect as unknown as { getMetadata(key: string, target: object): unknown };

describe('AppModule', () => {
  const providers = (reflectMetadata.getMetadata('providers', AppModule) as unknown[]).filter(isProvider);

  it('registers JwtUserGuard before AuthzGuard, so request.user exists when AuthzGuard reads it', () => {
    const guards = providers.filter((p) => p.provide === APP_GUARD);
    expect(guards[0]?.useClass).toBe(JwtUserGuard);
    expect(guards[1]?.useClass).toBe(AuthzGuard);
  });

  it('backs SCOPE_PROVIDER with a factory over the projection, not a constant', () => {
    // This was a constant returning an empty, non-global scope. That was
    // harmless only because nothing read it. Now every query is constrained by
    // it, so a constant would either deny everyone or -- if "fixed" to global --
    // hand everyone everything.
    const provider = providers.find((p) => p.provide === SCOPE_PROVIDER);
    expect(provider?.useValue).toBeUndefined();
    expect(typeof provider?.useFactory).toBe('function');
    expect(provider?.inject).toHaveLength(1);
  });

  it('provides OVERRIDE_PROVIDER, without which AuthzGuard cannot be constructed', () => {
    expect(providers.some((p) => p.provide === OVERRIDE_PROVIDER)).toBe(true);
  });

  it('gives every factory provider an inject list matching its arity', () => {
    // A constructor parameter typed with `import type` is erased,
    // emitDecoratorMetadata records `Object`, and Nest fails at bootstrap on an
    // unresolvable token. A factory whose inject list is short fails the same
    // way, and no unit test that constructs the service directly can see it.
    for (const provider of providers) {
      if (typeof provider.useFactory !== 'function') continue;
      if (provider.useFactory.length === 0) continue;
      expect(provider.inject ?? [], String(provider.provide)).toHaveLength(provider.useFactory.length);
    }
  });
});
