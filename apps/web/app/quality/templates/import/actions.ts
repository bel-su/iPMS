'use server';
import { redirect } from 'next/navigation';
import type { ImportCommitDto, TemplateImportPreview } from '@ipms/contracts';
import { commitTemplateImport, previewTemplateImport } from '../../../lib/qc-api';
import type { FormState } from '../../../lib/form-state';
import { settle } from '../../../lib/settle';

export interface TemplateImportState extends FormState {
  preview?: TemplateImportPreview;
}

export async function previewTemplateImportAction(_previous: TemplateImportState, form: FormData): Promise<TemplateImportState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a .xlsx file to preview.' };
  const result = await previewTemplateImport(file);
  const state = await settle(result, '/quality/templates/import');
  if (state.error) return state;
  return result.state === 'ready' ? { preview: result.data } : state;
}

export async function commitTemplateImportAction(_previous: TemplateImportState, form: FormData): Promise<TemplateImportState> {
  let payload: ImportCommitDto | null;
  try {
    payload = JSON.parse(String(form.get('payload'))) as ImportCommitDto | null;
  } catch {
    payload = null;
  }
  if (!payload) return { error: 'Preview the file again before importing.' };
  const result = await commitTemplateImport(payload);
  const state = await settle(result, ['/quality/templates']);
  if (state.error) return state;
  if (result.state === 'ready') redirect(`/quality/templates/${result.data.templateId}/draft`);
  return state;
}
