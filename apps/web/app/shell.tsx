/**
 * The signed-in chrome. Every page that uses `.app-shell` must render the
 * sidebar: `.content` reserves its width unconditionally, so a page without one
 * is laid out against an empty gutter.
 */

import { cookies } from 'next/headers';
import { BrandMark } from './components/brand';
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from './components/sidebar-state';
import { NotificationCenter } from './components/notification-center';
import { SidebarToggle } from './components/sidebar-toggle';
import { getCurrentUser, hasPermission, mayReadDocs } from './lib/iam-api';
import { getMyProfile } from './lib/user-api';

function OverviewIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ProjectsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 7a2 2 0 0 1 2-2h4l2 2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function QualityIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function WorkOrdersIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8 4 4-4 4" />
    </svg>
  );
}

function ChecklistsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function UsersIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function DocsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ProfileIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

type Section = 'overview' | 'projects' | 'checklists' | 'work-orders' | 'users' | 'docs' | 'profile';

const QUALITY: readonly Section[] = ['checklists', 'work-orders'];

function NavItem({
  section,
  active,
  href,
  icon,
  children,
  nested = false,
  isAction = false,
}: {
  section: Section;
  active: Section;
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  nested?: boolean;
  isAction?: boolean;
}) {
  const current = section === active;
  const tooltipText = typeof children === 'string' ? children : '';
  return (
    <a
      className={`nav-item${nested ? ' nested' : ''}${current ? ' active' : ''}${isAction ? ' action-item' : ''}`}
      href={href}
      aria-current={current ? 'page' : undefined}
      data-tooltip={tooltipText}
    >
      <span className="icon" aria-hidden="true">{icon}</span>
      <span className="nav-label">{children}</span>
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
      {/* Top Header: Brand Badge & Title + Collapse Toggle at Top */}
      <div className="sidebar-header">
        <a className="brand" href="/" aria-label="iPMS home">
          <div className="brand-badge">
            <BrandMark size={22} />
          </div>
          <div className="brand-text">
            <span className="brand-title">iPMS</span>
            <span className="brand-subtitle">Field Platform</span>
          </div>
        </a>
        <SidebarToggle initiallyCollapsed={collapsed} />
      </div>

      <nav aria-label="Primary navigation">
        {/* Standalone Dashboard Item */}
        <NavItem section="overview" active={active} href="/" icon={<OverviewIcon />}>
          Overview
        </NavItem>

        {/* Inset Group Card Container (Matching Reference Image Grouping) */}
        <div className="nav-group-card" role="group" aria-label="Projects & Quality Operations">
          <NavItem section="projects" active={active} href="/projects" icon={<ProjectsIcon />}>
            Projects
          </NavItem>

          {mayViewTemplates || mayViewTasks ? (
            <div className="nav-group" role="group" aria-label="Quality & EHS">
              <a
                className={QUALITY.includes(active) ? 'nav-item nav-parent open' : 'nav-item nav-parent'}
                href={mayViewTasks ? '/quality/work-orders' : '/quality/templates'}
                data-tooltip="Quality & EHS"
              >
                <span className="icon" aria-hidden="true"><QualityIcon size={16} /></span>
                <span className="nav-label">Quality &amp; EHS</span>
              </a>
              {mayViewTasks ? (
                <NavItem
                  section="work-orders"
                  active={active}
                  href="/quality/work-orders"
                  icon={<WorkOrdersIcon />}
                  nested
                  isAction={active === 'work-orders'}
                >
                  Work orders
                </NavItem>
              ) : null}
              {mayViewTemplates ? (
                <NavItem
                  section="checklists"
                  active={active}
                  href="/quality/templates"
                  icon={<ChecklistsIcon />}
                  nested
                >
                  Checklist library
                </NavItem>
              ) : null}
            </div>
          ) : null}

          {mayViewUsers ? (
            <NavItem section="users" active={active} href="/users" icon={<UsersIcon />}>
              Users
            </NavItem>
          ) : null}
        </div>
      </nav>

      {/* Footer Area with Documentation, Live Status & User Profile / Logout */}
      <div className="sidebar-bottom">
        {mayReadDocumentation ? (
          <NavItem section="docs" active={active} href="/docs" icon={<DocsIcon />}>
            Documentation
          </NavItem>
        ) : null}
        <div className="sidebar-footer-row">
          <div className="status-dot-indicator" title="iPMS Core Gateway Online">
            <span className="pulse-dot" aria-hidden="true" />
            <span className="status-text">Online</span>
          </div>
          <div className="sidebar-user-actions">
            <a
              href="/profile"
              className="footer-user-btn"
              title="Account Profile"
              aria-label="Account Profile"
              data-tooltip="Profile"
            >
              <ProfileIcon size={15} />
            </a>
            <form action="/api/auth/logout" method="post" className="sidebar-logout-form">
              <button
                type="submit"
                className="footer-icon-btn logout"
                title="Sign out"
                aria-label="Sign out"
                data-tooltip="Sign out"
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>
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
 * The right-hand end of the topbar. Houses active action buttons passed in
 * and the interactive NotificationCenter bell and flyout panel.
 */
export function TopActions({ children }: { children?: React.ReactNode }) {
  return (
    <div className="top-actions">
      {children}
      <NotificationCenter />
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
