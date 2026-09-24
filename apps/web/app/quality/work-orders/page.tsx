import { redirect } from 'next/navigation';
import { listProjects } from '../../lib/project-api';
import { Sidebar, StatePage, TopActions } from '../../shell';

/**
 * Work orders belong to a project, so the workspace entry is a choice of
 * project. With exactly one visible project there is nothing to choose.
 */
export default async function WorkOrderProjectsPage() {
  const projects = await listProjects();
  if (projects.state === 'unauthenticated') {
    return <StatePage title="Sign in to see work orders"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (projects.state !== 'ready') {
    return <StatePage title="Work orders are not available"><p>{projects.message}</p></StatePage>;
  }
  const live = projects.data.filter((project) => project.status !== 'CANCELLED');
  if (live.length === 1) redirect(`/projects/${live[0]!.id}/work-orders`);

  return (
    <main className="app-shell">
      <Sidebar active="work-orders" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><span>Quality &amp; EHS</span><b>/</b><strong>Work orders</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar"><div><p className="eyebrow">QUALITY &amp; EHS</p><h1>Work orders</h1><p className="subtle">Choose a project to see and assign its work orders.</p></div></div>
          <section className="panel">
            {live.length === 0
              ? <div className="empty-list"><strong>No projects to show</strong><p>Work orders are raised within a project.</p></div>
              : <table className="data-table">
                  <thead><tr><th>Project</th><th>Code</th><th>Status</th><th>Sites</th><th>Tasks</th><th></th></tr></thead>
                  <tbody>
                    {live.map((project) => (
                      <tr key={project.id}>
                        <td><a href={`/projects/${project.id}/work-orders`}><strong>{project.name}</strong></a></td>
                        <td><code>{project.code}</code></td>
                        <td><span className="badge slate">{project.status}</span></td>
                        <td>{project._count.sites}</td>
                        <td>{project._count.tasks}</td>
                        <td className="row-actions"><a className="ghost-button" href={`/projects/${project.id}/work-orders`}>Open work orders</a></td>
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
