'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { changePasswordAction } from '../users/actions';
import { EMPTY } from '../lib/form-state';
import { PasswordInput } from '../components/forms';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? 'Working…' : 'Change password'}
    </button>
  );
}

/**
 * The whole card, not just the form, because success replaces the heading too.
 * Mirrors `StatePage`'s markup, which cannot be used here: `shell.tsx` is
 * server-only.
 *
 * Signing in again goes through the logout route. The change has already
 * revoked this browser's session, and that route is what clears its cookies.
 */
export function ChangePasswordCard() {
  const [state, action] = useActionState(changePasswordAction, EMPTY);

  if (state.done) {
    return (
      <main className="state-page">
        <section className="state-card" role="status">
          <a className="brand" href="/"><span>i</span>PMS</a>
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h1>Password changed</h1>
          <p>Your password was changed successfully. For your security you have been signed out on every device.</p>
          <p>Sign in again with your new password to continue.</p>
          <form action="/api/auth/logout" method="post">
            <button className="primary-button" type="submit">Sign in</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="state-page">
      <section className="state-card">
        <a className="brand" href="/"><span>i</span>PMS</a>
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>Choose a new password</h1>
        <p className="subtle">
          Your password must be at least 8 characters and include an uppercase letter, a lowercase letter, a digit and a symbol. You will be asked to sign in again afterwards.
        </p>
        <form action={action} className="panel-form">
          <label className="field">
            Current password
            <PasswordInput name="currentPassword" required maxLength={200} autoComplete="current-password" />
          </label>
          <label className="field">
            New password
            <PasswordInput name="newPassword" required minLength={8} maxLength={200} autoComplete="new-password" />
            <span className="hint">At least 8 characters, with an uppercase letter, a lowercase letter, a digit and a symbol.</span>
          </label>
          <label className="field">
            Confirm new password
            <PasswordInput name="confirmPassword" required minLength={8} maxLength={200} autoComplete="new-password" />
          </label>
          {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
          <SubmitButton />
        </form>
      </section>
    </main>
  );
}
