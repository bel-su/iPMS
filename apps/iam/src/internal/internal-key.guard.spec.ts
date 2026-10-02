import { afterEach, describe, expect, it, vi } from 'vitest';
import { InternalKeyGuard } from './internal-key.guard.js';

function context(headers: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as never;
}

afterEach(() => vi.unstubAllEnvs());

describe('InternalKeyGuard', () => {
  it('accepts the configured key', () => {
    vi.stubEnv('INTERNAL_SERVICE_KEY', 'k-123');
    expect(new InternalKeyGuard().canActivate(context({ 'x-internal-key': 'k-123' }))).toBe(true);
  });

  it('refuses a missing, wrong or repeated header', () => {
    vi.stubEnv('INTERNAL_SERVICE_KEY', 'k-123');
    const guard = new InternalKeyGuard();
    expect(() => guard.canActivate(context({}))).toThrow('Authentication required');
    expect(() => guard.canActivate(context({ 'x-internal-key': 'k-124' }))).toThrow('Authentication required');
    expect(() => guard.canActivate(context({ 'x-internal-key': ['k-123', 'k-123'] }))).toThrow('Authentication required');
  });

  it('refuses everything when no key is configured outside production', () => {
    vi.stubEnv('INTERNAL_SERVICE_KEY', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => new InternalKeyGuard().canActivate(context({ 'x-internal-key': '' }))).toThrow('Authentication required');
  });

  it('refuses to start in production without a key', () => {
    vi.stubEnv('INTERNAL_SERVICE_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new InternalKeyGuard()).toThrow('INTERNAL_SERVICE_KEY is not set');
  });
});
