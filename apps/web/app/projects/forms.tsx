'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createProjectAction } from './actions';
import { EMPTY, type FormState } from './form-state';

/** Disables itself while the action runs, so a slow API cannot be double-submitted. */
export function SubmitButton({ children, className = 'primary-button' }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending}>{pending ? 'Working…' : children}</button>;
}

export function FormError({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <p className="form-error" role="alert">
      {state.error}
      {state.correlationId ? <> <span className="subtle">({state.correlationId})</span></> : null}
    </p>
  );
}

export function CreateProjectForm() {
  const [state, action] = useActionState(createProjectAction, EMPTY);
  return (
    <form action={action} style={{ padding: 20 }}>
      <div className="form-grid">
        <label className="field">Code<input name="code" required pattern="[A-Z0-9_\-]+" maxLength={50} /><span className="hint">Upper case, digits, dash or underscore.</span></label>
        <label className="field">Name<input name="name" required maxLength={200} /></label>
        <label className="field">Client<input name="clientName" maxLength={200} /></label>
        <label className="field">Phase<input name="phase" maxLength={100} /></label>
        <label className="field">Start date<input name="startDate" type="date" /></label>
        <label className="field">Target date<input name="targetDate" type="date" /></label>
      </div>
      <FormError state={state} />
      <p className="form-note">New projects start as <code>DRAFT</code>.</p>
      <SubmitButton>Create project</SubmitButton>
    </form>
  );
}
