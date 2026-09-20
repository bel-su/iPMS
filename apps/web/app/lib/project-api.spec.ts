import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));

const api = await import('./project-api');

beforeEach(() => { authFetch.mockClear(); });

/** The path and request each call puts on the wire, which is the contract with the gateway allowlist. */
const CALLS: { name: string; call: () => Promise<unknown>; path: string; method?: string; json?: unknown }[] = [
  { name: 'getProjectDashboard', call: () => api.getProjectDashboard(), path: '/api/v1/dashboard' },
  { name: 'listProjects', call: () => api.listProjects(), path: '/api/v1/projects' },
  { name: 'getProject', call: () => api.getProject('p-1'), path: '/api/v1/projects/p-1' },
  {
    name: 'createProject', call: () => api.createProject({ code: 'ALPHA', name: 'Alpha' }),
    path: '/api/v1/projects', method: 'POST', json: { code: 'ALPHA', name: 'Alpha' },
  },
  {
    name: 'updateProject', call: () => api.updateProject('p-1', { status: 'ACTIVE' }),
    path: '/api/v1/projects/p-1', method: 'PATCH', json: { status: 'ACTIVE' },
  },
  {
    name: 'createSite', call: () => api.createSite('p-1', { siteCode: 'S-1', name: 'Site 1' }),
    path: '/api/v1/projects/p-1/sites', method: 'POST', json: { siteCode: 'S-1', name: 'Site 1' },
  },
  {
    name: 'createTaskType', call: () => api.createTaskType('p-1', { code: 'CIVIL', name: 'Civil', category: 'BUILD' }),
    path: '/api/v1/projects/p-1/task-types', method: 'POST', json: { code: 'CIVIL', name: 'Civil', category: 'BUILD' },
  },
  {
    name: 'createMilestone',
    call: () => api.createMilestone('p-1', { code: 'M1', name: 'Handover', kind: 'PROJECT', sequence: 1, taskTypeIds: [] }),
    path: '/api/v1/projects/p-1/milestones', method: 'POST',
    json: { code: 'M1', name: 'Handover', kind: 'PROJECT', sequence: 1, taskTypeIds: [] },
  },
  {
    name: 'createTask',
    call: () => api.createTask('p-1', { siteId: 's-1', taskTypeId: 't-1', title: 'Install', origin: 'AD_HOC' }),
    path: '/api/v1/projects/p-1/tasks', method: 'POST',
    json: { siteId: 's-1', taskTypeId: 't-1', title: 'Install', origin: 'AD_HOC' },
  },
  {
    name: 'assignTask', call: () => api.assignTask('task-1', { assigneeId: 'u-1' }),
    path: '/api/v1/tasks/task-1/assign', method: 'POST', json: { assigneeId: 'u-1' },
  },
];

describe('project-api — every call maps to a gateway route', () => {
  for (const { name, call, path, method, json } of CALLS) {
    it(`${name} calls ${method ?? 'GET'} ${path}`, async () => {
      await call();
      const [actualPath, request] = authFetch.mock.calls[0]!;
      expect(actualPath).toBe(path);
      expect(request?.method).toBe(method);
      expect(request?.json).toEqual(json);
    });
  }

  // The gateway routes '/api/v1/projects' and '/api/v1/tasks' to the project
  // service, and nothing else reaches it. A path outside those prefixes 404s
  // at the edge rather than failing somewhere visible.
  it('uses only paths the gateway allowlist routes to the project service', async () => {
    for (const { call } of CALLS) {
      authFetch.mockClear();
      await call();
      const path = authFetch.mock.calls[0]![0] as string;
      expect(path.startsWith('/api/v1/projects') || path.startsWith('/api/v1/tasks') || path === '/api/v1/dashboard').toBe(true);
    }
  });
});

describe('project-api — results pass through untouched', () => {
  it('returns the client’s ready result', async () => {
    authFetch.mockResolvedValueOnce({ state: 'ready', data: { activeProjectCount: 3 } });
    expect(await api.getProjectDashboard()).toEqual({ state: 'ready', data: { activeProjectCount: 3 } });
  });

  it('returns the client’s failure verbatim, so a page can tell the cases apart', async () => {
    authFetch.mockResolvedValueOnce({ state: 'forbidden', message: 'Permission project.create is required' });
    expect(await api.createProject({ code: 'ALPHA', name: 'Alpha' }))
      .toEqual({ state: 'forbidden', message: 'Permission project.create is required' });
  });
});
