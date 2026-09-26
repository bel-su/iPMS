import { ChangePasswordCard } from './form';

/**
 * Deliberately outside the app shell.
 *
 * A user who owes a password change holds a token with no roles and no
 * permissions, so every sidebar link would lead to a forbidden state. The card
 * stands on its own and offers one action.
 *
 * Reachable voluntarily too — anyone signed in may change their own password
 * here — so it never asserts that a change is owed.
 */
export default function ChangePasswordPage() {
  return <ChangePasswordCard />;
}
