'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface TourStep {
  id: string;
  selector: string;
  title: string;
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  badge: string;
}

const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'sidebar-nav',
    selector: '.sidebar nav, nav[aria-label="Primary navigation"], .sidebar-nav',
    title: 'Workspace Navigation',
    badge: 'Step 1 of 5 • Navigation',
    content: 'Switch seamlessly between Projects, Cell Sites, Quality Checklists, and Finance workflows across Nepal.',
    placement: 'right',
  },
  {
    id: 'top-search',
    selector: '.top-search, input[type="search"]',
    title: 'Instant Global Search',
    badge: 'Step 2 of 5 • Fast Lookup',
    content: 'Quickly find cell towers by site code (e.g. KTM-T01), work order references, or regional rollout initiatives.',
    placement: 'bottom',
  },
  {
    id: 'notifications',
    selector: '.notif-bell-btn, .notif-wrapper',
    title: 'Real-Time Notification Feed',
    badge: 'Step 3 of 5 • Live Alerts',
    content: 'Get alerted the moment a field work order is submitted, approved by QC, or returned for inspection rework.',
    placement: 'bottom',
  },
  {
    id: 'profile',
    selector: '.sidebar-user, .sidebar-user-link',
    title: 'Identity & Permissions',
    badge: 'Step 4 of 5 • Account',
    content: 'Check your active role permissions (Super Admin, QC, Engineer), access settings, or update security credentials.',
    placement: 'right',
  },
  {
    id: 'main-content',
    selector: '.ov-kpis, .metrics, .ov-head, .welcome',
    title: 'Operational KPI Dashboard',
    badge: 'Step 5 of 5 • Operations',
    content: 'Track active cell site projects, completed work orders, QC approval rates, and items awaiting review at a glance.',
    placement: 'bottom',
  },
];

const TOUR_STORAGE_KEY = 'ipms_product_tour_seen_v1';

export function ProductTour() {
  const [mounted, setMounted] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
    arrowPlacement: 'top' | 'bottom' | 'left' | 'right';
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

  // Auto-start tour ONCE on initial visit / login
  useEffect(() => {
    if (!mounted) return;
    try {
      const hasSeen = localStorage.getItem(TOUR_STORAGE_KEY);
      if (!hasSeen) {
        const timer = setTimeout(() => {
          setIsActive(true);
        }, 500);
        return () => clearTimeout(timer);
      }
    } catch {
      // Ignore localStorage access issues
    }
  }, [mounted]);

  // Listen to manual restart events if triggered by user
  useEffect(() => {
    const handleStartTour = () => {
      setCurrentStepIndex(0);
      setIsActive(true);
    };
    window.addEventListener('ipms:start-product-tour', handleStartTour);
    return () => window.removeEventListener('ipms:start-product-tour', handleStartTour);
  }, []);

  const closeTour = useCallback(() => {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    } catch {
      // Ignore
    }
    setIsActive(false);
  }, []);

  // When step changes, scroll target element into view smoothly once
  useEffect(() => {
    if (!isActive) return;
    const step = TOUR_STEPS[currentStepIndex];
    if (!step) return;

    const selectors = step.selector.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        break;
      }
    }
  }, [isActive, currentStepIndex]);

  // Calculate target position and popover layout dynamically
  const updateTargetPosition = useCallback(() => {
    if (!isActive) return;

    const step = TOUR_STEPS[currentStepIndex];
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

    if (!targetEl) {
      setTargetRect(null);
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    setTargetRect(rect);

    // Compute popover position
    const padding = 14;
    const popoverWidth = 350;
    const popoverHeight = 180;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

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
        // Fallback to bottom if no space on right
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
  }, [isActive, currentStepIndex]);

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
        if (currentStepIndex < TOUR_STEPS.length - 1) {
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
  }, [isActive, currentStepIndex, closeTour]);

  if (!mounted || !isActive) return null;

  const currentStep = TOUR_STEPS[currentStepIndex] ?? TOUR_STEPS[0]!;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === TOUR_STEPS.length - 1;

  // Mask calculations
  const spotlightPad = 6;
  const spotX = targetRect ? Math.max(0, targetRect.left - spotlightPad) : window.innerWidth / 2 - 100;
  const spotY = targetRect ? Math.max(0, targetRect.top - spotlightPad) : window.innerHeight / 2 - 50;
  const spotW = targetRect ? targetRect.width + spotlightPad * 2 : 200;
  const spotH = targetRect ? targetRect.height + spotlightPad * 2 : 100;

  const overlayContent = (
    <aside className="product-tour-overlay" aria-label="Interactive Product Tour" role="dialog" aria-modal="true">
      {/* SVG Spotlight Cutout Backdrop */}
      <svg className="product-tour-svg-backdrop" width="100%" height="100%">
        <defs>
          <mask id="tour-spotlight-mask">
            {/* White covers entire screen */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {/* Black cutout reveals target element underneath */}
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
          </mask>
        </defs>
        {/* Shaded backdrop masked with transparent cutout */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.72)"
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

      {/* Floating Contextual Tooltip Popover */}
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
          <div className="tour-badge-row">
            <span className="tour-step-badge">{currentStep.badge}</span>
            <div className="tour-dots-indicator" aria-hidden="true">
              {TOUR_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`tour-dot ${i === currentStepIndex ? 'active' : i < currentStepIndex ? 'passed' : ''}`}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            className="tour-close-btn"
            onClick={closeTour}
            aria-label="Skip Product Tour"
            title="Skip Tour (Esc)"
          >
            &times;
          </button>
        </header>

        <main className="tour-popover-body">
          <h3 className="tour-popover-title">{currentStep.title}</h3>
          <p className="tour-popover-content">{currentStep.content}</p>
        </main>

        <footer className="tour-popover-footer">
          <button
            type="button"
            className="tour-skip-btn"
            onClick={closeTour}
          >
            Skip Tour
          </button>

          <div className="tour-btn-group">
            {!isFirst && (
              <button
                type="button"
                className="tour-prev-btn"
                onClick={() => setCurrentStepIndex((prev) => prev - 1)}
              >
                Back
              </button>
            )}

            <button
              type="button"
              className="tour-next-btn"
              onClick={() => {
                if (isLast) {
                  closeTour();
                } else {
                  setCurrentStepIndex((prev) => prev + 1);
                }
              }}
            >
              {isLast ? 'Finish' : 'Next'}
              <span aria-hidden="true">&rsaquo;</span>
            </button>
          </div>
        </footer>
      </div>
    </aside>
  );

  return createPortal(overlayContent, document.body);
}
