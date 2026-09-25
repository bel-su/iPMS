import { getCurrentUser } from '../../lib/iam-api';
import { listRoles } from '../../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { CreateUserForm } from '../forms';

export default async function NewUserPage() {
  const [roles, viewer] = await Promise.all([listRoles(), getCurrentUser()]);

  if (roles.state === 'unauthenticated' || viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to add a user"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (roles.state === 'forbidden') {
    return (
      <StatePage title="Your account cannot add users">
        <p>{roles.message}</p>
        <p className="subtle">Ask an administrator for a role that grants <code>user.create</code>.</p>
      </StatePage>
    );
  }
  if (roles.state === 'unavailable' || viewer.state !== 'ready') {
    const message = roles.state === 'unavailable' ? roles.message : 'Your identity could not be resolved.';
    return <StatePage title="User directory is not available"><p>{message}</p></StatePage>;
  }

  /**
   * Presentation only: `assignable` is iam's own answer, from the same table it
   * enforces writes with, so this form cannot offer a grant that would be
   * refused on submit.
   */
  const grantable = roles.data.filter((role) => role.isActive && role.assignable);

  return (
    <main className="app-shell">
      <Sidebar active="users" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/users">Users</a><b>/</b><strong>New</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">ADD SOMEONE</p><h1>New user</h1></div>
          </div>
          <section className="panel">
            <CreateUserForm grantable={grantable} />
          </section>
        </div>
      </section>
    </main>
  );
}
