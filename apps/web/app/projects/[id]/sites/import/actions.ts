'use server';
import type { SiteImportCommitDto, SiteImportPreviewDto } from '@ipms/contracts';
import { commitSiteImport, previewSiteImport } from '../../../../lib/project-api';
import { type FormState } from '../../../../lib/form-state';
import { settle } from '../../../../lib/settle';

export interface ImportState extends FormState {
  preview?: SiteImportPreviewDto;
  committed?: { created: number; updated: number };
}

export async function previewImportAction(_previous: ImportState, form: FormData): Promise<ImportState> {
  const projectId = String(form.get('projectId'));
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a .xlsx file to preview.' };

  const result = await previewSiteImport(projectId, file);
  // Nothing was written, so there is nothing to revalidate — but settle still
  // handles an expired session and the service's own error messages.
  const state = await settle(result, `/projects/${projectId}/sites/import`);
  if (state.error) return state;
  return result.state === 'ready' ? { preview: result.data } : state;
}

export async function commitImportAction(_previous: ImportState, form: FormData): Promise<ImportState> {
  const projectId = String(form.get('projectId'));
  const raw = String(form.get('payload'));
  let payload: SiteImportCommitDto | null = null;
  try {
    payload = JSON.parse(raw) as SiteImportCommitDto | null;
  } catch {
    payload = null;
  }
  if (!payload) return { error: 'Fix the file and preview it again before importing.' };

  const result = await commitSiteImport(projectId, payload);
  const state = await settle(result, `/projects/${projectId}`);
  if (state.error) return state;
  return result.state === 'ready' ? { committed: result.data } : state;
}
