/**
 * The signed-in chrome. Every page that uses `.app-shell` must render the
 * sidebar: `.content` reserves its width unconditionally, so a page without one
 * is laid out against an empty gutter.
 */

import { cookies } from 'next/headers';
import { BrandLogo, BrandMark } from './components/brand';
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from './components/sidebar-state';
import { SidebarToggle } from './components/sidebar-toggle';
import { getCurrentUser, hasPermission, mayReadDocs } from './lib/iam-api';
import { getMyProfile } from './lib/user-api';

function Icon({ children }: { children: React.ReactNode }) { return <span className="icon" aria-hidden="true">{children}</span>; }

type Section = 'overview' | 'projects' | 'checklists' | 'work-orders' | 'users' | 'docs' | 'profile';

const QUALITY: readonly Section[] = ['checklists', 'work-orders'];

function NavItem({ section, active, href, icon, children, nested = false }: {
  section: Section; active: Section; href: string; icon: string; children: React.ReactNode; nested?: boolean;
}) {
  const current = section === active;
  return (
    <a className={`nav-item${nested ? ' nested' : ''}${current ? ' active' : ''}`} href={href} aria-current={current ? 'page' : undefined}>
      <Icon>{icon}</Icon><span className="nav-label">{children}</span>
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
  const mayReadDocumentation = viewer.state === 'ready' && mayReadDocs(viewer.data);
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === SIDEBAR_COLLAPSED;

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <SidebarToggle initiallyCollapsed={collapsed} />
      {/* Both rendered: the toggle flips the class client-side, so CSS picks which shows. */}
      <a className="brand" href="/" aria-label="iPMS home"><BrandLogo width={184} /><BrandMark size={34} /></a>
      <p className="workspace-label">WORKSPACE</p>
      <nav aria-label="Primary navigation">
        <NavItem section="overview" active={active} href="/" icon="▦">Overview</NavItem>
        <NavItem section="projects" active={active} href="/projects" icon="◫">Projects</NavItem>
        {mayViewTemplates || mayViewTasks
          ? <div className="nav-group" role="group" aria-label="Quality & EHS">
              {/* The heading is a link to whichever of its pages the viewer can open, work orders first. */}
              <a className={QUALITY.includes(active) ? 'nav-item nav-parent open' : 'nav-item nav-parent'} href={mayViewTasks ? '/quality/work-orders' : '/quality/templates'}>
                <Icon>✓</Icon><span className="nav-label">Quality &amp; EHS</span>
              </a>
              {mayViewTemplates ? <NavItem section="checklists" active={active} href="/quality/templates" icon="▤" nested>Checklist library</NavItem> : null}
              {mayViewTasks ? <NavItem section="work-orders" active={active} href="/quality/work-orders" icon="☰" nested>Work orders</NavItem> : null}
            </div>
          : null}
        {mayViewUsers ? <NavItem section="users" active={active} href="/users" icon="◉">Users</NavItem> : null}
      </nav>
      {mayReadDocumentation
        ? <div className="sidebar-bottom"><NavItem section="docs" active={active} href="/docs" icon="?">Documentation</NavItem></div>
        : null}
    </aside>
  );
}

/** "Jane Doe" → "JD"; falls back to the first two letters of a single name. */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1] ?? '' : '';
  const letters = last ? `${first.charAt(0)}${last.charAt(0)}` : first.slice(0, 2);
  return letters.toUpperCase() || '?';
}

/**
 * The right-hand end of the topbar. Anything passed in sits before the profile
 * menu; the wrapper is what pushes the group away from the breadcrumbs.
 *
 * The menu is a `<details>` so it opens without client-side JavaScript.
 * Signing out stays a POST, so it cannot be triggered by a link. When the
 * profile call fails the button shows "?" and the menu still works.
 */
export async function TopActions({ children }: { children?: React.ReactNode }) {
  const me = await getMyProfile();
  const name = me.state === 'ready' ? me.data.fullName : '';
  return (
    <div className="top-actions">
      {children}
      <details className="profile-menu">
        <summary className="profile" aria-label="Account menu"><span>{initialsOf(name)}</span><i>⌄</i></summary>
        <div className="profile-dropdown" role="menu">
          {name ? <p className="profile-name">{name}</p> : null}
          <a role="menuitem" href="/profile">Profile</a>
          <form action="/api/auth/logout" method="post">
            <button role="menuitem" type="submit">Sign out</button>
          </form>
        </div>
      </details>
    </div>
  );
}

/** The signed-out / error surface, which stands on its own without the shell. */
export function StatePage({ eyebrow, title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  return (
    <main className="state-page">
      <section className="state-card">
        <a className="brand" href="/" aria-label="iPMS home"><BrandMark /></a>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}
