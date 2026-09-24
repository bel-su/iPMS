'use server';
import { redirect } from 'next/navigation';
import { createWorkOrder } from '../../../lib/project-api';
import { getVersion, type ChecklistSection } from '../../../lib/qc-api';
import type { FormState } from '../../../lib/form-state';
import { optional, settle } from '../../../lib/settle';
import { projectPages } from '../paths';
import { isWorkOrderType } from './labels';

/** What the creator shows after a submit: an error, or — with continuous creation — the work order just made. */
export interface WorkOrderFormState extends FormState {
  created?: { id: string; title: string };
}

export type ChecklistPreview =
  | { state: 'ready'; sections: ChecklistSection[] }
  | { state: 'error'; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listPath = (projectId: string) => `/projects/${projectId}/work-orders`;

export async function createWorkOrderAction(_previous: WorkOrderFormState, form: FormData): Promise<WorkOrderFormState> {
  const projectId = String(form.get('projectId'));
  const workOrderType = optional(form, 'workOrderType');
  const templateId = optional(form, 'templateId');
  const siteId = optional(form, 'siteId');
  const assigneeId = optional(form, 'assigneeId');
  const planned = optional(form, 'plannedCompletionAt');
  const title = optional(form, 'title');
  if (!isWorkOrderType(workOrderType)) return { error: 'Choose a work order type.' };
  if (!templateId) return { error: 'Choose a template.' };
  if (!planned || Number.isNaN(new Date(planned).getTime())) return { error: 'Choose a planned completion date.' };
  if (!siteId) return { error: 'Choose a site.' };
  if (!assigneeId) return { error: 'Choose the responsible person.' };
  if (!title) return { error: 'The work order needs a name.' };

  const result = await createWorkOrder(projectId, {
    workOrderType, templateId, siteId, assigneeId, title, plannedCompletionAt: new Date(planned),
  });
  const state = await settle(result, [listPath(projectId), ...projectPages(projectId)]);
  if (state.error || result.state !== 'ready') return state;
  // An unchecked checkbox sends nothing.
  if (form.get('continuous') !== 'on') redirect(listPath(projectId));
  return { created: { id: result.data.id, title: result.data.title } };
}

/**
 * The checklist a work order will carry, for the preview. A Server Action so
 * the browser never holds the API token; the gateway still checks the
 * caller may view templates.
 */
export async function loadChecklistAction(templateId: string, version: number): Promise<ChecklistPreview> {
  if (!UUID.test(templateId) || !Number.isInteger(version) || version < 1) return { state: 'error', message: 'Unknown template.' };
  const result = await getVersion(templateId, version);
  if (result.state === 'unauthenticated') redirect('/login');
  if (result.state !== 'ready') return { state: 'error', message: result.message };
  return { state: 'ready', sections: result.data.version.sections };
}
