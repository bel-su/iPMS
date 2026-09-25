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
  { name: 'listTasks', call: () => api.listTasks('p-1'), path: '/api/v1/projects/p-1/tasks' },
  { name: 'listWorkOrders', call: () => api.listWorkOrders(), path: '/api/v1/work-orders' },
  { name: 'getWorkOrder', call: () => api.getWorkOrder('w-1'), path: '/api/v1/work-orders/w-1' },
  {
    name: 'createWorkOrders',
    call: () => api.createWorkOrders('p-1', {
      workOrderType: 'QUALITY_SELF_CHECK', templateId: 'tpl-1', siteIds: ['s-1', 's-2'], assigneeId: 'u-1',
      plannedCompletionAt: new Date('2026-09-30T23:59:59Z'),
    }),
    path: '/api/v1/projects/p-1/work-orders', method: 'POST',
    json: {
      workOrderType: 'QUALITY_SELF_CHECK', templateId: 'tpl-1', siteIds: ['s-1', 's-2'], assigneeId: 'u-1',
      plannedCompletionAt: new Date('2026-09-30T23:59:59Z'),
    },
  },
  {
    name: 'updateWorkOrder', call: () => api.updateWorkOrder('w-1', { assigneeId: 'u-2' }),
    path: '/api/v1/work-orders/w-1', method: 'PATCH', json: { assigneeId: 'u-2' },
  },
  {
    name: 'cancelWorkOrder', call: () => api.cancelWorkOrder('w-1', { reason: 'Handed back' }),
    path: '/api/v1/work-orders/w-1/cancel', method: 'POST', json: { reason: 'Handed back' },
  },
  { name: 'listAssignable', call: () => api.listAssignable('p-1'), path: '/api/v1/projects/p-1/work-orders/assignable' },
  {
    name: 'updateSite', call: () => api.updateSite('s-1', { name: 'Renamed' }),
    path: '/api/v1/sites/s-1', method: 'PATCH', json: { name: 'Renamed' },
  },
  {
    name: 'updateTaskType', call: () => api.updateTaskType('tt-1', { isActive: false }),
    path: '/api/v1/task-types/tt-1', method: 'PATCH', json: { isActive: false },
  },
  {
    name: 'updateMilestone', call: () => api.updateMilestone('m-1', { name: 'Handover' }),
    path: '/api/v1/milestones/m-1', method: 'PATCH', json: { name: 'Handover' },
  },
  {
    name: 'updateTask', call: () => api.updateTask('t-1', { status: 'ONGOING' }),
    path: '/api/v1/tasks/t-1', method: 'PATCH', json: { status: 'ONGOING' },
  },
  { name: 'archiveProject', call: () => api.archiveProject('p-1'), path: '/api/v1/projects/p-1/archive', method: 'POST' },
  { name: 'deleteProject', call: () => api.deleteProject('p-1'), path: '/api/v1/projects/p-1', method: 'DELETE' },
  { name: 'deleteSite', call: () => api.deleteSite('s-1'), path: '/api/v1/sites/s-1', method: 'DELETE' },
  { name: 'deleteTaskType', call: () => api.deleteTaskType('tt-1'), path: '/api/v1/task-types/tt-1', method: 'DELETE' },
  { name: 'deleteMilestone', call: () => api.deleteMilestone('m-1'), path: '/api/v1/milestones/m-1', method: 'DELETE' },
  { name: 'deleteTask', call: () => api.deleteTask('t-1'), path: '/api/v1/tasks/t-1', method: 'DELETE' },
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

  // These are the prefixes ROUTES in apps/gateway/src/proxy/routes.ts sends to
  // the project service, and nothing else reaches it. A path outside them 404s
  // at the edge rather than failing somewhere visible.
  const ROUTED = ['/api/v1/dashboard', '/api/v1/projects', '/api/v1/sites', '/api/v1/task-types', '/api/v1/milestones', '/api/v1/tasks', '/api/v1/work-orders'];

  it('uses only paths the gateway allowlist routes to the project service', async () => {
    for (const { call } of CALLS) {
      authFetch.mockClear();
      await call();
      const path = authFetch.mock.calls[0]![0] as string;
      expect(ROUTED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))).toBe(true);
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

describe('listWorkOrders filtering', () => {
  it('sends paging as strings and drops what was not given', async () => {
    await api.listWorkOrders({ projectId: 'p-1', view: 'overdue', page: 2, q: 'KOS' });
    expect(authFetch).toHaveBeenCalledWith('/api/v1/work-orders', {
      query: { projectId: 'p-1', status: undefined, view: 'overdue', workOrderType: undefined, assigneeId: undefined, q: 'KOS', page: '2', limit: undefined },
    });
  });
});

describe('listTasks filtering', () => {
  it('passes the filter as a query, which the gateway forwards untouched', async () => {
    await api.listTasks('p-1', { status: 'ONGOING' });
    expect(authFetch).toHaveBeenCalledWith('/api/v1/projects/p-1/tasks', { query: { status: 'ONGOING' } });
  });
});
