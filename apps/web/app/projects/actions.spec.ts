import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const deleteProject = vi.fn();
const createSite = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
const updateTask = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('../lib/project-api', () => ({
  deleteProject, updateTask,
  createProject: vi.fn(), updateProject: vi.fn(), archiveProject: vi.fn(),
  createSite, updateSite: vi.fn(), deleteSite: vi.fn(),
  createTaskType: vi.fn(), updateTaskType: vi.fn(), deleteTaskType: vi.fn(),
  createMilestone: vi.fn(), updateMilestone: vi.fn(), deleteMilestone: vi.fn(),
  createTask: vi.fn(), deleteTask: vi.fn(),
}));

const { settle } = await import('./settle');
const { createSiteAction, deleteProjectAction, updateTaskAction } = await import('./actions');

beforeEach(() => {
  revalidatePath.mockClear();
  redirect.mockClear();
  deleteProject.mockClear();
  updateTask.mockClear();
  createSite.mockClear();
});

describe('settle', () => {
  it('revalidates and returns no error when the call succeeded', async () => {
    expect(await settle({ state: 'ready', data: {} }, '/projects')).toEqual({});
    expect(revalidatePath).toHaveBeenCalledWith('/projects');
  });

  it('returns the message when the user may not do this', async () => {
    const state = await settle({ state: 'forbidden', message: 'Not allowed' }, '/projects');
    expect(state.error).toBe('Not allowed');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('keeps the correlation id when the API is unavailable, so a refusal can be traced', async () => {
    const state = await settle(
      { state: 'unavailable', status: 409, message: 'Still has 3 tasks.', correlationId: 'corr-1' },
      '/projects',
    );
    expect(state).toEqual({ error: 'Still has 3 tasks.', correlationId: 'corr-1' });
  });

  it('sends an unauthenticated caller to sign in rather than showing an error', async () => {
    await expect(settle({ state: 'unauthenticated' }, '/projects')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});

describe('deleteProjectAction', () => {
  function form(confirmCode: string): FormData {
    const data = new FormData();
    data.set('projectId', 'p-1');
    data.set('code', 'ALPHA');
    data.set('confirmCode', confirmCode);
    return data;
  }

  it('refuses before calling the API when the typed code does not match', async () => {
    const state = await deleteProjectAction({}, form('ALPH'));
    expect(state.error).toMatch(/type the project code/i);
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('calls the API when the typed code matches', async () => {
    deleteProject.mockResolvedValue({ state: 'ready', data: undefined });
    await expect(deleteProjectAction({}, form('ALPHA'))).rejects.toThrow('NEXT_REDIRECT');
    expect(deleteProject).toHaveBeenCalledWith('p-1');
  });

  it('shows the refusal and does not redirect when the service says no', async () => {
    deleteProject.mockResolvedValue({
      state: 'unavailable', status: 409, message: 'This project still has 3 task(s).', correlationId: 'corr-2',
    });
    const state = await deleteProjectAction({}, form('ALPHA'));
    expect(state).toEqual({ error: 'This project still has 3 task(s).', correlationId: 'corr-2' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('updateTaskAction', () => {
  it('unassigns with an explicit null when the field is present but empty', async () => {
    const data = new FormData();
    data.set('projectId', 'p-1');
    data.set('taskId', 't-1');
    data.set('assigneeId', '');
    await updateTaskAction({}, data);
    expect(updateTask).toHaveBeenCalledWith('t-1', { assigneeId: null });
  });

  it('leaves the assignee alone when the field is absent from the form', async () => {
    const data = new FormData();
    data.set('projectId', 'p-1');
    data.set('taskId', 't-1');
    data.set('title', 'Renamed');
    await updateTaskAction({}, data);
    expect(updateTask).toHaveBeenCalledWith('t-1', { title: 'Renamed' });
  });
});

describe('createSiteAction geofence', () => {
  const PROJECT_ID = '0192f7a0-0000-7000-8000-000000000001';

  it('sends coordinates and a custom geofence', async () => {
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    form.set('siteCode', 'SITE_01');
    form.set('name', 'One');
    form.set('latitude', '27.7172');
    form.set('longitude', '85.3240');
    form.set('geofenceMode', 'CUSTOM');
    form.set('geofenceRadiusM', '250');
    await createSiteAction({}, form);
    expect(createSite).toHaveBeenCalledWith(PROJECT_ID, expect.objectContaining({
      latitude: 27.7172, longitude: 85.324, geofenceMode: 'CUSTOM', geofenceRadiusM: 250,
    }));
  });

  // Answered here rather than by a round trip to be told the obvious.
  it('rejects a latitude with no longitude before calling the API', async () => {
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    form.set('siteCode', 'SITE_01');
    form.set('name', 'One');
    form.set('latitude', '27.7172');
    const state = await createSiteAction({}, form);
    expect(state.error).toContain('together');
    expect(createSite).not.toHaveBeenCalled();
  });

  it('rejects a custom geofence with no radius', async () => {
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    form.set('siteCode', 'SITE_01');
    form.set('name', 'One');
    form.set('geofenceMode', 'CUSTOM');
    const state = await createSiteAction({}, form);
    expect(state.error).toContain('radius');
    expect(createSite).not.toHaveBeenCalled();
  });
});
