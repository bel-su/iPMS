import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); });
vi.mock('next/navigation', () => ({ redirect }));

const projectApi = { createWorkOrder: vi.fn() };
vi.mock('../../../lib/project-api', () => projectApi);
const qcApi = { getVersion: vi.fn() };
vi.mock('../../../lib/qc-api', () => qcApi);

const actions = await import('./actions');
const ID = '0192f7a0-0000-7000-8000-000000000001';
const PLANNED = '2026-09-30T18:14:59.000Z';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const complete = {
  projectId: 'p-1', workOrderType: 'QUALITY_SELF_CHECK', templateId: ID, siteId: 's-1',
  assigneeId: 'u-1', plannedCompletionAt: PLANNED, title: '[Quality Self-check]SAKUWA GACHHI',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('createWorkOrderAction', () => {
  it('creates the work order and returns to the list', async () => {
    projectApi.createWorkOrder.mockResolvedValue({ state: 'ready', data: { id: 'w-1', title: complete.title } });
    await expect(actions.createWorkOrderAction({}, form(complete))).rejects.toThrow('NEXT_REDIRECT /projects/p-1/work-orders');
    expect(projectApi.createWorkOrder).toHaveBeenCalledWith('p-1', {
      workOrderType: 'QUALITY_SELF_CHECK', templateId: ID, siteId: 's-1', assigneeId: 'u-1',
      title: complete.title, plannedCompletionAt: new Date(PLANNED),
    });
  });

  it('stays on the form with continuous creation, reporting what was made', async () => {
    projectApi.createWorkOrder.mockResolvedValue({ state: 'ready', data: { id: 'w-1', title: complete.title } });
    const state = await actions.createWorkOrderAction({}, form({ ...complete, continuous: 'on' }));
    expect(state).toEqual({ created: { id: 'w-1', title: complete.title } });
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['workOrderType', 'work order type'], ['templateId', 'template'], ['plannedCompletionAt', 'completion date'],
    ['siteId', 'site'], ['assigneeId', 'responsible person'], ['title', 'name'],
  ])('asks for %s before calling the API', async (field, message) => {
    const state = await actions.createWorkOrderAction({}, form({ ...complete, [field]: '' }));
    expect(state.error).toContain(message);
    expect(projectApi.createWorkOrder).not.toHaveBeenCalled();
  });

  it('shows the service’s own refusal', async () => {
    projectApi.createWorkOrder.mockResolvedValue({ state: 'unavailable', status: 409, message: 'The checklist "Q" has been disabled' });
    expect((await actions.createWorkOrderAction({}, form(complete))).error).toBe('The checklist "Q" has been disabled');
  });
});

describe('loadChecklistAction', () => {
  it('returns the version’s sections', async () => {
    qcApi.getVersion.mockResolvedValue({ state: 'ready', data: { version: { sections: [{ id: 'sec-1' }] } } });
    expect(await actions.loadChecklistAction(ID, 2)).toEqual({ state: 'ready', sections: [{ id: 'sec-1' }] });
    expect(qcApi.getVersion).toHaveBeenCalledWith(ID, 2);
  });

  it('refuses an id that is not a uuid without calling the API', async () => {
    expect((await actions.loadChecklistAction('../../users', 1)).state).toBe('error');
    expect(qcApi.getVersion).not.toHaveBeenCalled();
  });

  it('passes a failure on as a message', async () => {
    qcApi.getVersion.mockResolvedValue({ state: 'forbidden', message: 'Missing qc_template.view' });
    expect(await actions.loadChecklistAction(ID, 1)).toEqual({ state: 'error', message: 'Missing qc_template.view' });
  });
});
