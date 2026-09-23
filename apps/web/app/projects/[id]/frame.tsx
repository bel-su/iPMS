import type { ApiResult } from '../../lib/api-client';
import type { ProjectDetail } from '../../lib/project-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { PROJECT_TABS, type ProjectTab } from './paths';

/** The answer for a project that could not be loaded, or null when it was. */
export function projectProblem(project: ApiResult<ProjectDetail>): React.ReactNode | null {
  if (project.state === 'unauthenticated') {
    return <StatePage title="Sign in to see this project"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (project.state !== 'ready') {
    return <StatePage title="Cannot show this project"><p>{project.message}</p><p className="subtle"><a href="/projects">Back to projects</a></p></StatePage>;
  }
  return null;
}

/**
 * The chrome every project page shares. `tabs` is omitted for the field view,
 * which is a single list of the engineer's own work and has nowhere to go.
 */
export function ProjectFrame({ project, active, tabs = true, actions, children }: {
  project: ProjectDetail;
  active: ProjectTab;
  tabs?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const current = PROJECT_TABS.find(({ tab }) => tab === active);
  return (
    <main className="app-shell">
      <Sidebar active="projects" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs">
            <a href="/projects">Projects</a><b>/</b>
            {active === 'overview'
              ? <strong>{project.code}</strong>
              : <><a href={`/projects/${project.id}`}>{project.code}</a><b>/</b><strong>{current?.label}</strong></>}
          </div>
          <TopActions>{actions}</TopActions>
        </header>

        <div className="dashboard">
          <section className="welcome">
            <div>
              <p className="eyebrow">{project.status}</p>
              <h1>{project.name}</h1>
              <p className="subtle">{project.clientName ?? 'No client'}{project.phase ? ` · ${project.phase}` : ''}</p>
            </div>
          </section>

          {tabs
            ? <nav className="tab-row" aria-label="Project sections">
                {PROJECT_TABS.map(({ tab, label, path }) => (
                  <a key={tab} href={`/projects/${project.id}${path}`} aria-current={tab === active ? 'page' : undefined}>{label}</a>
                ))}
              </nav>
            : null}

          {children}
        </div>
      </section>
    </main>
  );
}
