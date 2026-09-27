'use client';
import { useState } from 'react';
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from './sidebar-state';

/**
 * Collapses the sidebar to an icon rail. It flips the class on the `<aside>`
 * itself rather than re-rendering the server-owned navigation, and remembers
 * the choice in a cookie so the next page renders the same way from the server.
 */
export function SidebarToggle({ initiallyCollapsed }: { initiallyCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const next = !collapsed;
    setCollapsed(next);
    event.currentTarget.closest('.sidebar')?.classList.toggle('collapsed', next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? SIDEBAR_COLLAPSED : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {collapsed ? (
          <polyline points="9 18 15 12 9 6" />
        ) : (
          <polyline points="15 18 9 12 15 6" />
        )}
      </svg>
    </button>
  );
}
