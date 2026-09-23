'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { TemplateDocumentInput } from '@ipms/contracts';
import type { ApiResult } from '../../../../lib/api-client';
import { discardDraft, publishTemplate, saveDraft } from '../../../../lib/qc-api';
import { normalizeErrors } from './editor-state';

export interface EditorResult { revision: number | null; error: string | null; fieldErrors: Record<string, string>; conflict: boolean }

const LIST = '/quality/templates';

function failure(result: Exclude<ApiResult<unknown>, { state: 'ready' }>, revision: number | null): EditorResult {
  if (result.state === 'unauthenticated') redirect('/login');
  if (result.state === 'forbidden') return { revision, error: result.message, fieldErrors: {}, conflict: false };
  return { revision, error: result.message, fieldErrors: normalizeErrors(result.details ?? {}), conflict: result.status === 409 };
}

export async function saveDraftAction(templateId: string, revision: number, document: TemplateDocumentInput): Promise<EditorResult> {
  const saved = await saveDraft(templateId, { revision, document });
  if (saved.state !== 'ready') return failure(saved, null);
  revalidatePath(LIST);
  return { revision: saved.data.revision, error: null, fieldErrors: {}, conflict: false };
}

export async function publishDraftAction(templateId: string, revision: number, document: TemplateDocumentInput): Promise<EditorResult> {
  const saved = await saveDraft(templateId, { revision, document });
  if (saved.state !== 'ready') return failure(saved, null);
  const published = await publishTemplate(templateId);
  if (published.state !== 'ready') return failure(published, saved.data.revision);
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${templateId}`);
  redirect(`${LIST}/${templateId}`);
}

export async function discardDraftAction(templateId: string): Promise<EditorResult> {
  const result = await discardDraft(templateId);
  if (result.state !== 'ready') return failure(result, null);
  revalidatePath(LIST);
  redirect(result.data.templateDeleted ? `${LIST}?tab=draft` : `${LIST}/${templateId}`);
}
