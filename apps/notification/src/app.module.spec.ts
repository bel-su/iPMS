import { describe, expect, it } from 'vitest';
import { APP_GUARD } from '@nestjs/core';
import { AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER } from '@ipms/authz';
import { AppModule } from './app.module.js';

interface ClassProvider {
  provide: unknown;
  useClass?: unknown;
}

function isClassProvider(value: unknown): value is ClassProvider {
  return typeof value === 'object' && value !== null && 'provide' in value;
}

/**
 * `reflect-metadata` is a transitive dependency (pulled in by `@nestjs/common`,
 * which side-effect-imports it) rather than one `notification` declares directly, so it
 * cannot be `import`ed here under pnpm's isolated node_modules — but the polyfill
 * is already installed on the global `Reflect` object by the time this file runs
 * (this file's own `@nestjs/core` import guarantees it). This narrow cast is only
 * to give `Reflect.getMetadata` a type; no module resolution is involved.
 */
const reflectMetadata = Reflect as unknown as { getMetadata(key: string, target: object): unknown };

/**
 * Proves the guards are wired, not just declared. `audit` once shipped
 * `@RequirePermission(...)` decorators with no guard registered anywhere, so
 * they were inert metadata and its API was unprotected at the service level.
 * Reading the module's own `@Module()` metadata rather than boot-testing keeps
 * this from needing Postgres, NATS or Redis.
 */
describe('AppModule guard registration', () => {
  const providers = reflectMetadata.getMetadata('providers', AppModule) as unknown[];

  it('registers exactly two APP_GUARD providers', () => {
    const guards = providers.filter(isClassProvider).filter((p) => p.provide === APP_GUARD);
    expect(guards).toHaveLength(2);
  });

  it('registers JwtUserGuard before AuthzGuard, so request.user exists before AuthzGuard reads it', () => {
    const guards = providers.filter(isClassProvider).filter((p) => p.provide === APP_GUARD);
    expect(guards[0]?.useClass).toBe(JwtUserGuard);
    expect(guards[1]?.useClass).toBe(AuthzGuard);
  });

  it('provides SCOPE_PROVIDER for AuthzGuard to inject', () => {
    expect(providers.filter(isClassProvider).some((p) => p.provide === SCOPE_PROVIDER)).toBe(true);
  });

  it('provides OVERRIDE_PROVIDER, without which the module fails at bootstrap', () => {
    expect(providers.filter(isClassProvider).some((p) => p.provide === OVERRIDE_PROVIDER)).toBe(true);
  });
});
