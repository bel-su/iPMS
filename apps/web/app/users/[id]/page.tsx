import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { getUser, listRoles } from '../../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { AccountStatusForm, EditUserForm, ResetPasswordForm, RoleAssignmentForm } from '../forms';

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, roles, viewer] = await Promise.all([getUser(id), listRoles(), getCurrentUser()]);

  if (user.state === 'unauthenticated') {
    return <StatePage title="Sign in to see this user"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (user.state === 'forbidden') {
    return (
      <StatePage title="Your account cannot view users">
        <p>{user.message}</p>
        <p className="subtle">Ask an administrator for a role that grants <code>user.view</code>.</p>
      </StatePage>
    );
  }
  if (user.state === 'unavailable') {
    return (
      <StatePage title="This user could not be loaded">
        <p>{user.message}</p>
        {user.correlationId ? <p className="subtle">Correlation ID: <code>{user.correlationId}</code></p> : null}
        <a className="ghost-button" href="/users">Back to users</a>
      </StatePage>
    );
  }

  const subject = user.data;

  const identity = viewer.state === 'ready' ? viewer.data : undefined;
  const grantable = roles.state === 'ready'
    ? roles.data.filter((role) => role.isActive && role.assignable)
    : [];

  /**
   * The object gate, applied to the controls rather than to the data: the
   * profile is readable by anyone holding `user.view` — a project manager needs
   * an administrator's name to know who to ask — but only a viewer who may
   * confer every role this user holds may change anything.
   *
   * Derived from the `assignable` flags iam reported rather than from a local
   * copy of the rule, so it cannot disagree with the service. This mirrors
   * `mayManage`, including its vacuous truth for a user holding no roles: such
   * an account has no authority to capture.
   *
   * Presentation only. `UsersService` applies the real gate to every write.
   */
  const assignableCodes = new Set(
    roles.state === 'ready' ? roles.data.filter((role) => role.assignable).map((role) => role.code) : [],
  );
  const manageable = identity !== undefined
    && subject.roles.every((role) => assignableCodes.has(role.code));

  const may = (permission: string): boolean =>
    identity !== undefined && manageable && hasPermission(identity, permission);

  // An actor cannot deactivate their own account; the service refuses it too.
  const mayChangeStatus = subject.isActive
    ? may('user.deactivate') && identity?.id !== subject.id
    : may('user.update');

  return (
    <main className="app-shell">
      <Sidebar active="users" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs">
            <a href="/">Workspace</a><b>/</b><a href="/users">Users</a><b>/</b><strong>{subject.fullName}</strong>
          </div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">{subject.username.toUpperCase()}</p>
              <h1>{subject.fullName}</h1>
            </div>
            <span className={subject.isActive ? 'badge green' : 'badge'}>
              {subject.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>

          <section className="panel">
            <dl className="detail-grid">
              <div><dt>Email</dt><dd>{subject.email}</dd></div>
              <div><dt>Employee code</dt><dd>{subject.employeeCode ?? '—'}</dd></div>
              <div><dt>Roles</dt><dd>{subject.roles.length === 0 ? '—' : subject.roles.map((r) => r.name).join(', ')}</dd></div>
              <div><dt>Last sign-in</dt><dd>{subject.lastLoginAt ? new Date(subject.lastLoginAt).toLocaleString() : 'Never'}</dd></div>
              <div><dt>Added</dt><dd>{new Date(subject.createdAt).toLocaleDateString()}</dd></div>
              {subject.mustChangePassword
                ? <div><dt>Password</dt><dd>Must be changed at next sign-in</dd></div>
                : null}
            </dl>
          </section>

          {!manageable ? (
            <section className="panel">
              <p className="subtle">
                This account holds a role you cannot assign, so only an administrator can change it.
              </p>
            </section>
          ) : null}

          {may('user.update') ? (
            <section className="panel">
              <h2>Profile</h2>
              <EditUserForm user={subject} />
            </section>
          ) : null}

          {may('role.assign') ? (
            <section className="panel">
              <h2>Roles</h2>
              <RoleAssignmentForm user={subject} grantable={grantable} />
            </section>
          ) : null}

          {may('user.update') ? (
            <section className="panel">
              <h2>Reset password</h2>
              <ResetPasswordForm user={subject} />
            </section>
          ) : null}

          {mayChangeStatus ? (
            <section className="panel">
              <h2>{subject.isActive ? 'Deactivate' : 'Reactivate'}</h2>
              <p className="subtle">
                {subject.isActive
                  ? 'Deactivating signs this user out everywhere and refuses every future sign-in. The account is kept, so past activity still resolves to a name.'
                  : 'Reactivating lets this user sign in again with their existing password.'}
              </p>
              <AccountStatusForm user={subject} />
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
