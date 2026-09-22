'use server';
import { redirect } from 'next/navigation';
import {
  createMilestone, createProject, createSite, createTask, createTaskType,
  deleteMilestone, deleteSite, deleteTask, deleteTaskType,
  archiveProject, deleteProject, updateMilestone, updateProject, updateSite, updateTask, updateTaskType,
  type ProjectStatus, type SiteStatus, type TaskStatus,
} from '../lib/project-api';
import { type FormState } from '../lib/form-state';
import { clearable, optional, settle } from '../lib/settle';
import { projectPages } from './[id]/paths';

/**
 * One Server Action per mutation.
 *
 * They run on the server, so they reach `authFetch` and its http-only cookie
 * directly and the forms they back work without client JavaScript. Required
 * fields are checked here before the call: the service would refuse them too,
 * but a round trip to be told "name is required" is a worse answer than an
 * immediate one.
 */
export async function createProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const code = optional(form, 'code');
  const name = optional(form, 'name');
  if (!code || !name) return { error: 'A code and a name are required.' };

  const clientName = optional(form, 'clientName');
  const phase = optional(form, 'phase');
  const startDate = optional(form, 'startDate');
  const targetDate = optional(form, 'targetDate');
  const defaultGeofenceRadiusM = optional(form, 'defaultGeofenceRadiusM');

  const result = await createProject({
    code,
    name,
    ...(clientName === undefined ? {} : { clientName }),
    ...(phase === undefined ? {} : { phase }),
    ...(startDate === undefined ? {} : { startDate: new Date(startDate) }),
    ...(targetDate === undefined ? {} : { targetDate: new Date(targetDate) }),
    ...(defaultGeofenceRadiusM === undefined
      ? {}
      : { defaultGeofenceRadiusM: defaultGeofenceRadiusM === 'off' ? null : Number(defaultGeofenceRadiusM) }),
  });

  const state = await settle(result, '/projects');
  if (state.error) return state;
  if (result.state === 'ready') redirect(`/projects/${result.data.id}`);
  return state;
}

/** The project's landing page, where project-level actions return to. */
const page = (projectId: string) => `/projects/${projectId}`;

/**
 * The geofence half of a site form, as the API wants it.
 *
 * Returns an error string rather than throwing, so the caller can answer the
 * form directly. The lone-coordinate check is repeated here rather than left
 * to the service: a round trip to be told the obvious is a worse answer than
 * an immediate one.
 *
 * `blank` is what two empty coordinate inputs mean. On a create there is
 * nothing to remove, so they mean nothing; on an update they are the only way
 * to say that a wrong coordinate should go.
 */
function siteGeofenceFields(
  form: FormData,
  blank: 'ignore' | 'clear',
): { fields: Record<string, unknown> } | { error: string } {
  const latitude = optional(form, 'latitude');
  const longitude = optional(form, 'longitude');
  if ((latitude === undefined) !== (longitude === undefined)) {
    return { error: 'Latitude and longitude must be given together, or both left blank.' };
  }
  const mode = optional(form, 'geofenceMode') ?? 'INHERIT';
  const radius = optional(form, 'geofenceRadiusM');
  if (mode === 'CUSTOM' && radius === undefined) return { error: 'A custom geofence needs a radius in metres.' };
  const coordinates = latitude !== undefined && longitude !== undefined
    ? { latitude: Number(latitude), longitude: Number(longitude) }
    : blank === 'clear' ? { latitude: null, longitude: null } : {};
  return {
    fields: {
      ...coordinates,
      geofenceMode: mode,
      ...(mode === 'CUSTOM' && radius !== undefined ? { geofenceRadiusM: Number(radius) } : {}),
    },
  };
}

export async function createSiteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const siteCode = optional(form, 'siteCode');
  const name = optional(form, 'name');
  if (!siteCode || !name) return { error: 'A site code and a name are required.' };
  const geofence = siteGeofenceFields(form, 'ignore');
  if ('error' in geofence) return { error: geofence.error };
  const regionName = optional(form, 'regionName');
  const city = optional(form, 'city');
  return settle(await createSite(projectId, {
    siteCode, name,
    ...(regionName === undefined ? {} : { regionName }),
    ...(city === undefined ? {} : { city }),
    ...geofence.fields,
  }), projectPages(projectId));
}

/**
 * Unlike the create form, every field here arrives on every submit, so an
 * empty one is a deliberate clear rather than a field the user skipped —
 * hence `clearable` and `'clear'`. On success it returns to the project page
 * rather than staying put: `FormState` carries an error and nothing else, so
 * the updated row is the only acknowledgement a save can give.
 */
export async function updateSiteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const name = optional(form, 'name');
  if (!name) return { error: 'A name is required.' };
  const geofence = siteGeofenceFields(form, 'clear');
  if ('error' in geofence) return { error: geofence.error };
  const status = optional(form, 'status');
  const state = await settle(await updateSite(String(form.get('siteId')), {
    name,
    ...(status === undefined ? {} : { status: status as SiteStatus }),
    ...clearable(form, 'regionName'),
    ...clearable(form, 'city'),
    ...geofence.fields,
  }), projectPages(projectId));
  if (state.error) return state;
  redirect(`/projects/${projectId}/sites`);
}

export async function deleteSiteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteSite(String(form.get('siteId'))), projectPages(projectId));
}

export async function createTaskTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const code = optional(form, 'code');
  const name = optional(form, 'name');
  const category = optional(form, 'category');
  if (!code || !name || !category) return { error: 'A code, a name and a category are required.' };
  return settle(await createTaskType(projectId, { code, name, category }), projectPages(projectId));
}

export async function updateTaskTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const name = optional(form, 'name');
  return settle(await updateTaskType(String(form.get('taskTypeId')), {
    ...(name === undefined ? {} : { name }),
    // An unchecked checkbox sends nothing, which is how the form says "retired".
    isActive: form.get('isActive') === 'on',
  }), projectPages(projectId));
}

export async function deleteTaskTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteTaskType(String(form.get('taskTypeId'))), projectPages(projectId));
}

export async function createMilestoneAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const code = optional(form, 'code');
  const name = optional(form, 'name');
  if (!code || !name) return { error: 'A code and a name are required.' };
  return settle(await createMilestone(projectId, {
    code, name,
    kind: (optional(form, 'kind') ?? 'PROJECT') as 'PROJECT' | 'CONTRACT',
    sequence: Number(optional(form, 'sequence') ?? 0),
    taskTypeIds: form.getAll('taskTypeIds').map(String),
  }), projectPages(projectId));
}

export async function updateMilestoneAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const name = optional(form, 'name');
  return settle(await updateMilestone(String(form.get('milestoneId')), {
    ...(name === undefined ? {} : { name }),
    taskTypeIds: form.getAll('taskTypeIds').map(String),
  }), projectPages(projectId));
}

export async function deleteMilestoneAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteMilestone(String(form.get('milestoneId'))), projectPages(projectId));
}

export async function createTaskAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const siteId = optional(form, 'siteId');
  const taskTypeId = optional(form, 'taskTypeId');
  const title = optional(form, 'title');
  if (!siteId || !taskTypeId || !title) return { error: 'A site, a task type and a title are required.' };
  return settle(await createTask(projectId, { siteId, taskTypeId, title, origin: 'AD_HOC' }), projectPages(projectId));
}

export async function updateTaskAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const title = optional(form, 'title');
  const status = optional(form, 'status');
  const assignee = optional(form, 'assigneeId');
  return settle(await updateTask(String(form.get('taskId')), {
    ...(title === undefined ? {} : { title }),
    ...(status === undefined ? {} : { status: status as TaskStatus }),
    // An empty assignee field means "unassign", which is null rather than absent.
    ...(form.has('assigneeId') ? { assigneeId: assignee ?? null } : {}),
  }), projectPages(projectId));
}

export async function deleteTaskAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteTask(String(form.get('taskId'))), projectPages(projectId));
}

/**
 * Every page a project's status is rendered on.
 *
 * Unlike the sub-resources above, a project is not shown on its own page
 * alone: the status appears as the list badge, as the detail header, and as
 * the edit form's `<select>`. `revalidatePath` invalidates only the exact path
 * it is given, so all three are named here. The edit page matters most — it is
 * the page these two actions are submitted from, and an uncontrolled `<select>`
 * re-applies whichever `defaultValue` the refreshed payload carries, so leaving
 * it stale made a saved status visibly snap back to the previous one.
 */
const statusPages = (projectId: string) => [...projectPages(projectId), `${page(projectId)}/edit`, '/projects'];

/**
 * On success this returns to the project page rather than staying on the form,
 * for the reason `updateSiteAction` does: `FormState` carries an error and
 * nothing else, so the rendered project — with its new status — is the only
 * acknowledgement a save can give. It also unmounts the edit form, which is
 * what puts the `<select>` beyond doubt.
 */
export async function updateProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const name = optional(form, 'name');
  const clientName = optional(form, 'clientName');
  const phase = optional(form, 'phase');
  const status = optional(form, 'status');
  const state = await settle(await updateProject(projectId, {
    ...(name === undefined ? {} : { name }),
    ...(clientName === undefined ? {} : { clientName }),
    ...(phase === undefined ? {} : { phase }),
    ...(status === undefined ? {} : { status: status as ProjectStatus }),
  }), statusPages(projectId));
  if (state.error) return state;
  redirect(page(projectId));
}

export async function archiveProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const state = await settle(await archiveProject(projectId), statusPages(projectId));
  if (state.error) return state;
  redirect(page(projectId));
}

/**
 * The irreversible one.
 *
 * The typed code is checked here as well as in the browser, because the
 * browser's check is a convenience and this one is the gate. The service
 * refuses anyway while tasks remain; this stops the wrong project going even
 * when it is empty.
 */
export async function deleteProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  if (optional(form, 'confirmCode') !== optional(form, 'code')) {
    return { error: 'To delete this project, type the project code exactly.' };
  }
  const state = await settle(await deleteProject(projectId), '/projects');
  if (state.error) return state;
  redirect('/projects');
}
