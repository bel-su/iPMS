import { getCurrentUser, mayReadDocs } from '../lib/iam-api';
import { Sidebar, StatePage, TopActions } from '../shell';

/**
 * The staff user manual. Sample content for now — enough to show the shape of
 * the guide; the real text replaces the entries in CHAPTERS.
 *
 * Unlike the hidden nav item, this check is the boundary: the manual is
 * rendered here, on the server, so a viewer without a manager role never
 * receives it.
 */

interface Chapter { id: string; title: string; summary: string; steps: string[]; tip?: string }

const CHAPTERS: readonly Chapter[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'Signing in and finding your way around.',
    steps: [
      'Sign in with your email address and the temporary password your manager gave you.',
      'You will be asked to choose a new password on first sign-in.',
      'Use the left sidebar to move between Overview, Projects, Quality & EHS and Users. You only see the areas your role allows.',
      'Open the account menu (your initials, top right) to see your profile, change your password or sign out.',
    ],
    tip: 'Forgot your password? Ask a manager to reset it from the Users page.',
  },
  {
    id: 'projects',
    title: 'Projects and sites',
    summary: 'Setting up a project and the sites that belong to it.',
    steps: [
      'Open Projects and choose New project. Give it a code, a name and a phase.',
      'Inside the project, add sites one by one or import them from the Excel template.',
      'Set the project status to ACTIVE once its sites are in place — only active projects appear on the Overview.',
    ],
  },
  {
    id: 'work-orders',
    title: 'Work orders',
    summary: 'Assigning checklists to sites and following them to approval.',
    steps: [
      'Go to Quality & EHS → Work orders and choose Assign a checklist.',
      'Pick the checklist, the sites and the engineer, then set a due date.',
      'Engineers complete the checklist on the mobile app and submit it for review.',
      'Reviewers approve the submission, or reject it with a note so it goes back for rework.',
    ],
    tip: 'Work orders are named by site ID, so search by the site ID to find one quickly.',
  },
  {
    id: 'checklists',
    title: 'Checklist library',
    summary: 'Building the checklists engineers fill in.',
    steps: [
      'Open Quality & EHS → Checklist library and create a template, or import one from Excel.',
      'Group items into sections and mark which ones need a photo.',
      'Enable the template when it is ready — only enabled templates can be assigned.',
    ],
  },
  {
    id: 'users',
    title: 'Users and roles',
    summary: 'Adding staff and deciding what they can do.',
    steps: [
      'Open Users and choose New user.',
      'Give the user a role: Field Engineer, QC Manager, Project Manager or Viewer.',
      'Grant access to the projects or sites they work on.',
      'Deactivate a user when they leave — their history is kept.',
    ],
    tip: 'Project managers can add Field Engineers and QC Managers; only an administrator can add another manager.',
  },
];

export default async function DocsPage() {
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to read the documentation"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (viewer.state !== 'ready' || !mayReadDocs(viewer.data)) {
    return (
      <StatePage title="The documentation is for managers">
        <p>Your account cannot open the user manual.</p>
        <p className="subtle">Ask a manager or an administrator if you need a copy of a guide.</p>
        <a className="ghost-button" href="/">Back to the workspace</a>
      </StatePage>
    );
  }

  return (
    <main className="app-shell">
      <Sidebar active="docs" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Documentation</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">DOCUMENTATION</p><h1>User manual</h1>
              <p className="subtle">How staff use iPMS. Visible to managers and administrators only.</p>
            </div>
            <span className="badge">Sample</span>
          </div>
          <div className="manual">
            <nav className="panel manual-toc" aria-label="Manual contents">
              <p className="eyebrow">CONTENTS</p>
              <ol>{CHAPTERS.map((c) => <li key={c.id}><a href={`#${c.id}`}>{c.title}</a></li>)}</ol>
            </nav>
            <div className="manual-body">
              {CHAPTERS.map((c, i) => (
                <section className="panel manual-chapter" id={c.id} key={c.id}>
                  <p className="eyebrow">CHAPTER {i + 1}</p>
                  <h2>{c.title}</h2>
                  <p className="subtle">{c.summary}</p>
                  <ol className="manual-steps">{c.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  {c.tip ? <p className="manual-tip"><strong>Tip</strong> {c.tip}</p> : null}
                </section>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
