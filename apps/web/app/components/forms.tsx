'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { EMPTY, type FormState } from '../lib/form-state';

/**
 * Form pieces every section shares — projects, the checklist library, work
 * orders. They know nothing about what they submit.
 */

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

/**
 * A one-button form for a destructive row action.
 *
 * A form rather than a link because a GET must not delete anything, and a
 * confirm because the row itself offers no other chance to stop. The action is
 * passed in by the page: a Server Action reference crosses this boundary
 * fine, and it keeps this component ignorant of what it is deleting.
 */
export function RowAction({
  action, hidden, label, confirm, className = 'danger-button',
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  label: string;
  confirm?: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY);
  return (
    <form action={formAction} onSubmit={(event) => { if (confirm && !window.confirm(confirm)) event.preventDefault(); }}>
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <SubmitButton className={className}>{label}</SubmitButton>
      <FormError state={state} />
    </form>
  );
}
