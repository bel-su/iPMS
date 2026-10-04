'use client';
import {  } from 'react';
import { useActionStateWithToast } from '../../components/toast';
import { EMPTY } from '../../lib/form-state';
import { FormError, SubmitButton } from '../../components/forms';
import { createTemplateAction, renameTemplateAction } from './actions';
import { CATEGORIES, CATEGORY_LABELS } from './labels';
import type { TemplateCategory } from '../../lib/qc-api';

export function CreateTemplateForm() {
  const [state, action] = useActionStateWithToast(createTemplateAction, EMPTY, 'Checklist created');
  return (
    <form action={action} className="panel-form">
      <div className="form-grid">
        <label className="field">Code
          <input name="code" required maxLength={50} pattern="[A-Za-z0-9_\-]+" />
          <span className="hint">Letters, digits, dash or underscore. Stored in upper case and cannot be changed later.</span>
        </label>
        <label className="field">Name<input name="name" required maxLength={250} /></label>
        <label className="field">Category
          <select name="category" defaultValue="QUALITY">
            {CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
          </select>
        </label>
      </div>
      <FormError state={state} />
      <SubmitButton>Create and open draft</SubmitButton>
    </form>
  );
}

export function RenameTemplateForm({ templateId, name, category }: { templateId: string; name: string; category: TemplateCategory }) {
  const [state, action] = useActionStateWithToast(renameTemplateAction, EMPTY, 'Checklist renamed');
  return (
    <details className="inline-details">
      <summary className="ghost-button">Rename</summary>
      <form action={action} className="panel-form">
        <input type="hidden" name="templateId" value={templateId} />
        <div className="form-grid">
          <label className="field">Name<input name="name" defaultValue={name} maxLength={250} /></label>
          <label className="field">Category
            <select name="category" defaultValue={category}>
              {CATEGORIES.map((option) => <option key={option} value={option}>{CATEGORY_LABELS[option]}</option>)}
            </select>
          </label>
        </div>
        <FormError state={state} />
        <SubmitButton>Save</SubmitButton>
      </form>
    </details>
  );
}
