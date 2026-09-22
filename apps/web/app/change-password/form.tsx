'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { changePasswordAction } from '../users/actions';
import { EMPTY } from '../lib/form-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? 'Working…' : 'Change password'}
    </button>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, EMPTY);
  return (
    <form action={action} className="panel-form">
      <label className="field">
        Current password
        <input name="currentPassword" type="password" required maxLength={200} autoComplete="current-password" />
      </label>
      <label className="field">
        New password
        <input name="newPassword" type="password" required minLength={12} maxLength={200} autoComplete="new-password" />
        <span className="hint">At least 12 characters.</span>
      </label>
      <label className="field">
        Confirm new password
        <input name="confirmPassword" type="password" required minLength={12} maxLength={200} autoComplete="new-password" />
      </label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
