'use server';
import { redirect } from 'next/navigation';
import {
  cancelWorkOrder, createWorkOrders, getProject, listAssignable, updateWorkOrder, type AssignableUser,
} from '../lib/project-api';
import { getVersion, type ChecklistSection } from '../lib/qc-api';
import type { FormState } from '../lib/form-state';
import { optional, settle } from '../lib/settle';
import { projectPages } from '../projects/[id]/paths';
import { isWorkOrderType } from './labels';

export type ChecklistPreview =
  | { state: 'ready'; sections: ChecklistSection[] }
  | { state: 'error'; message: string };

export interface ProjectSite { id: string; siteCode: string; name: string; city: string | null; area: string | null }

export type ProjectContext =
  | { state: 'ready'; sites: ProjectSite[]; assignable: AssignableUser[] }
  | { state: 'error'; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (value: string | undefined): value is string => value !== undefined && !Number.isNaN(new Date(value).getTime());

/** Every page a work order change shows on. */
const pages = (projectId: string, workOrderId?: string) => [
  '/work-orders', ...(workOrderId ? [`/work-orders/${workOrderId}`] : []), ...projectPages(projectId),
];

export async function createWorkOrdersAction(_previous: FormState, form: FormData): Promise<FormState> {
  const projectId = optional(form, 'projectId');
  const workOrderType = optional(form, 'workOrderType');
  const templateId = optional(form, 'templateId');
  const siteIds = form.getAll('siteIds').map(String).filter(Boolean);
  const assigneeId = optional(form, 'assigneeId');
  const planned = optional(form, 'plannedCompletionAt');
  const note = optional(form, 'note');
  if (!projectId) return { error: 'Choose a project.' };
  if (!isWorkOrderType(workOrderType)) return { error: 'Choose the kind of check.' };
  if (!templateId) return { error: 'Choose a checklist.' };
  if (siteIds.length === 0) return { error: 'Choose at least one site.' };
  if (!assigneeId) return { error: 'Choose the responsible person.' };
  if (!validDate(planned)) return { error: 'Choose a planned completion date.' };

  const result = await createWorkOrders(projectId, {
    workOrderType, templateId, siteIds, assigneeId, plannedCompletionAt: new Date(planned), ...(note ? { note } : {}),
  });
  const state = await settle(result, pages(projectId));
  if (state.error || result.state !== 'ready') return state;
  redirect(`/work-orders?projectId=${projectId}&created=${result.data.created.length}`);
}

export async function updateWorkOrderAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  const projectId = String(form.get('projectId'));
  const assigneeId = optional(form, 'assigneeId');
  const planned = optional(form, 'plannedCompletionAt');
  if (!assigneeId && !validDate(planned)) return { error: 'Choose a person or a date.' };
  return settle(await updateWorkOrder(id, {
    ...(assigneeId ? { assigneeId } : {}),
    ...(validDate(planned) ? { plannedCompletionAt: new Date(planned) } : {}),
  }), pages(projectId, id));
}

export async function cancelWorkOrderAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('id'));
  const projectId = String(form.get('projectId'));
  const reason = optional(form, 'reason');
  if (!reason || reason.length < 3) return { error: 'Say why it is being cancelled.' };
  return settle(await cancelWorkOrder(id, { reason }), pages(projectId, id));
}

/**
 * The checklist a work order will carry, for the outline. A Server Action so
 * the browser never holds the API token; the gateway still checks the caller
 * may view templates.
 */
export async function loadChecklistAction(templateId: string, version: number): Promise<ChecklistPreview> {
  if (!UUID.test(templateId) || !Number.isInteger(version) || version < 1) return { state: 'error', message: 'Unknown template.' };
  const result = await getVersion(templateId, version);
  if (result.state === 'unauthenticated') redirect('/login');
  if (result.state !== 'ready') return { state: 'error', message: result.message };
  return { state: 'ready', sections: result.data.version.sections };
}

/** A project's sites and who may be made responsible there, for the composer when the project changes. */
export async function loadProjectAction(projectId: string): Promise<ProjectContext> {
  if (!UUID.test(projectId)) return { state: 'error', message: 'Unknown project.' };
  const [project, assignable] = await Promise.all([getProject(projectId), listAssignable(projectId)]);
  if (project.state === 'unauthenticated' || assignable.state === 'unauthenticated') redirect('/login');
  if (project.state !== 'ready') return { state: 'error', message: project.message };
  if (assignable.state !== 'ready') return { state: 'error', message: assignable.message };
  return {
    state: 'ready',
    sites: project.data.sites.map((site) => ({ id: site.id, siteCode: site.siteCode, name: site.name, city: site.city, area: site.area })),
    assignable: assignable.data,
  };
}
