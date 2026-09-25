import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('./api-client', () => ({ authFetch }));

const api = await import('./work-order-api');

beforeEach(() => { authFetch.mockClear(); });

const BATCH = {
  projectId: 'p-1', workOrderType: 'QUALITY_SELF_CHECK' as const, templateId: 'tpl-1', siteIds: ['s-1', 's-2'], assigneeId: 'u-1',
  plannedCompletionAt: new Date('2026-09-30T23:59:59Z'),
};

/** Work orders are QC's, reached through the gateway's `/api/v1/work-orders` prefix and nothing else. */
const CALLS: { name: string; call: () => Promise<unknown>; path: string; method?: string; json?: unknown }[] = [
  { name: 'listWorkOrders', call: () => api.listWorkOrders(), path: '/api/v1/work-orders' },
  { name: 'listProjectWorkOrders', call: () => api.listProjectWorkOrders('p-1'), path: '/api/v1/work-orders/by-project/p-1' },
  { name: 'getWorkOrder', call: () => api.getWorkOrder('w-1'), path: '/api/v1/work-orders/w-1' },
  { name: 'createWorkOrders', call: () => api.createWorkOrders(BATCH), path: '/api/v1/work-orders', method: 'POST', json: BATCH },
  {
    name: 'updateWorkOrder', call: () => api.updateWorkOrder('w-1', { assigneeId: 'u-2' }),
    path: '/api/v1/work-orders/w-1', method: 'PATCH', json: { assigneeId: 'u-2' },
  },
  {
    name: 'cancelWorkOrder', call: () => api.cancelWorkOrder('w-1', { reason: 'Handed back' }),
    path: '/api/v1/work-orders/w-1/cancel', method: 'POST', json: { reason: 'Handed back' },
  },
];

describe('work-order-api — every call maps to the QC work order route', () => {
  for (const { name, call, path, method, json } of CALLS) {
    it(`${name} calls ${method ?? 'GET'} ${path}`, async () => {
      await call();
      const [actualPath, request] = authFetch.mock.calls[0]!;
      expect(actualPath).toBe(path);
      expect(request?.method).toBe(method);
      expect(request?.json).toEqual(json);
    });
  }
});

describe('listWorkOrders filtering', () => {
  it('sends paging as strings and drops what was not given', async () => {
    await api.listWorkOrders({ projectId: 'p-1', view: 'overdue', page: 2, q: 'KOS' });
    expect(authFetch).toHaveBeenCalledWith('/api/v1/work-orders', {
      query: { projectId: 'p-1', status: undefined, view: 'overdue', workOrderType: undefined, assigneeId: undefined, q: 'KOS', page: '2', limit: undefined },
    });
  });
});
