'use client';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  createUserAction, deactivateUserAction, reactivateUserAction,
  resetUserPasswordAction, setUserRolesAction, updateUserAction,
} from './actions';
import { PasswordInput } from '../components/forms';
import { EMPTY, type FormState } from '../lib/form-state';
import type { Permission, Role, User, UserRoleSummary } from '../lib/user-api';
import { summarizeAccess, type RolePermissions } from './role-access';

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
 * What the chosen role allows, grouped by module. It sits between the role
 * choice and the save button so the effect of a change is visible before it is
 * made.
 *
 * Presentation only, and roles only: iam decides, and a user's real access also
 * depends on per-user overrides and project scope.
 */
function RoleAccessSummary({ selected, roles, catalog }: {
  selected: string | undefined; roles: RolePermissions[]; catalog: Permission[];
}) {
  const { total, groups } = summarizeAccess(selected === undefined ? [] : [selected], roles, catalog);
  return (
    <section className="role-access" aria-live="polite">
      <div className="role-access-heading">
        <strong>What this role allows</strong>
        {total > 0
          ? <span className="subtle">{total} permission{total === 1 ? '' : 's'} across {groups.length} area{groups.length === 1 ? '' : 's'}</span>
          : null}
      </div>
      {total === 0 ? (
        <p className="subtle">{selected === undefined ? 'Choose a role to see what it allows.' : 'This role grants no permissions.'}</p>
      ) : (
        <dl className="role-access-list">
          {groups.map((group) => (
            <div key={group.module}>
              <dt>{group.label}</dt>
              <dd className="chips">
                {group.permissions.map((permission) => (
                  <span key={permission.code} className="chip" title={permission.code}>{permission.description}</span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/**
 * The role choice. A user holds exactly one role, so this is a radio group and
 * a role is required; iam refuses more than one as well.
 *
 * `grantable` is the set this viewer may confer, already filtered by the page
 * against the same table the service enforces — so this form cannot offer a
 * grant that would be refused on submit.
 *
 * `locked` is a role the target already holds that this viewer may *not*
 * confer. It renders selected and disabled, with no `name`, so it is visible
 * but unsubmittable.
 *
 * `roles` is every role the page could read, locked ones included, so the
 * summary can describe a locked role too.
 */
function RolePicker({ grantable, held, locked, roles, catalog }: {
  grantable: Role[]; held: string | undefined; locked: UserRoleSummary[];
  roles: RolePermissions[]; catalog: Permission[];
}) {
  const [selected, setSelected] = useState<string | undefined>(held);
  return (
    <>
      <fieldset className="checkbox-grid">
        <legend>Role</legend>
        {grantable.map((role) => (
          <label key={role.code} className="checkbox">
            <input
              type="radio" name="roleCodes" value={role.code} required
              defaultChecked={held === role.code}
              onChange={() => setSelected(role.code)}
            />
            {role.name}
          </label>
        ))}
        {locked.map((role) => (
          <label key={role.code} className="checkbox">
            <input type="radio" checked disabled readOnly />
            {role.name} <span className="subtle">(only an administrator can change this)</span>
          </label>
        ))}
        {grantable.length === 0 && locked.length === 0
          ? <p className="subtle">You cannot assign any roles.</p>
          : null}
      </fieldset>
      <RoleAccessSummary selected={selected} roles={roles} catalog={catalog} />
    </>
  );
}

export function CreateUserForm({ grantable, catalog }: { grantable: Role[]; catalog: Permission[] }) {
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
      <RolePicker grantable={grantable} held={undefined} locked={[]} roles={grantable} catalog={catalog} />
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

export function RoleAssignmentForm({ user, grantable, roles, catalog }: {
  user: User; grantable: Role[]; roles: Role[]; catalog: Permission[];
}) {
  const [state, action] = useActionState(setUserRolesAction, EMPTY);
  const grantableCodes = new Set(grantable.map((role) => role.code));
  const locked = user.roles.filter((role) => !grantableCodes.has(role.code));
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="userId" value={user.id} />
      <RolePicker
        grantable={grantable} held={user.roles[0]?.code} locked={locked}
        roles={roles} catalog={catalog}
      />
      <FormError state={state} />
      <p className="form-note">Changing the role signs this user out of every device.</p>
      <SubmitButton>Save role</SubmitButton>
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
