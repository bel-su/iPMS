'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  createUserAction, deactivateUserAction, reactivateUserAction,
  resetUserPasswordAction, setUserRolesAction, updateUserAction,
} from './actions';
import { PasswordInput } from '../components/forms';
import { EMPTY, type FormState } from '../lib/form-state';
import type { Role, User, UserRoleSummary } from '../lib/user-api';

/** Disables itself while the action runs, so a slow API cannot be double-submitted. */
function SubmitButton({ children, className = 'primary-button' }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending}>{pending ? 'Working…' : children}</button>;
}

function FormError({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <p className="form-error" role="alert">
      {state.error}
      {state.correlationId ? <> <span className="subtle">({state.correlationId})</span></> : null}
    </p>
  );
}

/**
 * A GET form, not a Server Action.
 *
 * The filters belong in the URL: that makes a filtered view shareable, keeps it
 * across a refresh, and needs no client state or JavaScript at all.
 */
export function UserFilterBar({ search, status }: { search: string; status: string }) {
  return (
    <form className="filter-bar" action="/users" method="get">
      <label className="field">
        Search
        <input name="search" defaultValue={search} placeholder="Name or email" maxLength={150} />
      </label>
      <label className="field">
        Status
        <select name="status" defaultValue={status}>
          <option value="ALL">All</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </label>
      <button className="ghost-button" type="submit">Apply</button>
    </form>
  );
}

/**
 * The role checkboxes.
 *
 * `grantable` is the set this viewer may confer, already filtered by the page
 * against the same table the service enforces — so this form cannot offer a
 * grant that would be refused on submit.
 *
 * `locked` are roles the target already holds that this viewer may *not*
 * confer. They render checked and disabled, with no `name`, so they are visible
 * but unsubmittable. A viewer who cannot see them at all would silently strip
 * them, because the endpoint takes the complete desired set.
 */
function RoleCheckboxes({ grantable, held, locked }: {
  grantable: Role[]; held: Set<string>; locked: UserRoleSummary[];
}) {
  return (
    <fieldset className="checkbox-grid">
      <legend>Roles</legend>
      {grantable.map((role) => (
        <label key={role.code} className="checkbox">
          <input type="checkbox" name="roleCodes" value={role.code} defaultChecked={held.has(role.code)} />
          {role.name}
        </label>
      ))}
      {locked.map((role) => (
        <label key={role.code} className="checkbox">
          <input type="checkbox" checked disabled readOnly />
          {role.name} <span className="subtle">(only an administrator can change this)</span>
        </label>
      ))}
      {grantable.length === 0 && locked.length === 0
        ? <p className="subtle">You cannot assign any roles.</p>
        : null}
    </fieldset>
  );
}

export function CreateUserForm({ grantable }: { grantable: Role[] }) {
  const [state, action] = useActionState(createUserAction, EMPTY);
  return (
    <form action={action} className="panel-form">
      <div className="form-grid">
        <label className="field">Full name<input name="fullName" required maxLength={200} /></label>
        <label className="field">
          Email
          <input name="email" type="email" required maxLength={255} />
          <span className="hint">The user signs in with this address.</span>
        </label>
        <label className="field">Employee code<input name="employeeCode" maxLength={50} /></label>
        <label className="field">
          Temporary password
          <PasswordInput name="password" required minLength={8} maxLength={200} autoComplete="new-password" />
          <span className="hint">At least 8 characters, with an uppercase letter, a lowercase letter, a digit and a symbol.</span>
        </label>
        <label className="field">
          Confirm password
          <PasswordInput name="confirmPassword" required minLength={8} maxLength={200} autoComplete="new-password" />
        </label>
      </div>
      <RoleCheckboxes grantable={grantable} held={new Set()} locked={[]} />
      <FormError state={state} />
      <p className="form-note">
        The new user must change this password the first time they sign in. Until they do, their
        account can do nothing else.
      </p>
      <SubmitButton>Create user</SubmitButton>
    </form>
  );
}

export function EditUserForm({ user }: { user: User }) {
  const [state, action] = useActionState(updateUserAction, EMPTY);
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="userId" value={user.id} />
      <div className="form-grid">
        <label className="field">Full name<input name="fullName" required defaultValue={user.fullName} maxLength={200} /></label>
        <label className="field">Email<input name="email" type="email" required defaultValue={user.email} maxLength={255} /></label>
        <label className="field">
          Employee code
          <input name="employeeCode" defaultValue={user.employeeCode ?? ''} maxLength={50} />
          <span className="hint">Leave empty to remove it.</span>
        </label>
      </div>
      <FormError state={state} />
      <p className="form-note">
        The email is what this user signs in with. Changing it changes their sign-in address.
      </p>
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}

export function RoleAssignmentForm({ user, grantable }: { user: User; grantable: Role[] }) {
  const [state, action] = useActionState(setUserRolesAction, EMPTY);
  const grantableCodes = new Set(grantable.map((role) => role.code));
  const locked = user.roles.filter((role) => !grantableCodes.has(role.code));
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="userId" value={user.id} />
      <RoleCheckboxes grantable={grantable} held={new Set(user.roles.map((r) => r.code))} locked={locked} />
      <FormError state={state} />
      <p className="form-note">Changing roles signs this user out of every device.</p>
      <SubmitButton>Save roles</SubmitButton>
    </form>
  );
}

/**
 * Deactivation and reactivation share a shape but not a meaning, so they are
 * one component with two branches rather than two near-identical ones. Kept
 * apart from the profile form: correcting a misspelled name must not be able
 * to revoke someone's sessions.
 */
export function AccountStatusForm({ user }: { user: User }) {
  const [state, action] = useActionState(
    user.isActive ? deactivateUserAction : reactivateUserAction,
    EMPTY,
  );
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (user.isActive && !window.confirm(`Deactivate ${user.fullName}? They will be signed out immediately.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={user.id} />
      <FormError state={state} />
      {user.isActive
        ? <SubmitButton className="danger-button">Deactivate account</SubmitButton>
        : <SubmitButton className="ghost-button">Reactivate account</SubmitButton>}
    </form>
  );
}

export function ResetPasswordForm({ user }: { user: User }) {
  const [state, action] = useActionState(resetUserPasswordAction, EMPTY);
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="userId" value={user.id} />
      <div className="form-grid">
        <label className="field">
          New password
          <PasswordInput name="password" required minLength={8} maxLength={200} autoComplete="new-password" />
          <span className="hint">At least 8 characters, with an uppercase letter, a lowercase letter, a digit and a symbol.</span>
        </label>
        <label className="field">
          Confirm password
          <PasswordInput name="confirmPassword" required minLength={8} maxLength={200} autoComplete="new-password" />
        </label>
      </div>
      <FormError state={state} />
      <p className="form-note">
        This signs the user out everywhere, and they must change the password again at their next sign-in.
      </p>
      <SubmitButton className="danger-button">Reset password</SubmitButton>
    </form>
  );
}
