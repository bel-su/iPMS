import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { getProject } from '../../../lib/project-api';
import { ArchiveForm, DeleteProjectForm, EditProjectForm } from '../../forms';
import { Sidebar, StatePage, TopActions } from '../../../shell';

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, user] = await Promise.all([getProject(id), getCurrentUser()]);

  if (project.state === 'unauthenticated') {
    return <StatePage title="Sign in to edit this project"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (project.state !== 'ready') {
    return <StatePage title="Cannot edit this project"><p>{project.message}</p><p className="subtle"><a href="/projects">Back to projects</a></p></StatePage>;
  }

  // For clarity only — the gateway and the service guards are what enforce this.
  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  const data = project.data;

  return (
    <main className="app-shell">
      <Sidebar active="projects" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/projects">Projects</a><b>/</b><a href={`/projects/${data.id}`}>{data.code}</a><b>/</b><strong>Edit</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header"><div><h2>Project details</h2><p>The code cannot be changed.</p></div></div>
            <EditProjectForm project={data} />
          </section>

          {may('project.archive')
            ? <section className="panel">
                <div className="panel-header"><div><h2>Archive</h2><p>Sets the status to CANCELLED. Nothing is destroyed, and it can be set back.</p></div></div>
                <ArchiveForm projectId={data.id} />
              </section>
            : null}

          {may('project.delete')
            ? <section className="panel confirm-card">
                <h2>Delete permanently</h2>
                <p className="form-note">
                  This destroys the project and its sites, task types and milestones. It is refused while
                  any task remains — delete those first, or archive instead.
                </p>
                <DeleteProjectForm projectId={data.id} code={data.code} />
              </section>
            : null}
        </div>
      </section>
    </main>
  );
}
