'use server';
import { redirect } from 'next/navigation';
import { createTemplate, disableTemplate, enableTemplate, startDraft, updateTemplate, type TemplateCategory } from '../../lib/qc-api';
import type { FormState } from '../../lib/form-state';
import { optional, settle } from '../../lib/settle';

const CATEGORIES: readonly TemplateCategory[] = ['QUALITY', 'EHS', 'OTHER'];
const LIST = '/quality/templates';
const detail = (id: string): string => `${LIST}/${id}`;

function readCategory(form: FormData): TemplateCategory | undefined {
  const value = form.get('category');
  return CATEGORIES.find((category) => category === value);
}

export async function createTemplateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const code = optional(form, 'code')?.toUpperCase();
  const name = optional(form, 'name');
  const category = readCategory(form);
  if (!code || !name || !category) return { error: 'Code, name and category are required.' };
  const result = await createTemplate({ code, name, category });
  const state = await settle(result, LIST);
  if (state.error) return state;
  if (result.state === 'ready') redirect(`${detail(result.data.templateId)}/draft`);
  return state;
}

export async function renameTemplateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('templateId'));
  const name = optional(form, 'name');
  const category = readCategory(form);
  if (!name && !category) return { error: 'Enter a new name or pick a category.' };
  const result = await updateTemplate(id, { ...(name ? { name } : {}), ...(category ? { category } : {}) });
  return settle(result, [LIST, detail(id)]);
}

export async function startDraftAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('templateId'));
  const result = await startDraft(id);
  const state = await settle(result, [LIST, detail(id)]);
  if (state.error) return state;
  redirect(`${detail(id)}/draft`);
}

export async function disableTemplateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('templateId'));
  return settle(await disableTemplate(id), [LIST, detail(id)]);
}

export async function enableTemplateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get('templateId'));
  return settle(await enableTemplate(id), [LIST, detail(id)]);
}
