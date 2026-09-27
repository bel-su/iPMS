import { getMyProfile } from '../lib/user-api';
import { initialsOf, Sidebar, StatePage, TopActions } from '../shell';
import { ProfileManager } from './profile-form';

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
}

/** The signed-in user's profile and self-management center. */
export default async function ProfilePage() {
  const me = await getMyProfile();
  if (me.state === 'unauthenticated') {
    return <StatePage title="Sign in to see your profile"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (me.state !== 'ready') {
    return <StatePage title="Your profile is not available"><p>{me.message}</p></StatePage>;
  }
  const user = me.data;
  const primaryRole = user.roles[0]?.name ?? 'Standard User';

  return (
    <main className="app-shell">
      <Sidebar active="profile" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/profile">Account</a><b>/</b><strong>Profile</strong></div>
          <TopActions />
        </header>

        <div className="dashboard">
          {/* Enhanced Profile Hero Banner */}
          <section className="profile-hero">
            <div className="profile-hero-content">
              <div className="profile-hero-avatar">
                {initialsOf(user.fullName)}
              </div>
              <div className="profile-hero-info">
                <div className="profile-hero-title-row">
                  <h1>{user.fullName}</h1>
                  <span className="profile-role-pill">{primaryRole}</span>
                  {user.isActive ? (
                    <span className="profile-status-pill active">
                      <span className="pulse-dot" aria-hidden="true" />
                      Active
                    </span>
                  ) : (
                    <span className="profile-status-pill inactive">Inactive</span>
                  )}
                </div>
                <div className="profile-hero-meta">
                  <span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    {user.email}
                  </span>
                  {user.employeeCode ? (
                    <span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      Badge: <strong>{user.employeeCode}</strong>
                    </span>
                  ) : null}
                  <span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    Last sign-in: {formatDate(user.lastLoginAt)}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Interactive Profile Management Hub */}
          <ProfileManager user={user} />
        </div>
      </section>
    </main>
  );
}
