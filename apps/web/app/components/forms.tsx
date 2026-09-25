'use client';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { EMPTY, type FormState } from '../lib/form-state';

/**
 * Form pieces every section shares — projects, the checklist library, work
 * orders. They know nothing about what they submit.
 */

/**
 * A password field with an eye button that shows what was typed. The button is
 * `type="button"` so pressing it never submits the form, and it stays out of
 * the tab order's way by following the input rather than preceding it.
 */
export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-field">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible ? <path d="M3 3l18 18" /> : null}
        </svg>
      </button>
    </span>
  );
}

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
