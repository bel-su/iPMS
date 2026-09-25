import { getMyProfile } from '../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../shell';

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
}

/** The signed-in user's own details. Read-only: changes to name, email or role go through a manager. */
export default async function ProfilePage() {
  const me = await getMyProfile();
  if (me.state === 'unauthenticated') {
    return <StatePage title="Sign in to see your profile"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (me.state !== 'ready') {
    return <StatePage title="Your profile is not available"><p>{me.message}</p></StatePage>;
  }
  const user = me.data;

  return (
    <main className="app-shell">
      <Sidebar active="profile" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Profile</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">YOUR ACCOUNT</p><h1>{user.fullName}</h1><p className="subtle">To change your name, email or role, ask a manager.</p></div>
            <a className="primary-button" href="/change-password">Change password</a>
          </div>
          <section className="panel">
            <h2 className="panel-title">Details</h2>
            <dl className="profile-grid">
              <div><dt>Email</dt><dd>{user.email}</dd></div>
              <div><dt>Employee code</dt><dd>{user.employeeCode ?? '—'}</dd></div>
              <div><dt>Roles</dt><dd>{user.roles.length > 0 ? user.roles.map((r) => r.name).join(', ') : 'None'}</dd></div>
              <div><dt>Status</dt><dd>{user.isActive ? 'Active' : 'Inactive'}</dd></div>
              <div><dt>Last sign-in</dt><dd>{formatDate(user.lastLoginAt)}</dd></div>
              <div><dt>Member since</dt><dd>{formatDate(user.createdAt)}</dd></div>
            </dl>
          </section>
        </div>
      </section>
    </main>
  );
}
