'use server';
import { redirect } from 'next/navigation';
import {
  createMilestone, createProject, createSite, createTask, createTaskType,
  deleteMilestone, deleteSite, deleteTask, deleteTaskType,
  archiveProject, deleteProject, updateMilestone, updateProject, updateSite, updateTask, updateTaskType,
  type ProjectStatus, type SiteStatus, type TaskStatus,
} from '../lib/project-api';
import { type FormState } from './form-state';
import { optional, settle } from './settle';

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

  const result = await createProject({
    code,
    name,
    ...(clientName === undefined ? {} : { clientName }),
    ...(phase === undefined ? {} : { phase }),
    ...(startDate === undefined ? {} : { startDate: new Date(startDate) }),
    ...(targetDate === undefined ? {} : { targetDate: new Date(targetDate) }),
  });

  const state = await settle(result, '/projects');
  if (state.error) return state;
  if (result.state === 'ready') redirect(`/projects/${result.data.id}`);
  return state;
}

/** Every sub-resource action revalidates its project's page, which is the only page that renders it. */
const page = (projectId: string) => `/projects/${projectId}`;

export async function createSiteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const siteCode = optional(form, 'siteCode');
  const name = optional(form, 'name');
  if (!siteCode || !name) return { error: 'A site code and a name are required.' };
  const regionName = optional(form, 'regionName');
  const city = optional(form, 'city');
  return settle(await createSite(projectId, {
    siteCode, name,
    ...(regionName === undefined ? {} : { regionName }),
    ...(city === undefined ? {} : { city }),
  }), page(projectId));
}

export async function updateSiteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const name = optional(form, 'name');
  const status = optional(form, 'status');
  return settle(await updateSite(String(form.get('siteId')), {
    ...(name === undefined ? {} : { name }),
    ...(status === undefined ? {} : { status: status as SiteStatus }),
  }), page(projectId));
}

export async function deleteSiteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteSite(String(form.get('siteId'))), page(projectId));
}

export async function createTaskTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const code = optional(form, 'code');
  const name = optional(form, 'name');
  const category = optional(form, 'category');
  if (!code || !name || !category) return { error: 'A code, a name and a category are required.' };
  return settle(await createTaskType(projectId, { code, name, category }), page(projectId));
}

export async function updateTaskTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const name = optional(form, 'name');
  return settle(await updateTaskType(String(form.get('taskTypeId')), {
    ...(name === undefined ? {} : { name }),
    // An unchecked checkbox sends nothing, which is how the form says "retired".
    isActive: form.get('isActive') === 'on',
  }), page(projectId));
}

export async function deleteTaskTypeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteTaskType(String(form.get('taskTypeId'))), page(projectId));
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
  }), page(projectId));
}

export async function updateMilestoneAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const name = optional(form, 'name');
  return settle(await updateMilestone(String(form.get('milestoneId')), {
    ...(name === undefined ? {} : { name }),
    taskTypeIds: form.getAll('taskTypeIds').map(String),
  }), page(projectId));
}

export async function deleteMilestoneAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteMilestone(String(form.get('milestoneId'))), page(projectId));
}

export async function createTaskAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const siteId = optional(form, 'siteId');
  const taskTypeId = optional(form, 'taskTypeId');
  const title = optional(form, 'title');
  if (!siteId || !taskTypeId || !title) return { error: 'A site, a task type and a title are required.' };
  return settle(await createTask(projectId, { siteId, taskTypeId, title, origin: 'AD_HOC' }), page(projectId));
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
  }), page(projectId));
}

export async function deleteTaskAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await deleteTask(String(form.get('taskId'))), page(projectId));
}

export async function updateProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  const name = optional(form, 'name');
  const clientName = optional(form, 'clientName');
  const phase = optional(form, 'phase');
  const status = optional(form, 'status');
  return settle(await updateProject(projectId, {
    ...(name === undefined ? {} : { name }),
    ...(clientName === undefined ? {} : { clientName }),
    ...(phase === undefined ? {} : { phase }),
    ...(status === undefined ? {} : { status: status as ProjectStatus }),
  }), page(projectId));
}

export async function archiveProjectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get('projectId'));
  return settle(await archiveProject(projectId), page(projectId));
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
