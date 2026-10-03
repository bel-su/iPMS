import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listProjects } from '../lib/project-api';
import { Sidebar, StatePage, TopActions } from '../shell';

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim() ?? '';
  const [projects, user] = await Promise.all([listProjects(), getCurrentUser()]);

  if (projects.state === 'unauthenticated') {
    return <StatePage title="Sign in to see your projects"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (projects.state === 'forbidden') {
    return <StatePage title="Your account cannot view projects"><p>{projects.message}</p><p className="subtle">Ask an administrator for a role that grants <code>project.view</code>.</p></StatePage>;
  }
  if (projects.state === 'unavailable') {
    return <StatePage title="Project API is not available"><p>{projects.message}</p>{projects.correlationId ? <p className="subtle">Correlation ID: <code>{projects.correlationId}</code></p> : null}</StatePage>;
  }

  // For clarity only — the gateway is what enforces this.
  const needle = q.toLowerCase();
  const shown = needle
    ? projects.data.filter((project) => [project.code, project.name, project.clientName ?? ''].some((field) => field.toLowerCase().includes(needle)))
    : projects.data;
  const mayCreate = user.state === 'ready' && hasPermission(user.data, 'project.create');

  return (
    <main className="app-shell">
      <Sidebar active="projects" />
      <section className="content">
        <header className="topbar"><div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Projects</strong></div><TopActions /></header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">ALL PROJECTS</p><h1>Projects</h1></div>
            {mayCreate ? <a className="primary-button" href="/projects/new">New project</a> : null}
          </div>
          <section className="panel">
            {shown.length === 0
              ? q
                ? <div className="empty-list"><strong>No projects match “{q}”</strong><p><a href="/projects">Show all projects</a></p></div>
                : <div className="empty-list"><strong>No projects yet</strong><p>Create one to get started.</p></div>
              : <table className="data-table">
                  <thead><tr><th>Code</th><th>Name</th><th>Client</th><th>Status</th><th>Sites</th><th>Tasks</th><th></th></tr></thead>
                  <tbody>
                    {shown.map((project) => (
                      <tr key={project.id}>
                        <td><code>{project.code}</code></td>
                        <td><a href={`/projects/${project.id}`}>{project.name}</a></td>
                        <td>{project.clientName ?? '—'}</td>
                        <td><span className="badge green">{project.status}</span></td>
                        <td>{project._count.sites}</td>
                        <td>{project._count.tasks}</td>
                        <td className="row-actions"><a className="ghost-button" href={`/projects/${project.id}`}>Open</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>}
          </section>
        </div>
      </section>
    </main>
  );
}
