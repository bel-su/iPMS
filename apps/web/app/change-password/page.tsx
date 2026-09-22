import { StatePage } from '../shell';
import { ChangePasswordForm } from './form';

/**
 * Deliberately outside the app shell.
 *
 * A user who owes a password change holds a token with no roles and no
 * permissions, so every sidebar link would lead to a forbidden state.
 * `StatePage` is the surface for exactly that: it stands on its own and offers
 * one action.
 *
 * Reachable voluntarily too — anyone signed in may change their own password
 * here — so it never asserts that a change is owed.
 */
export default function ChangePasswordPage() {
  return (
    <StatePage eyebrow="YOUR ACCOUNT" title="Choose a new password">
      <p className="subtle">
        Your password must be at least 12 characters. You will be asked to sign in again afterwards.
      </p>
      <ChangePasswordForm />
    </StatePage>
  );
}
