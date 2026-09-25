import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const deleteProject = vi.fn();
const createSite = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
const updateSite = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
const updateTask = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
const updateProject = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
const archiveProject = vi.fn().mockResolvedValue({ state: 'ready', data: {} });
vi.mock('../lib/project-api', () => ({
  deleteProject, updateTask, updateProject, archiveProject,
  createProject: vi.fn(),
  createSite, updateSite, deleteSite: vi.fn(),
  createTaskType: vi.fn(), updateTaskType: vi.fn(), deleteTaskType: vi.fn(),
  createMilestone: vi.fn(), updateMilestone: vi.fn(), deleteMilestone: vi.fn(),
  createTask: vi.fn(), deleteTask: vi.fn(),
}));

const { settle } = await import('../lib/settle');
const {
  archiveProjectAction, createSiteAction, deleteProjectAction,
  updateProjectAction, updateSiteAction,
} = await import('./actions');

beforeEach(() => {
  revalidatePath.mockClear();
  redirect.mockClear();
  deleteProject.mockClear();
  updateTask.mockClear();
  createSite.mockClear();
  updateSite.mockClear();
  updateProject.mockClear();
  archiveProject.mockClear();
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

  // A create has nothing to remove, so two blank coordinates mean nothing at all.
  it('sends no coordinates at all when both are left blank', async () => {
    const form = new FormData();
    form.set('projectId', PROJECT_ID);
    form.set('siteCode', 'SITE_01');
    form.set('name', 'One');
    form.set('latitude', '');
    form.set('longitude', '');
    await createSiteAction({}, form);
    expect(createSite.mock.calls[0]![1]).not.toHaveProperty('latitude');
  });
});

describe('updateSiteAction', () => {
  /** The edit form always submits every field, so a blank one is a deliberate clear. */
  function form(overrides: Record<string, string> = {}): FormData {
    const data = new FormData();
    const fields: Record<string, string> = {
      projectId: 'p-1', siteId: 's-1', name: 'Site One',
      regionName: 'North', city: 'Pokhara',
      latitude: '27.7172', longitude: '85.3240',
      geofenceMode: 'INHERIT', geofenceRadiusM: '', status: 'PLANNED',
      ...overrides,
    };
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  const sent = () => updateSite.mock.calls[0]![1];

  it('sends the edited fields', async () => {
    await expect(updateSiteAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(updateSite.mock.calls[0]![0]).toBe('s-1');
    expect(sent()).toEqual({
      name: 'Site One', status: 'PLANNED', regionName: 'North', city: 'Pokhara',
      latitude: 27.7172, longitude: 85.324, geofenceMode: 'INHERIT',
    });
  });

  it('sends null for a field the user emptied, which is how a value is removed', async () => {
    await expect(updateSiteAction({}, form({ regionName: '', city: '' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(sent()).toMatchObject({ regionName: null, city: null });
  });

  it('clears both coordinates when both are emptied', async () => {
    await expect(updateSiteAction({}, form({ latitude: '', longitude: '' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(sent()).toMatchObject({ latitude: null, longitude: null });
  });

  it('refuses a lone coordinate before calling the API', async () => {
    const state = await updateSiteAction({}, form({ longitude: '' }));
    expect(state.error).toMatch(/together/i);
    expect(updateSite).not.toHaveBeenCalled();
  });

  it('refuses a custom geofence with no radius before calling the API', async () => {
    const state = await updateSiteAction({}, form({ geofenceMode: 'CUSTOM' }));
    expect(state.error).toMatch(/radius/i);
    expect(updateSite).not.toHaveBeenCalled();
  });

  it('sends the radius when the geofence is custom', async () => {
    await expect(updateSiteAction({}, form({ geofenceMode: 'CUSTOM', geofenceRadiusM: '250' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(sent()).toMatchObject({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 });
  });

  // A blank name would otherwise be dropped silently and the site keep its old one.
  it('refuses a blank name before calling the API', async () => {
    const state = await updateSiteAction({}, form({ name: '' }));
    expect(state.error).toMatch(/name/i);
    expect(updateSite).not.toHaveBeenCalled();
  });

  it('lands the user back on the sites tab, with the overview refreshed too', async () => {
    await expect(updateSiteAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/p-1');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/p-1/sites');
    expect(redirect).toHaveBeenCalledWith('/projects/p-1/sites');
  });

  it("shows the API's refusal and does not redirect", async () => {
    updateSite.mockResolvedValueOnce({ state: 'forbidden', message: 'Not allowed' });
    expect(await updateSiteAction({}, form())).toEqual({ error: 'Not allowed' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

/**
 * A project's status is rendered on three pages: the list badge, the detail
 * header, and the edit form's own `<select>`. Revalidating only the detail page
 * left the other two showing the previous status until a browser refresh — the
 * edit form worst of all, because an uncontrolled `<select>` re-applies
 * whichever `defaultValue` the refreshed payload carries, so a saved status
 * visibly snapped back to the old one.
 */
describe('updateProjectAction', () => {
  function form(overrides: Record<string, string> = {}): FormData {
    const data = new FormData();
    const fields: Record<string, string> = {
      projectId: 'p-1', name: 'Project One', clientName: 'Acme',
      phase: 'Phase 1', status: 'ON_HOLD', ...overrides,
    };
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  }

  it('sends the edited fields', async () => {
    await expect(updateProjectAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(updateProject.mock.calls[0]![0]).toBe('p-1');
    expect(updateProject.mock.calls[0]![1]).toEqual({
      name: 'Project One', clientName: 'Acme', phase: 'Phase 1', status: 'ON_HOLD',
    });
  });

  it('refreshes every page that shows the status, not just the detail page', async () => {
    await expect(updateProjectAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/p-1');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/p-1/edit');
    expect(revalidatePath).toHaveBeenCalledWith('/projects');
  });

  // Leaving the user on the edit form gives a save no acknowledgement at all,
  // and leaves the stale `<select>` on screen. The project page shows the result.
  it('lands the user on the project page, where the new status is rendered', async () => {
    await expect(updateProjectAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/projects/p-1');
  });

  it("shows the API's refusal and does not redirect", async () => {
    updateProject.mockResolvedValueOnce({ state: 'forbidden', message: 'Not allowed' });
    expect(await updateProjectAction({}, form())).toEqual({ error: 'Not allowed' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('archiveProjectAction', () => {
  function form(): FormData {
    const data = new FormData();
    data.set('projectId', 'p-1');
    return data;
  }

  it('refreshes every page that shows the status, then lands on the project page', async () => {
    await expect(archiveProjectAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(archiveProject).toHaveBeenCalledWith('p-1');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/p-1');
    expect(revalidatePath).toHaveBeenCalledWith('/projects/p-1/edit');
    expect(revalidatePath).toHaveBeenCalledWith('/projects');
    expect(redirect).toHaveBeenCalledWith('/projects/p-1');
  });

  it("shows the API's refusal and does not redirect", async () => {
    archiveProject.mockResolvedValueOnce({ state: 'forbidden', message: 'Not allowed' });
    expect(await archiveProjectAction({}, form())).toEqual({ error: 'Not allowed' });
    expect(redirect).not.toHaveBeenCalled();
  });
});
