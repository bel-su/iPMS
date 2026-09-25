import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

/**
 * Query-level scope enforcement, end to end through the gateway.
 *
 * This is the only suite that exercises the path unit tests cannot reach: a
 * grant written in `iam`, published to NATS, consumed by `project` into its own
 * database, changing what an HTTP request returns. Two defects lived through
 * fully-passing unit suites because those mock the broker — a filter collision
 * that stopped revocations replicating, and a dedupe store that silently
 * suppressed the cold-start replay. Both are asserted here.
 *
 * Reads `engineer`, who the seed deliberately leaves unscoped, and grants
 * through `admin`, who the seed gives global reach.
 */

interface Project { id: string; code: string }

async function login(username: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', {
    method: 'POST', body: { username, password: DEMO_PASSWORD },
  });
  expect(res.status, `${username} login`).toBe(201);
  return res.body.accessToken;
}

const projectsFor = async (token: string): Promise<Project[]> =>
  (await api<Project[]>('/api/v1/projects', { token })).body;

async function grant(token: string, userId: string, projectId: string): Promise<number> {
  const res = await api(`/api/v1/users/${userId}/projects`, {
    method: 'POST', token, body: { level: 'PROJECT', projectId },
  });
  return res.status;
}

async function revoke(token: string, userId: string, projectId: string): Promise<number> {
  const res = await api(`/api/v1/users/${userId}/projects`, {
    method: 'DELETE', token, body: { level: 'PROJECT', projectId },
  });
  return res.status;
}

/**
 * Replication crosses two services and a broker, so it is eventually
 * consistent: iam commits the grant, its outbox drainer polls every 500ms, NATS
 * delivers, and project writes its projection. Polling the observable outcome is
 * the honest way to wait for that — a fixed sleep either flakes or is slow.
 */
async function eventually<T>(read: () => Promise<T>, until: (v: T) => boolean, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (until(value)) return value;
    if (Date.now() > deadline) return value;   // let the assertion report the real value
    await new Promise((r) => setTimeout(r, 500));
  }
}

let adminToken: string;
let engineerToken: string;
let engineerId: string;
let target: Project;

beforeAll(async () => {
  await waitForReady();
  adminToken = await login('admin');

  const users = await api<{ items: Array<{ id: string; username: string }> }>(
    '/api/v1/users?search=engineer', { token: adminToken },
  );
  engineerId = users.body.items.find((u) => u.username === 'engineer')!.id;

  const visible = await projectsFor(adminToken);
  expect(visible.length, 'the stack needs at least one project to scope against').toBeGreaterThan(0);
  target = visible[0]!;

  engineerToken = await login('engineer');

  // Leave no grant from a previous run: the fail-closed assertion below is only
  // meaningful from a clean baseline.
  await revoke(adminToken, engineerId, target.id);
  await eventually(() => projectsFor(engineerToken), (p) => p.length === 0);
}, 120_000);

afterAll(async () => {
  if (adminToken && engineerId && target) await revoke(adminToken, engineerId, target.id);
});

describe('scope is enforced at query level', () => {
  it('shows a global administrator every project', async () => {
    // admin holds no project grant at all — only the seeded global one. Seeing
    // projects therefore proves the GLOBAL grant replicated, which is its own
    // regression: the seed used to write that row without emitting the event,
    // locking the administrator out of the system it administers.
    expect((await projectsFor(adminToken)).length).toBeGreaterThan(0);
  });

  it('shows an unscoped user nothing', async () => {
    // Before enforcement existed, `engineer` held project.view and saw every
    // project in the system despite having no scope whatsoever.
    expect(await projectsFor(engineerToken)).toEqual([]);
  });

  it('refuses an unscoped user a project by id with 404, not 403', async () => {
    // 403 would confirm the id names a real project, which is what an
    // enumeration attack is looking for.
    const res = await api(`/api/v1/projects/${target.id}`, { token: engineerToken });
    expect(res.status).toBe(404);
  });
});

describe('a grant replicates from iam into project', () => {
  it('makes the project visible to the granted user', async () => {
    expect(await grant(adminToken, engineerId, target.id)).toBe(201);

    const seen = await eventually(
      () => projectsFor(engineerToken),
      (p) => p.length === 1,
    );
    expect(seen.map((p) => p.id)).toEqual([target.id]);
  }, 60_000);

  it('makes the project readable by id', async () => {
    const res = await api<Project>(`/api/v1/projects/${target.id}`, { token: engineerToken });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(target.id);
  });
});

describe('a revocation replicates too', () => {
  it('withdraws access again', async () => {
    // The regression that matters most here. Revocations were silently never
    // delivered: three subjects shared one durable, a JetStream durable carries
    // one filter, and the extra registrations were swallowed. Grants replicated
    // and revocations did not, so withdrawn access simply persisted — a failure
    // that is open rather than closed.
    expect(await revoke(adminToken, engineerId, target.id)).toBe(200);

    const seen = await eventually(
      () => projectsFor(engineerToken),
      (p) => p.length === 0,
    );
    expect(seen).toEqual([]);
  }, 60_000);

  it('refuses the project by id once more', async () => {
    const res = await api(`/api/v1/projects/${target.id}`, { token: engineerToken });
    expect(res.status).toBe(404);
  });
});
