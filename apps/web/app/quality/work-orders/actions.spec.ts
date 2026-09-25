import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); });
vi.mock('next/navigation', () => ({ redirect }));

const projectApi = { getProject: vi.fn(), listAssignable: vi.fn() };
vi.mock('../../lib/project-api', () => projectApi);
const workOrderApi = { createWorkOrders: vi.fn(), updateWorkOrder: vi.fn(), cancelWorkOrder: vi.fn() };
vi.mock('../../lib/work-order-api', () => workOrderApi);
const qcApi = { getVersion: vi.fn() };
vi.mock('../../lib/qc-api', () => qcApi);

const actions = await import('./actions');
const ID = '0192f7a0-0000-7000-8000-000000000001';
const PLANNED = '2026-09-30T18:14:59.000Z';

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(key, one);
  }
  return data;
}
const complete = {
  projectId: 'p-1', workOrderType: 'QUALITY_SELF_CHECK', templateId: ID, siteIds: ['s-1', 's-2'],
  assigneeId: 'u-1', plannedCompletionAt: PLANNED, note: '',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('createWorkOrdersAction', () => {
  it('creates one per site and returns to the queue saying how many', async () => {
    workOrderApi.createWorkOrders.mockResolvedValue({ state: 'ready', data: { created: [{}, {}] } });
    await expect(actions.createWorkOrdersAction({}, form(complete))).rejects.toThrow('NEXT_REDIRECT /quality/work-orders?projectId=p-1&created=2');
    expect(workOrderApi.createWorkOrders).toHaveBeenCalledWith({
      projectId: 'p-1', workOrderType: 'QUALITY_SELF_CHECK', templateId: ID, siteIds: ['s-1', 's-2'], assigneeId: 'u-1', plannedCompletionAt: new Date(PLANNED),
    });
  });

  it('passes the note when there is one', async () => {
    workOrderApi.createWorkOrders.mockResolvedValue({ state: 'ready', data: { created: [{}] } });
    await expect(actions.createWorkOrdersAction({}, form({ ...complete, note: 'sector A' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(workOrderApi.createWorkOrders.mock.calls[0]?.[0]).toMatchObject({ note: 'sector A' });
  });

  it.each([
    ['projectId', 'project'], ['workOrderType', 'kind of check'], ['templateId', 'checklist'],
    ['siteIds', 'site'], ['assigneeId', 'responsible person'], ['plannedCompletionAt', 'completion date'],
  ])('asks for %s before calling the API', async (field, message) => {
    const state = await actions.createWorkOrdersAction({}, form({ ...complete, [field]: field === 'siteIds' ? [] : '' }));
    expect(state.error).toContain(message);
    expect(workOrderApi.createWorkOrders).not.toHaveBeenCalled();
  });

  it('shows the service’s own refusal', async () => {
    workOrderApi.createWorkOrders.mockResolvedValue({ state: 'unavailable', status: 400, message: 'The responsible person has no access to site KOS102X.' });
    expect((await actions.createWorkOrdersAction({}, form(complete))).error).toContain('no access to site KOS102X');
  });
});

describe('updateWorkOrderAction and cancelWorkOrderAction', () => {
  it('reassigns', async () => {
    workOrderApi.updateWorkOrder.mockResolvedValue({ state: 'ready', data: {} });
    expect(await actions.updateWorkOrderAction({}, form({ id: 'w-1', projectId: 'p-1', assigneeId: 'u-2' }))).toEqual({});
    expect(workOrderApi.updateWorkOrder).toHaveBeenCalledWith('w-1', { assigneeId: 'u-2' });
  });

  it('reschedules', async () => {
    workOrderApi.updateWorkOrder.mockResolvedValue({ state: 'ready', data: {} });
    await actions.updateWorkOrderAction({}, form({ id: 'w-1', projectId: 'p-1', plannedCompletionAt: PLANNED }));
    expect(workOrderApi.updateWorkOrder).toHaveBeenCalledWith('w-1', { plannedCompletionAt: new Date(PLANNED) });
  });

  it('needs something to change', async () => {
    expect((await actions.updateWorkOrderAction({}, form({ id: 'w-1', projectId: 'p-1' }))).error).toBeTruthy();
    expect(workOrderApi.updateWorkOrder).not.toHaveBeenCalled();
  });

  it('cancels only with a reason', async () => {
    expect((await actions.cancelWorkOrderAction({}, form({ id: 'w-1', projectId: 'p-1', reason: ' ' }))).error).toContain('why');
    workOrderApi.cancelWorkOrder.mockResolvedValue({ state: 'ready', data: {} });
    await actions.cancelWorkOrderAction({}, form({ id: 'w-1', projectId: 'p-1', reason: 'Handed back' }));
    expect(workOrderApi.cancelWorkOrder).toHaveBeenCalledWith('w-1', { reason: 'Handed back' });
  });
});

describe('loaders', () => {
  it('loadChecklistAction returns sections, and refuses a non-uuid without calling the API', async () => {
    qcApi.getVersion.mockResolvedValue({ state: 'ready', data: { version: { sections: [{ id: 'sec-1' }] } } });
    expect(await actions.loadChecklistAction(ID, 2)).toEqual({ state: 'ready', sections: [{ id: 'sec-1' }] });
    expect((await actions.loadChecklistAction('../../users', 1)).state).toBe('error');
    expect(qcApi.getVersion).toHaveBeenCalledTimes(1);
  });

  it('loadProjectAction returns sites and assignable people', async () => {
    projectApi.getProject.mockResolvedValue({ state: 'ready', data: { sites: [{ id: 's-1', siteCode: 'K1', name: 'K', city: null, area: null, extra: 1 }] } });
    projectApi.listAssignable.mockResolvedValue({ state: 'ready', data: [{ userId: 'u-1', wholeProject: true, siteIds: [] }] });
    expect(await actions.loadProjectAction(ID)).toEqual({
      state: 'ready', sites: [{ id: 's-1', siteCode: 'K1', name: 'K', city: null, area: null }],
      assignable: [{ userId: 'u-1', wholeProject: true, siteIds: [] }],
    });
  });

  it('loadProjectAction passes a refusal on', async () => {
    projectApi.getProject.mockResolvedValue({ state: 'ready', data: { sites: [] } });
    projectApi.listAssignable.mockResolvedValue({ state: 'forbidden', message: 'Missing task.assign' });
    expect(await actions.loadProjectAction(ID)).toEqual({ state: 'error', message: 'Missing task.assign' });
  });
});
