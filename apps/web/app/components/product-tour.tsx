'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';

export interface TourStep {
  id: string;
  selector: string;
  title: string;
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

/** Role-specific Guided Tour steps tailored to permissions and actual workflows. */
const ROLE_STEPS: Record<string, readonly TourStep[]> = {
  finance: [
    {
      id: 'finance-nav',
      selector: '.nav-section[aria-labelledby="nav-finance"], .sidebar nav, a[href="/finance"]',
      title: 'Finance Workspace',
      content: 'Navigate cash advances, expense category limits, and monthly spend reports.',
      placement: 'right',
    },
    {
      id: 'finance-search',
      selector: '.top-search, input[type="search"]',
      title: 'Voucher & Expense Search',
      content: 'Quickly search advance requests by voucher number, engineer name, or cell site code.',
      placement: 'bottom',
    },
    {
      id: 'finance-notifs',
      selector: '.notif-bell-btn, .notif-wrapper',
      title: 'Disbursement Alerts',
      content: 'Receive real-time alerts when field travel claims are submitted or approved for payout.',
      placement: 'bottom',
    },
    {
      id: 'finance-profile',
      selector: '.sidebar-user, .sidebar-user-link',
      title: 'Finance Officer Account',
      content: 'View your assigned finance scope, approval thresholds, and security credentials.',
      placement: 'right',
    },
    {
      id: 'finance-queue',
      selector: '.tabs, .subnav-pills, main header, .finance-view, main',
      title: 'Requests & Approvals',
      content: 'Review pending cash advances, verify site expenses against receipts, and disburse settlements.',
      placement: 'bottom',
    },
  ],
  qc: [
    {
      id: 'qc-nav',
      selector: '.nav-section[aria-labelledby="nav-quality"], .sidebar nav, a[href*="quality"]',
      title: 'Quality & EHS Hub',
      content: 'Access work order review queues and digital checklist template libraries across cell sites.',
      placement: 'right',
    },
    {
      id: 'qc-search',
      selector: '.top-search, input[type="search"]',
      title: 'Inspection Search',
      content: 'Instantly look up work orders by site ID (e.g. KTM-T01), tower height, or assigned field engineer.',
      placement: 'bottom',
    },
    {
      id: 'qc-notifs',
      selector: '.notif-bell-btn, .notif-wrapper',
      title: 'QC Review Alerts',
      content: 'Get notified instantly when field engineers submit completed tower inspection checklists.',
      placement: 'bottom',
    },
    {
      id: 'qc-profile',
      selector: '.sidebar-user, .sidebar-user-link',
      title: 'QC Credentials',
      content: 'Manage your quality assurance credentials, digital sign-off authority, and security settings.',
      placement: 'right',
    },
    {
      id: 'qc-queue',
      selector: '.ov-kpis, .task-list, .queue, main header, main',
      title: 'Quality Review Queue',
      content: 'Examine watermarked photos, verify GPS geofence compliance, and approve or return for rework.',
      placement: 'bottom',
    },
  ],
  manager: [
    {
      id: 'manager-nav',
      selector: '.sidebar nav, a[href="/projects"]',
      title: 'Portfolio Management',
      content: 'Coordinate nationwide telecom rollouts, track cell tower milestones, and assign work packages.',
      placement: 'right',
    },
    {
      id: 'manager-search',
      selector: '.top-search, input[type="search"]',
      title: 'Omni-Search',
      content: 'Locate cell sites, antenna upgrades, and dispatch tickets across all 7 provinces of Nepal.',
      placement: 'bottom',
    },
    {
      id: 'manager-notifs',
      selector: '.notif-bell-btn, .notif-wrapper',
      title: 'Project Updates',
      content: 'Stay informed on task milestone completions, QC approvals, and field dispatch blockers.',
      placement: 'bottom',
    },
    {
      id: 'manager-profile',
      selector: '.sidebar-user, .sidebar-user-link',
      title: 'Manager Identity',
      content: 'Review your assigned project permissions, delegation rules, and administrative preferences.',
      placement: 'right',
    },
    {
      id: 'manager-dashboard',
      selector: '.ov-kpis, .metrics, .workspace-content, main header, main',
      title: 'Operational Metrics',
      content: 'Monitor active cell site installations, completion rates, and daily field crew progress.',
      placement: 'bottom',
    },
  ],
  director: [
    {
      id: 'director-nav',
      selector: '.sidebar nav',
      title: 'Executive Governance',
      content: 'Access high-level project rollouts, audit trails, and multi-region telecom capital allocation.',
      placement: 'right',
    },
    {
      id: 'director-search',
      selector: '.top-search, input[type="search"]',
      title: 'Enterprise Search',
      content: 'Find any telecom project, contractor organisation, or high-value financial disbursement.',
      placement: 'bottom',
    },
    {
      id: 'director-notifs',
      selector: '.notif-bell-btn, .notif-wrapper',
      title: 'Priority Notifications',
      content: 'Get alerted on critical SLA breaches, milestone sign-offs, and major budget authorizations.',
      placement: 'bottom',
    },
    {
      id: 'director-profile',
      selector: '.sidebar-user, .sidebar-user-link',
      title: 'Director Profile',
      content: 'Manage executive security policies, audit delegations, and authentication keys.',
      placement: 'right',
    },
    {
      id: 'director-kpis',
      selector: '.ov-kpis, .metrics, main header, main',
      title: 'Executive Dashboard',
      content: 'Analyze nationwide completion percentages, budget variances, and QC audit compliance rates.',
      placement: 'bottom',
    },
  ],
  admin: [
    {
      id: 'admin-nav',
      selector: '.sidebar nav, a[href="/users"]',
      title: 'Platform Governance',
      content: 'Manage user provisioning, RBAC role assignments, security scopes, and system audit logs.',
      placement: 'right',
    },
    {
      id: 'admin-search',
      selector: '.top-search, input[type="search"]',
      title: 'Global Search',
      content: 'Query any user, tower asset, checklist version, or system activity across the entire platform.',
      placement: 'bottom',
    },
    {
      id: 'admin-notifs',
      selector: '.notif-bell-btn, .notif-wrapper',
      title: 'System Alerts',
      content: 'Real-time monitoring of security access events, role updates, and platform operational status.',
      placement: 'bottom',
    },
    {
      id: 'admin-profile',
      selector: '.sidebar-user, .sidebar-user-link',
      title: 'Admin Credentials',
      content: 'Manage superuser credentials, session policies, and cryptographic security tokens.',
      placement: 'right',
    },
    {
      id: 'admin-overview',
      selector: '.ov-kpis, .metrics, main header, main',
      title: 'System Overview',
      content: 'Track active user sessions, permission distribution, and platform compliance health.',
      placement: 'bottom',
    },
  ],
  engineer: [
    {
      id: 'engineer-nav',
      selector: '.sidebar nav, a[href*="work-order"]',
      title: 'Field Tasks',
      content: 'View assigned cell towers, scheduled maintenance visits, and travel expense claims.',
      placement: 'right',
    },
    {
      id: 'engineer-search',
      selector: '.top-search, input[type="search"]',
      title: 'Site Lookup',
      content: 'Quickly find tower coordinates, site access instructions, and safety guidelines.',
      placement: 'bottom',
    },
    {
      id: 'engineer-notifs',
      selector: '.notif-bell-btn, .notif-wrapper',
      title: 'Task Notifications',
      content: 'Get notified when new work orders are assigned or returned by QC for evidence rework.',
      placement: 'bottom',
    },
    {
      id: 'engineer-profile',
      selector: '.sidebar-user, .sidebar-user-link',
      title: 'Engineer Profile',
      content: 'Check your field certification, regional telecom deployment, and mobile sync status.',
      placement: 'right',
    },
    {
      id: 'engineer-queue',
      selector: '.ov-kpis, .tasks, main header, main',
      title: 'Active Dispatches',
      content: 'Review today\'s assigned tower tasks, execute inspection checklists, and verify site status.',
      placement: 'bottom',
    },
  ],
};

function resolveUserRole(explicitRole?: string): string {
  if (explicitRole) {
    const lower = explicitRole.toLowerCase();
    if (ROLE_STEPS[lower]) return lower;
    if (lower.includes('finance')) return 'finance';
    if (lower.includes('qc') || lower.includes('quality')) return 'qc';
    if (lower.includes('director')) return 'director';
    if (lower.includes('manager')) return 'manager';
    if (lower.includes('engineer')) return 'engineer';
    if (lower.includes('admin')) return 'admin';
  }

  if (typeof document === 'undefined') return 'admin';

  const sidebar = document.querySelector('.sidebar');
  const home = sidebar?.getAttribute('data-user-home');
  if (home && ROLE_STEPS[home.toLowerCase()]) {
    return home.toLowerCase();
  }

  const roleAttr = sidebar?.getAttribute('data-user-role') ||
    document.querySelector('.sidebar-user')?.getAttribute('data-role') ||
    document.querySelector('.sidebar-user-meta span')?.textContent;

  if (roleAttr) {
    const lower = roleAttr.toLowerCase();
    if (lower.includes('finance')) return 'finance';
    if (lower.includes('qc') || lower.includes('quality')) return 'qc';
    if (lower.includes('director')) return 'director';
    if (lower.includes('manager')) return 'manager';
    if (lower.includes('engineer')) return 'engineer';
    if (lower.includes('admin')) return 'admin';
  }

  // Pathname fallback if page is specifically under a role section
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.startsWith('/finance')) return 'finance';
    if (path.startsWith('/quality')) return 'qc';
    if (path.startsWith('/users')) return 'admin';
  }

  return 'admin';
}

export function ProductTour({
  role: propRole,
}: {
  role?: string;
  roles?: string[];
  permissions?: string[];
}) {
  const [mounted, setMounted] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [activeRole, setActiveRole] = useState('admin');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
    arrowPlacement: 'top' | 'bottom' | 'left' | 'right' | 'none';
    arrowOffset: number;
  }>({
    top: 0,
    left: 0,
    arrowPlacement: 'bottom',
    arrowOffset: 32,
  });

  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Determine active role once mounted
  useEffect(() => {
    if (!mounted) return;
    const detected = resolveUserRole(propRole);
    setActiveRole(detected);
  }, [mounted, propRole]);

  const steps = useMemo(() => {
    return ROLE_STEPS[activeRole] ?? ROLE_STEPS.admin!;
  }, [activeRole]);

  // Auto-start tour ONCE per role on initial visit / login
  useEffect(() => {
    if (!mounted) return;
    try {
      const storageKey = `ipms_product_tour_seen_${activeRole}_v2`;
      const hasSeen = localStorage.getItem(storageKey);
      if (!hasSeen) {
        const timer = setTimeout(() => {
          setIsActive(true);
        }, 500);
        return () => clearTimeout(timer);
      }
    } catch {
      // Ignore localStorage access issues
    }
  }, [mounted, activeRole]);

  // Listen to manual restart events if triggered by user
  useEffect(() => {
    const handleStartTour = () => {
      const detected = resolveUserRole(propRole);
      setActiveRole(detected);
      setCurrentStepIndex(0);
      setIsActive(true);
    };
    window.addEventListener('ipms:start-product-tour', handleStartTour);
    return () => window.removeEventListener('ipms:start-product-tour', handleStartTour);
  }, [propRole]);

  const closeTour = useCallback(() => {
    try {
      const storageKey = `ipms_product_tour_seen_${activeRole}_v2`;
      localStorage.setItem(storageKey, 'true');
    } catch {
      // Ignore
    }
    setIsActive(false);
  }, [activeRole]);

  // When step changes, scroll target element into view smoothly once
  useEffect(() => {
    if (!isActive) return;
    const step = steps[currentStepIndex];
    if (!step) return;

    const selectors = step.selector.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        break;
      }
    }
  }, [isActive, currentStepIndex, steps]);

  // Calculate target position and popover layout dynamically
  const updateTargetPosition = useCallback(() => {
    if (!isActive) return;

    const step = steps[currentStepIndex];
    if (!step) return;

    let targetEl: Element | null = null;
    const selectors = step.selector.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        targetEl = el;
        break;
      }
    }

    const popoverWidth = 330;
    const popoverHeight = 160;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (!targetEl) {
      setTargetRect(null);
      // Cleanly center the popover on screen when no element is present, without an arrow
      const top = Math.max(16, (viewportHeight - popoverHeight) / 2);
      const left = Math.max(16, (viewportWidth - popoverWidth) / 2);
      setPopoverPos({ top, left, arrowPlacement: 'none', arrowOffset: 0 });
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    setTargetRect(rect);

    // Compute popover position relative to target
    const padding = 14;
    let top = rect.bottom + padding;
    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    let arrowPlacement: 'top' | 'bottom' | 'left' | 'right' = 'top';

    const preferred = step.placement ?? 'bottom';

    if (preferred === 'right') {
      if (rect.right + popoverWidth + padding < viewportWidth) {
        top = rect.top + rect.height / 2 - popoverHeight / 2;
        left = rect.right + padding;
        arrowPlacement = 'left';
      } else {
        top = rect.bottom + padding;
        left = rect.left + rect.width / 2 - popoverWidth / 2;
        arrowPlacement = 'top';
      }
    } else if (preferred === 'left') {
      if (rect.left - popoverWidth - padding > 0) {
        top = rect.top + rect.height / 2 - popoverHeight / 2;
        left = rect.left - popoverWidth - padding;
        arrowPlacement = 'right';
      } else {
        top = rect.bottom + padding;
        left = rect.left + rect.width / 2 - popoverWidth / 2;
        arrowPlacement = 'top';
      }
    } else if (preferred === 'top') {
      if (rect.top - popoverHeight - padding > 10) {
        top = rect.top - popoverHeight - padding;
        arrowPlacement = 'bottom';
      } else {
        top = rect.bottom + padding;
        arrowPlacement = 'top';
      }
    } else {
      // Preferred 'bottom'
      if (top + popoverHeight > viewportHeight - 10) {
        if (rect.top - popoverHeight - padding > 10) {
          top = rect.top - popoverHeight - padding;
          arrowPlacement = 'bottom';
        }
      }
    }

    // Viewport edge clamping
    left = Math.max(16, Math.min(viewportWidth - popoverWidth - 16, left));
    top = Math.max(16, Math.min(viewportHeight - popoverHeight - 16, top));

    // Dynamic caret arrow position pointing accurately at target's center
    let arrowOffset = 32;
    if (arrowPlacement === 'top' || arrowPlacement === 'bottom') {
      const targetCenterX = rect.left + rect.width / 2;
      arrowOffset = Math.max(22, Math.min(popoverWidth - 22, targetCenterX - left));
    } else {
      const targetCenterY = rect.top + rect.height / 2;
      arrowOffset = Math.max(20, Math.min(popoverHeight - 20, targetCenterY - top));
    }

    setPopoverPos({ top, left, arrowPlacement, arrowOffset });
  }, [isActive, currentStepIndex, steps]);

  // Keep target position in sync on resize and scroll at 60fps
  useEffect(() => {
    if (!isActive) return;

    updateTargetPosition();

    let rafId: number | null = null;
    const handleScrollOrResize = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        updateTargetPosition();
      });
    };

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isActive, updateTargetPosition]);

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeTour();
      } else if (e.key === 'ArrowRight') {
        if (currentStepIndex < steps.length - 1) {
          setCurrentStepIndex((prev) => prev + 1);
        } else {
          closeTour();
        }
      } else if (e.key === 'ArrowLeft') {
        if (currentStepIndex > 0) {
          setCurrentStepIndex((prev) => prev - 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, currentStepIndex, steps.length, closeTour]);

  if (!mounted || !isActive) return null;

  const currentStep = steps[currentStepIndex] ?? steps[0]!;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === steps.length - 1;

  // Mask calculations (spotlight cutout)
  const spotlightPad = 6;
  const spotX = targetRect ? Math.max(0, targetRect.left - spotlightPad) : 0;
  const spotY = targetRect ? Math.max(0, targetRect.top - spotlightPad) : 0;
  const spotW = targetRect ? targetRect.width + spotlightPad * 2 : 0;
  const spotH = targetRect ? targetRect.height + spotlightPad * 2 : 0;

  const overlayContent = (
    <aside className="product-tour-overlay" aria-label="Guided Tour" role="dialog" aria-modal="true">
      {/* SVG Spotlight Cutout Backdrop */}
      <svg className="product-tour-svg-backdrop" width="100%" height="100%">
        <defs>
          <mask id="tour-spotlight-mask">
            {/* White covers entire screen */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {/* Black cutout reveals target element ONLY when target exists */}
            {targetRect && (
              <rect
                className="tour-mask-cutout"
                x={spotX}
                y={spotY}
                width={spotW}
                height={spotH}
                rx="12"
                ry="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        {/* Shaded backdrop masked with transparent cutout */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.70)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>

      {/* Animated Pulsing Spotlight Ring around Target Element */}
      {targetRect && (
        <div
          className="tour-spotlight-halo"
          style={{
            top: `${spotY}px`,
            left: `${spotX}px`,
            width: `${spotW}px`,
            height: `${spotH}px`,
          }}
          aria-hidden="true"
        />
      )}

      {/* Floating Contextual Tooltip Popover (Matches Guided Tour Reference) */}
      <div
        ref={popoverRef}
        className={`tour-popover-card arrow-${popoverPos.arrowPlacement}`}
        style={
          {
            top: `${popoverPos.top}px`,
            left: `${popoverPos.left}px`,
            '--arrow-offset': `${popoverPos.arrowOffset}px`,
          } as React.CSSProperties
        }
      >
        <header className="tour-popover-header">
          <h3 className="tour-popover-title">{currentStep.title}</h3>
          <button
            type="button"
            className="tour-close-btn"
            onClick={closeTour}
            aria-label="Close tour"
            title="Close (Esc)"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <p className="tour-popover-content">{currentStep.content}</p>

        <footer className="tour-popover-footer">
          <button
            type="button"
            className="tour-secondary-btn"
            onClick={isFirst ? closeTour : () => setCurrentStepIndex((prev) => prev - 1)}
          >
            {isFirst ? 'End Tour' : 'Previous'}
          </button>

          <span className="tour-step-counter">
            {currentStepIndex + 1}/{steps.length}
          </span>

          <button
            type="button"
            className="tour-primary-btn"
            onClick={() => {
              if (isLast) {
                closeTour();
              } else {
                setCurrentStepIndex((prev) => prev + 1);
              }
            }}
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </footer>
      </div>
    </aside>
  );

  return createPortal(overlayContent, document.body);
}
