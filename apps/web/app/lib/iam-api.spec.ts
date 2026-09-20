import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));

const { getCurrentUser, hasPermission } = await import('./iam-api');

const USER = { id: 'u-1', roles: ['ENGINEER'], permissions: ['project.view'], tokenVersion: 1, isActive: true };

beforeEach(() => { authFetch.mockClear(); });

describe('getCurrentUser', () => {
  // '/api/v1/auth/me' is routed by the gateway but is NOT in its public path
  // set, so this call carries the token like any other.
  it('reads the caller’s identity from iam through the gateway', async () => {
    authFetch.mockResolvedValueOnce({ state: 'ready', data: USER });
    expect(await getCurrentUser()).toEqual({ state: 'ready', data: USER });
    expect(authFetch.mock.calls[0]).toEqual(['/api/v1/auth/me']);
  });

  it('reports an unauthenticated caller rather than throwing', async () => {
    authFetch.mockResolvedValueOnce({ state: 'unauthenticated' });
    expect(await getCurrentUser()).toEqual({ state: 'unauthenticated' });
  });
});

describe('hasPermission', () => {
  it('is true for a permission the user holds', () => {
    expect(hasPermission(USER, 'project.view')).toBe(true);
  });

  it('is false for one they do not', () => {
    expect(hasPermission(USER, 'project.create')).toBe(false);
  });

  // A deactivated user keeps their role list until it is edited; every service
  // refuses them regardless, so the UI must not offer the control either.
  it('is false for every permission of a deactivated user', () => {
    expect(hasPermission({ ...USER, isActive: false }, 'project.view')).toBe(false);
  });
});
