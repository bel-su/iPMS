/**
 * The signed-in chrome. Every page that uses `.app-shell` must render the
 * sidebar: `.content` reserves its width unconditionally, so a page without one
 * is laid out against an empty gutter.
 */

import { getCurrentUser, hasPermission } from './lib/iam-api';

function Icon({ children }: { children: React.ReactNode }) { return <span className="icon" aria-hidden="true">{children}</span>; }

type Section = 'overview' | 'projects' | 'quality' | 'work-orders' | 'users';

function NavItem({ section, active, href, icon, children }: {
  section: Section; active: Section; href: string; icon: string; children: React.ReactNode;
}) {
  const current = section === active;
  return (
    <a className={current ? 'nav-item active' : 'nav-item'} href={href} aria-current={current ? 'page' : undefined}>
      <Icon>{icon}</Icon>{children}
    </a>
  );
}

/**
 * Asks who the viewer is rather than taking it as a prop, so every page's call
 * site stays `<Sidebar active="…" />` and no page has to thread an identity it
 * does not otherwise need.
 *
 * Hiding an item is UX, never a boundary: `/users` renders its own forbidden
 * state, and the gateway refuses the request underneath either way. When the
 * identity call fails the item is hidden — the fail-closed direction — and the
 * rest of the navigation still renders.
 */
export async function Sidebar({ active }: { active: Section }) {
  const viewer = await getCurrentUser();
  const mayViewUsers = viewer.state === 'ready' && hasPermission(viewer.data, 'user.view');
  const mayViewTemplates = viewer.state === 'ready' && hasPermission(viewer.data, 'qc_template.view');
  const mayViewTasks = viewer.state === 'ready' && hasPermission(viewer.data, 'task.view');

  return (
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="iPMS home"><span>i</span>PMS</a>
      <p className="workspace-label">WORKSPACE</p>
      <nav aria-label="Primary navigation">
        <NavItem section="overview" active={active} href="/" icon="▦">Overview</NavItem>
        <NavItem section="projects" active={active} href="/projects" icon="◫">Projects</NavItem>
        {mayViewTemplates ? <NavItem section="quality" active={active} href="/quality/templates" icon="✓">Quality &amp; EHS</NavItem> : null}
        {mayViewTasks ? <NavItem section="work-orders" active={active} href="/work-orders" icon="☰">Work orders</NavItem> : null}
        {mayViewUsers ? <NavItem section="users" active={active} href="/users" icon="◉">Users</NavItem> : null}
      </nav>
      <div className="sidebar-bottom"><a className="nav-item" href="/#settings"><Icon>⚙</Icon>Settings</a></div>
    </aside>
  );
}

/**
 * The right-hand end of the topbar. Anything passed in sits before the profile
 * button; the wrapper is what pushes the group away from the breadcrumbs.
 *
 * Signing out is a POST so it works without client-side JavaScript, and cannot
 * be triggered by a link.
 */
export function TopActions({ children }: { children?: React.ReactNode }) {
  return (
    <div className="top-actions">
      {children}
      <form action="/api/auth/logout" method="post">
        <button className="profile" type="submit" aria-label="Sign out"><span>IP</span><i>⌄</i></button>
      </form>
    </div>
  );
}

/** The signed-out / error surface, which stands on its own without the shell. */
export function StatePage({ eyebrow, title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  return (
    <main className="state-page">
      <section className="state-card">
        <a className="brand" href="/"><span>i</span>PMS</a>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}
