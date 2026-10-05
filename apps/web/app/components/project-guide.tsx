'use client';

import React, { useState, useEffect, useCallback } from 'react';

export type RoleFilter = 'all' | 'manager' | 'qc' | 'engineer';
export type GuideTab = 'workflow' | 'components';

interface WorkflowStep {
  id: string;
  stepNumber: number;
  title: string;
  category: string;
  role: 'Project Manager' | 'QC Manager' | 'Field Engineer' | 'All Roles';
  summary: string;
  whatItDoes: string[];
  howToUse: string[];
  proTip: string;
  actionUrl?: string;
  actionLabel?: string;
  badge: string;
}

interface ComponentInfo {
  id: string;
  name: string;
  route: string;
  category: string;
  summary: string;
  description: string;
  keyFeatures: string[];
  primaryUser: string;
  actionUrl: string;
}

const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  {
    id: 'projects',
    stepNumber: 1,
    title: 'Project & Portfolio Setup',
    category: 'Planning & Governance',
    role: 'Project Manager',
    badge: 'Step 1 • Planning',
    summary: 'Initialize nationwide or regional rollout projects, allocate phases, and establish governance.',
    whatItDoes: [
      'Creates a dedicated project workspace for tracking rollouts (e.g. 5G Expansion, Microwave Upgrade).',
      'Defines project codes, timelines, budgets, and operational phases.',
      'Acts as the top-level container that groups hundreds of physical cell sites.',
    ],
    howToUse: [
      'Navigate to "Projects" from the left navigation bar.',
      'Click "New Project" and provide a distinct Project Code (e.g. PRJ-KTM-5G) and Title.',
      'Define target phases and mark the project status as ACTIVE once ready.',
      'Only active projects appear in the executive Overview dashboard.',
    ],
    proTip: 'Use structured project codes that include region and technology for fast searching in global search.',
    actionUrl: '/projects',
    actionLabel: 'Open Projects Directory',
  },
  {
    id: 'sites',
    stepNumber: 2,
    title: 'Site Registration & GPS Geofences',
    category: 'Site Engineering',
    role: 'Project Manager',
    badge: 'Step 2 • Sites',
    summary: 'Register cell tower sites with exact GPS coordinates (latitude, longitude) and geofence radii.',
    whatItDoes: [
      'Maintains the master directory of physical telecom infrastructure (Rooftop, Greenfield, Guyed Towers).',
      'Defines GPS geofence boundaries (e.g. 100m radius) required to validate field engineer presence.',
      'Supports single-site creation or high-speed bulk import using standardized Excel spreadsheets.',
    ],
    howToUse: [
      'Open your target project from the Projects list.',
      'Navigate to the "Sites" tab and choose "Add Site" (or "Import from Excel" for bulk uploads).',
      'Enter the telecom Site Code (e.g. KTM-T01), physical address, latitude, and longitude.',
      'Set the geofence radius (default: 100 meters) to enforce geo-verification during mobile inspection.',
    ],
    proTip: 'Always verify site coordinates on the built-in map to ensure the geofence circle accurately encompasses the tower base.',
    actionUrl: '/projects',
    actionLabel: 'Explore Sites & Map',
  },
  {
    id: 'checklists',
    stepNumber: 3,
    title: 'Quality Checklist Library',
    category: 'Quality Assurance',
    role: 'QC Manager',
    badge: 'Step 3 • Standards',
    summary: 'Design standardized inspection templates with mandatory watermarked photo evidence rules.',
    whatItDoes: [
      'Houses reusable, auditable quality checklists for Civil Works, Tower Erection, RF, and Power Systems.',
      'Groups inspection items into structured sections with pass/fail criteria.',
      'Enforces mandatory photo evidence for critical checkpoints to prevent fraudulent sign-offs.',
    ],
    howToUse: [
      'Go to "Quality & EHS" → "Checklist Library" in the sidebar.',
      'Click "New Template" or choose "Import Template" to upload an Excel checklist.',
      'Add sections (e.g., "Foundation & Concrete", "Earthing & Lightning Arrestor").',
      'For items requiring visual proof, toggle "Photo Required".',
      'Publish the template version to make it available for field work orders.',
    ],
    proTip: 'Keep checklist items specific and actionable so field engineers can complete them quickly without ambiguity.',
    actionUrl: '/quality/templates',
    actionLabel: 'Open Checklist Library',
  },
  {
    id: 'work-orders',
    stepNumber: 4,
    title: 'Work Order Dispatching',
    category: 'Field Operations',
    role: 'Project Manager',
    badge: 'Step 4 • Dispatch',
    summary: 'Assign inspection work orders to Field Engineers with site locks, priorities, and deadlines.',
    whatItDoes: [
      'Connects a specific site and checklist template to an assigned Field Engineer.',
      'Tracks lifecycle states: ALL → ONGOING → REVIEWING → REWORK → COMPLETED.',
      'Pushes real-time notifications to the assigned engineer\'s mobile app.',
    ],
    howToUse: [
      'Navigate to "Quality & EHS" → "Work Orders" and click "Assign a Checklist".',
      'Select the target Site and the published Checklist Template.',
      'Assign the designated Field Engineer and select priority (URGENT, HIGH, MEDIUM).',
      'Set an expected due date and submit the work order.',
    ],
    proTip: 'Monitor the "Reviewing" counter badge in the left sidebar—it shows the live queue of orders waiting for review.',
    actionUrl: '/quality/work-orders',
    actionLabel: 'View Work Orders Queue',
  },
  {
    id: 'mobile-app',
    stepNumber: 5,
    title: 'Mobile App Field Execution',
    category: 'On-Site Inspection',
    role: 'Field Engineer',
    badge: 'Step 5 • Mobile Field',
    summary: 'Engineers on-site verify GPS within the geofence and snap continuous watermarked photo evidence.',
    whatItDoes: [
      'Runs on field engineers\' Android or iOS smartphones with pure client-side watermarking.',
      'Validates physical presence against site coordinates before unlocking inspection evidence.',
      'Continuous multi-photo camera stamps date, time, site code, GPS, and engineer ID directly onto images.',
    ],
    howToUse: [
      'Open the iPMS mobile app and log in with your field credentials or biometric scan.',
      'Select the assigned task from the landing screen ("Your Tasks").',
      'Arrive on-site: The app verifies GPS coordinates within the green geofence circle.',
      'Capture evidence: Use the continuous multi-photo camera to take photos without leaving camera mode.',
      'Submit checklist for review: Work order transitions from "Ongoing" to "Reviewing".',
    ],
    proTip: 'Photos taken within the mobile app are watermarked directly in memory, ensuring tamper-proof compliance for telecom audits.',
    actionUrl: '/quality/work-orders',
    actionLabel: 'Inspect Active Orders',
  },
  {
    id: 'qc-review',
    stepNumber: 6,
    title: 'QC Review Console & Sign-Off',
    category: 'Quality Assurance',
    role: 'QC Manager',
    badge: 'Step 6 • Review Desk',
    summary: 'Examine submitted photo evidence, inspect watermarks & geofence flags, and approve or request rework.',
    whatItDoes: [
      'Dedicated split-screen console for reviewing submitted work orders.',
      'Inspects full-resolution photos, watermarks, timestamps, and GPS geofence compliance flags.',
      'Supports item-by-item sign-off or detailed rework requests with feedback notes.',
    ],
    howToUse: [
      'Open "Quality & EHS" → "Work Orders" and click on any order in "Reviewing" status.',
      'Inspect each checklist item and click attached photo evidence to view full size.',
      'Verify that the stamped watermark coordinates match the site location.',
      'Click "Approve" for passing items, or "Request Rework" with notes for non-compliant work.',
      'When all items pass, click "Complete & Close" to finalize site milestone sign-off.',
    ],
    proTip: 'Rework requests notify the field engineer immediately, reopening only the rejected items for re-capture.',
    actionUrl: '/quality/work-orders',
    actionLabel: 'Open Review Queue',
  },
  {
    id: 'audit-log',
    stepNumber: 7,
    title: 'Audit Trail & Compliance Records',
    category: 'Governance & Audit',
    role: 'All Roles',
    badge: 'Step 7 • Audit Ready',
    summary: 'Immutable chronological ledger of all submissions, approvals, reworks, and role changes.',
    whatItDoes: [
      'Maintains a permanent, tamper-evident record of all system and field activities.',
      'Tracks who approved each site, exact photo hashes, and timestamped rework iterations.',
      'Enables rapid generation of regulatory compliance certificates for telecom operators.',
    ],
    howToUse: [
      'Select "Audit log" from the Records section in the sidebar (or via Overview).',
      'Filter events by User, Action Type (Created, Approved, Rejected), or Date Range.',
      'Export or review evidence records during operator acceptance audits.',
    ],
    proTip: 'Audit records are append-only and cannot be altered, providing 100% legal and regulatory defensibility.',
    actionUrl: '/#audit-log',
    actionLabel: 'View Audit Log',
  },
];

const COMPONENTS_CATALOG: readonly ComponentInfo[] = [
  {
    id: 'comp-overview',
    name: 'Executive Overview',
    route: '/',
    category: 'Dashboard & Metrics',
    summary: 'Real-time high-level visibility across all active projects, rollouts, and field bottlenecks.',
    description: 'The executive landing page customized by role. Displays real-time KPIs, active project completion ring, critical attention items, and regional site progress bars.',
    keyFeatures: [
      'Role-tailored home views (Manager, QC Lead, Engineer, Admin)',
      'Real-time milestone completion ring',
      'Immediate attention panel for blocked or overdue sites',
      'Regional completion tracker (Central, Western, Eastern regions)',
    ],
    primaryUser: 'All Roles',
    actionUrl: '/',
  },
  {
    id: 'comp-projects',
    name: 'Projects & Sites Directory',
    route: '/projects',
    category: 'Portfolio Management',
    summary: 'Hierarchical structure linking nationwide projects to individual cell tower sites and geofences.',
    description: 'Manages telecom rollout programs, associated site directories, GPS coordinates, geofence radius settings, and site status.',
    keyFeatures: [
      'Hierarchical project and site portfolio tree',
      'Site GPS coordinates and geofence radius management',
      'Bulk site Excel import with auto-validation',
      'Project phase and milestone allocation',
    ],
    primaryUser: 'Project Manager & Admin',
    actionUrl: '/projects',
  },
  {
    id: 'comp-work-orders',
    name: 'Work Orders Queue',
    route: '/quality/work-orders',
    category: 'Quality & EHS',
    summary: 'Central dispatch and tracking desk for site inspections and quality audits.',
    description: 'Live table and kanban view of inspection tasks categorized by state (All, Ongoing, Reviewing, Rework, Completed) with assignee filters.',
    keyFeatures: [
      'One-click work order assignment with site & checklist binding',
      'Real-time status indicators and due date warnings',
      'Instant search by site code, engineer name, or work order ID',
      'Direct link to QC review desk for pending submissions',
    ],
    primaryUser: 'Project Manager, QC Manager, Engineer',
    actionUrl: '/quality/work-orders',
  },
  {
    id: 'comp-checklists',
    name: 'Checklist Template Library',
    route: '/quality/templates',
    category: 'Quality Assurance',
    summary: 'Standardized digital QA templates for civil, tower, electrical, and RF telecom acceptance.',
    description: 'Central library to author, version, and manage digital quality inspection templates with section groupings and mandatory evidence rules.',
    keyFeatures: [
      'Multi-section item hierarchy with pass/fail toggles',
      'Mandatory photo evidence configuration per checkpoint',
      'Draft and published version control',
      'Bulk Excel template import and export',
    ],
    primaryUser: 'QC Manager & Admin',
    actionUrl: '/quality/templates',
  },
  {
    id: 'comp-users',
    name: 'User & Role Management (IAM)',
    route: '/users',
    category: 'Administration',
    summary: 'Role-based access control (RBAC), project permissions, and field staff credentials.',
    description: 'Admin surface for creating accounts, assigning roles (Field Engineer, QC Manager, Project Manager, Viewer), and configuring site access scopes.',
    keyFeatures: [
      'Granular permission assignment (view, edit, review, approve)',
      'Project-level access restrictions',
      'Password reset and account deactivation controls',
      'Audit tracking of credential changes',
    ],
    primaryUser: 'Administrator & Project Manager',
    actionUrl: '/users',
  },
  {
    id: 'comp-search',
    name: 'Global Unified Search',
    route: 'Top Navigation Bar',
    category: 'Productivity',
    summary: 'Cross-system fast search across project codes, site IDs, engineers, and work orders.',
    description: 'Integrated directly in the top header. Allows instant keyboard-driven search and navigation across all system entities.',
    keyFeatures: [
      'Search across Projects, Sites, Work Orders, and Users in one place',
      'Scoped search filters for fast lookup',
      'Direct jump to target entity detail pages',
    ],
    primaryUser: 'All Users',
    actionUrl: '/',
  },
  {
    id: 'comp-notifications',
    name: 'Live Notification Center',
    route: 'Top Navigation Bar',
    category: 'Real-time Alerts',
    summary: 'Instant notification stream for work order assignments, review approvals, and rework requests.',
    description: 'Flyout panel in the topbar alerting managers and engineers of status changes, handoffs, and pending decisions.',
    keyFeatures: [
      'Interactive bell icon with unread count badge',
      'One-click navigation to the referenced work order or site',
      'Dismiss and mark-all-read actions',
    ],
    primaryUser: 'All Users',
    actionUrl: '/',
  },
  {
    id: 'comp-mobile',
    name: 'iPMS Mobile Field App',
    route: 'Flutter iOS & Android',
    category: 'Mobile Field Client',
    summary: 'Companion mobile app for field engineers with geofenced check-in and canvas watermarking.',
    description: 'Native mobile client built for field conditions. Includes offline caching, GPS geofence presence lock, and continuous multi-photo camera with embedded watermarks.',
    keyFeatures: [
      'Biometric sign-in (Fingerprint / Face ID)',
      'Continuous multi-photo camera with 1-tap shutter',
      'Pure canvas in-memory watermarking (timestamp, GPS coordinates, site ID)',
      'Geofence verification preventing false off-site uploads',
    ],
    primaryUser: 'Field Engineers & QC Inspectors',
    actionUrl: '/quality/work-orders',
  },
];

export function ProjectGuideModal({
  isOpen,
  onClose,
  initialTab = 'workflow',
}: {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: GuideTab;
}) {
  const [activeTab, setActiveTab] = useState<GuideTab>(initialTab);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [searchFilter, setSearchFilter] = useState('');

  // Keyboard navigation: Escape to close, arrows for steps
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (activeTab === 'workflow') {
        if (e.key === 'ArrowRight') {
          setCurrentStepIndex((prev) => Math.min(WORKFLOW_STEPS.length - 1, prev + 1));
        } else if (e.key === 'ArrowLeft') {
          setCurrentStepIndex((prev) => Math.max(0, prev - 1));
        }
      }
    },
    [onClose, activeTab]
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const currentStep = WORKFLOW_STEPS[currentStepIndex] ?? WORKFLOW_STEPS[0];
  if (!currentStep) return null;

  // Filter steps by role
  const isStepVisibleForRole = (step: WorkflowStep) => {
    if (roleFilter === 'all') return true;
    if (roleFilter === 'manager') return step.role === 'Project Manager' || step.role === 'All Roles';
    if (roleFilter === 'qc') return step.role === 'QC Manager' || step.role === 'All Roles';
    if (roleFilter === 'engineer') return step.role === 'Field Engineer' || step.role === 'All Roles';
    return true;
  };

  // Filter components by search
  const filteredComponents = COMPONENTS_CATALOG.filter((comp) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      comp.name.toLowerCase().includes(q) ||
      comp.summary.toLowerCase().includes(q) ||
      comp.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="guide-modal-overlay" onClick={onClose} aria-modal="true" role="dialog">
      <div className="guide-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="guide-modal-header">
          <div className="guide-header-title-group">
            <div className="guide-icon-badge">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
              </svg>
            </div>
            <div>
              <div className="guide-eyebrow-row">
                <span className="guide-eyebrow">IPMS GUIDE</span>
                <span className="guide-version-tag">Walkthrough</span>
              </div>
              <h2 className="guide-title">Platform Guide &amp; Workflow</h2>
            </div>
          </div>

          <div className="guide-header-actions">
            {/* Tab Switcher */}
            <div className="guide-tabs-pill">
              <button
                type="button"
                className={`guide-tab-btn ${activeTab === 'workflow' ? 'active' : ''}`}
                onClick={() => setActiveTab('workflow')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                Step-by-Step Workflow
              </button>
              <button
                type="button"
                className={`guide-tab-btn ${activeTab === 'components' ? 'active' : ''}`}
                onClick={() => setActiveTab('components')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
                Component Explorer
              </button>
            </div>

            <button
              type="button"
              className="guide-close-btn"
              onClick={onClose}
              aria-label="Close Guide"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        {/* Tab 1: Step-by-Step Workflow */}
        {activeTab === 'workflow' && (
          <div className="guide-body-layout">
            {/* Stepper Toolbar */}
            <div className="guide-stepper-strip">
              <div className="guide-role-filter">
                <span className="guide-filter-label">Filter by Role:</span>
                <div className="guide-role-chips">
                  {(['all', 'manager', 'qc', 'engineer'] as RoleFilter[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`guide-chip ${roleFilter === r ? 'active' : ''}`}
                      onClick={() => setRoleFilter(r)}
                    >
                      {r === 'all' && 'All Roles'}
                      {r === 'manager' && 'Project Manager'}
                      {r === 'qc' && 'QC Manager'}
                      {r === 'engineer' && 'Field Engineer'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step Navigation Dots / Pills */}
              <div className="guide-steps-scroll">
                {WORKFLOW_STEPS.map((step, idx) => {
                  const isCurrent = idx === currentStepIndex;
                  const isPassed = idx < currentStepIndex;
                  const matchesRole = isStepVisibleForRole(step);

                  return (
                    <button
                      key={step.id}
                      type="button"
                      className={`guide-step-node ${isCurrent ? 'current' : ''} ${isPassed ? 'passed' : ''} ${!matchesRole ? 'dimmed' : ''}`}
                      onClick={() => setCurrentStepIndex(idx)}
                      title={`Step ${step.stepNumber}: ${step.title}`}
                    >
                      <span className="step-num">
                        {isPassed ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          step.stepNumber
                        )}
                      </span>
                      <span className="step-title-short">{step.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Main Step Detail Card */}
            <div className="guide-step-detail-card">
              <div className="guide-step-main-column">
                <div className="guide-step-header-meta">
                  <span className="guide-badge-pill">{currentStep.badge}</span>
                  <span className="guide-role-tag">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    Primary: {currentStep.role}
                  </span>
                  <span className="guide-category-tag">{currentStep.category}</span>
                </div>

                <h3 className="guide-step-title">{currentStep.title}</h3>
                <p className="guide-step-summary">{currentStep.summary}</p>

                {/* Section: What it does */}
                <div className="guide-section-block">
                  <h4 className="guide-section-heading">
                    <span className="icon-dot blue" /> What this component does
                  </h4>
                  <ul className="guide-bullet-list">
                    {currentStep.whatItDoes.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>

                {/* Section: How to use it */}
                <div className="guide-section-block">
                  <h4 className="guide-section-heading">
                    <span className="icon-dot green" /> How to use it step-by-step
                  </h4>
                  <ol className="guide-numbered-list">
                    {currentStep.howToUse.map((instruction, i) => (
                      <li key={i}>
                        <span className="num-circle">{i + 1}</span>
                        <span>{instruction}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {/* Sidebar Info Column */}
              <div className="guide-step-side-column">
                <div className="guide-pro-tip-box">
                  <div className="tip-header">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                    <strong>Field Pro-Tip</strong>
                  </div>
                  <p>{currentStep.proTip}</p>
                </div>

                {currentStep.actionUrl && (
                  <div className="guide-action-box">
                    <p className="action-hint">Try this component right now:</p>
                    <a
                      href={currentStep.actionUrl}
                      className="guide-direct-action-btn"
                      onClick={onClose}
                    >
                      <span>{currentStep.actionLabel ?? 'Open Component'}</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </a>
                  </div>
                )}

                <div className="guide-quick-facts">
                  <div className="fact-item">
                    <span className="fact-label">Lifecycle Stage</span>
                    <strong className="fact-value">{currentStep.stepNumber} of 7</strong>
                  </div>
                  <div className="fact-item">
                    <span className="fact-label">Audit Impact</span>
                    <strong className="fact-value text-green">High Compliance</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Stepper Footer Controls */}
            <footer className="guide-footer-controls">
              <button
                type="button"
                className="guide-nav-btn prev"
                disabled={currentStepIndex === 0}
                onClick={() => setCurrentStepIndex((prev) => Math.max(0, prev - 1))}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                Previous Step
              </button>

              <div className="guide-step-progress-indicator">
                <span>Step {currentStepIndex + 1} of {WORKFLOW_STEPS.length}</span>
                <div className="guide-progress-track">
                  <div
                    className="guide-progress-fill"
                    style={{ width: `${((currentStepIndex + 1) / WORKFLOW_STEPS.length) * 100}%` }}
                  />
                </div>
              </div>

              {currentStepIndex < WORKFLOW_STEPS.length - 1 ? (
                <button
                  type="button"
                  className="guide-nav-btn next"
                  onClick={() => setCurrentStepIndex((prev) => Math.min(WORKFLOW_STEPS.length - 1, prev + 1))}
                >
                  Next Step
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  className="guide-nav-btn finish"
                  onClick={onClose}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Ready to Start!
                </button>
              )}
            </footer>
          </div>
        )}

        {/* Tab 2: Components Explorer */}
        {activeTab === 'components' && (
          <div className="guide-components-layout">
            <div className="guide-components-filter-bar">
              <div className="guide-search-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Filter components (e.g. Work Orders, Checklists, Overview, Mobile)..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
                {searchFilter && (
                  <button type="button" onClick={() => setSearchFilter('')} aria-label="Clear filter">
                    &times;
                  </button>
                )}
              </div>
              <span className="guide-count-label">
                Showing {filteredComponents.length} of {COMPONENTS_CATALOG.length} platform components
              </span>
            </div>

            <div className="guide-components-grid">
              {filteredComponents.map((comp) => (
                <article key={comp.id} className="guide-component-card">
                  <div className="comp-card-top">
                    <div>
                      <span className="comp-category-tag">{comp.category}</span>
                      <h4 className="comp-card-name">{comp.name}</h4>
                    </div>
                    <span className="comp-route-pill">{comp.route}</span>
                  </div>

                  <p className="comp-card-summary">{comp.summary}</p>
                  <p className="comp-card-desc">{comp.description}</p>

                  <div className="comp-features-block">
                    <strong>Key Capabilities:</strong>
                    <ul>
                      {comp.keyFeatures.map((feat, i) => (
                        <li key={i}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="comp-card-footer">
                    <span className="comp-user-badge">User: {comp.primaryUser}</span>
                    {comp.actionUrl.startsWith('/') && (
                      <a
                        href={comp.actionUrl}
                        className="comp-link-btn"
                        onClick={onClose}
                      >
                        Open Section &rarr;
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const GUIDE_SEEN_STORAGE_KEY = 'ipms_project_guide_seen_v1';

/**
 * Headless Onboarding Guide:
 * Automatically opens ONCE on first login / installation, with NO
 * visible trigger button cluttering the headers.
 */
export function OnboardingGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const hasSeen = localStorage.getItem(GUIDE_SEEN_STORAGE_KEY);
      if (!hasSeen) {
        setOpen(true);
        localStorage.setItem(GUIDE_SEEN_STORAGE_KEY, 'true');
      }
    } catch {
      // In private browsing or environments where localStorage is blocked
    }
  }, []);

  const handleClose = () => {
    try {
      localStorage.setItem(GUIDE_SEEN_STORAGE_KEY, 'true');
    } catch {
      // Ignore
    }
    setOpen(false);
  };

  return <ProjectGuideModal isOpen={open} onClose={handleClose} />;
}

// Keep ProjectGuideTrigger as alias to avoid breaking imports in shell.tsx
export const ProjectGuideTrigger = OnboardingGuide;
