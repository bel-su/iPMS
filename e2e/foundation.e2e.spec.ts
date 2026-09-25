import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

const ADMIN = { email: 'admin@ipms.local', password: DEMO_PASSWORD };

let adminToken: string;

beforeAll(async () => {
  await waitForReady();
  const login = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: ADMIN });
  expect(login.status).toBe(201);
  adminToken = login.body.accessToken;
}, 90_000);

describe('authentication', () => {
  it('rejects bad credentials with 401', async () => {
    const res = await api('/api/v1/auth/login', {
      method: 'POST', body: { email: 'admin@ipms.local', password: 'wrong-password' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated protected request', async () => {
    expect((await api('/api/v1/roles')).status).toBe(401);
  });

  it('returns a uniform error envelope with a correlation id', async () => {
    const res = await api<{ error: { code: string; correlationId: string } }>('/api/v1/roles');
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('accepts an authenticated request', async () => {
    expect((await api('/api/v1/roles', { token: adminToken })).status).toBe(200);
  });
});

describe('authorization', () => {
  it('seeds the five system roles', async () => {
    const res = await api<Array<{ code: string }>>('/api/v1/roles', { token: adminToken });
    expect(res.body.map((r) => r.code).sort()).toEqual(
      expect.arrayContaining(['FIELD_ENGINEER', 'PROJECT_MANAGER', 'QC_MANAGER', 'SUPER_ADMIN', 'VIEWER']),
    );
  });

  it('denies a field engineer the roles endpoint with 403, not 401', async () => {
    const login = await api<{ accessToken: string }>('/api/v1/auth/login', {
      method: 'POST', body: { email: 'engineer@ipms.local', password: DEMO_PASSWORD },
    });
    const res = await api('/api/v1/roles', { token: login.body.accessToken });
    expect(res.status).toBe(403);
  });

  it('rejects a role whose permission set breaks a dependency', async () => {
    // qc_review.approve depends on qc_review.view and qc_submission.view.
    const res = await api<{ error: { message: string } }>('/api/v1/roles', {
      method: 'POST', token: adminToken,
      body: { name: 'Broken', code: 'BROKEN_ROLE', description: '', permissionCodes: ['qc_review.approve'] },
    });
    expect(res.status).toBe(400);
    // An unknown code is also a 400, so the status alone cannot tell this
    // rejection apart from a stale code in the request.
    expect(res.body.error.message).toMatch(/Permission set is incomplete/);
  });

  it('refuses to delete a system role', async () => {
    const roles = await api<Array<{ id: string; code: string }>>('/api/v1/roles', { token: adminToken });
    const superAdmin = roles.body.find((r) => r.code === 'SUPER_ADMIN')!;
    const res = await api(`/api/v1/roles/${superAdmin.id}`, { method: 'DELETE', token: adminToken });
    expect(res.status).toBe(403);
  });
});

describe('access simulator', () => {
  it('explains a granted decision with its check chain', async () => {
    const me = await api<{ id: string }>('/api/v1/auth/me', { token: adminToken });
    const res = await api<{ allowed: boolean; reason: string; checks: unknown[] }>('/api/v1/access/check', {
      method: 'POST', token: adminToken,
      body: { userId: me.body.id, permissionCode: 'role.view' },
    });
    expect(res.body.allowed).toBe(true);
    expect(res.body.reason).toBe('ALLOWED');
    expect(res.body.checks.length).toBeGreaterThan(0);
  });

  it('explains a denied decision by naming the failing gate', async () => {
    const engineer = await api<{ items: Array<{ id: string; email: string }> }>(
      '/api/v1/users?search=engineer', { token: adminToken },
    );
    const target = engineer.body.items.find((u) => u.email === 'engineer@ipms.local')!;
    const res = await api<{ allowed: boolean; reason: string }>('/api/v1/access/check', {
      method: 'POST', token: adminToken,
      body: { userId: target.id, permissionCode: 'role.delete' },
    });
    expect(res.body.allowed).toBe(false);
    expect(res.body.reason).toBe('PERMISSION_MISSING');
  });
});

describe('audit ledger', () => {
  it('records a role creation as an audit event', async () => {
    const code = `E2E_ROLE_${Date.now()}`;
    const created = await api<{ id: string }>('/api/v1/roles', {
      method: 'POST', token: adminToken,
      body: { name: 'E2E Role', code, description: '', permissionCodes: ['project.view'] },
    });
    expect(created.status).toBe(201);

    // The outbox drainer polls every 500ms; allow for the round trip.
    await new Promise((r) => setTimeout(r, 3000));

    const events = await api<{ items: Array<{ action: string; objectId: string }> }>(
      `/api/v1/audit/events?objectType=Role&objectId=${created.body.id}`, { token: adminToken },
    );
    expect(events.body.items.some((e) => e.action === 'role.created')).toBe(true);
  }, 30_000);

  it('reports the chain as intact', async () => {
    const res = await api<{ valid: boolean; brokenAtSequence: number | null }>('/api/v1/audit/verify', { token: adminToken });
    expect(res.body).toEqual({ valid: true, brokenAtSequence: null });
  });

  it('exposes no endpoint that mutates the ledger', async () => {
    const del = await api('/api/v1/audit/events/1', { method: 'DELETE', token: adminToken });
    expect(del.status).toBe(404);
  });
});

describe('revocation', () => {
  it('invalidates outstanding tokens on logout', async () => {
    const login = await api<{ accessToken: string }>('/api/v1/auth/login', {
      method: 'POST', body: { email: 'manager@ipms.local', password: DEMO_PASSWORD },
    });
    const token = login.body.accessToken;
    expect((await api('/api/v1/auth/me', { token })).status).toBe(200);

    await api('/api/v1/auth/logout', { method: 'POST', token });

    expect((await api('/api/v1/auth/me', { token })).status).toBe(401);
  });
});
