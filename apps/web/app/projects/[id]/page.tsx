import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { getProject, listTasks } from '../../lib/project-api';
import { deleteMilestoneAction, deleteSiteAction, deleteTaskAction, deleteTaskTypeAction } from '../actions';
import { CreateMilestoneForm, CreateSiteForm, CreateTaskForm, CreateTaskTypeForm, RowAction } from '../forms';
import { Sidebar, StatePage, TopActions } from '../../shell';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, tasks, user] = await Promise.all([getProject(id), listTasks(id), getCurrentUser()]);

  if (project.state === 'unauthenticated') {
    return <StatePage title="Sign in to see this project"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (project.state !== 'ready') {
    return <StatePage title="Cannot show this project"><p>{project.message}</p><p className="subtle"><a href="/projects">Back to projects</a></p></StatePage>;
  }

  // For clarity only — the gateway and the service guards are what enforce this.
  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  const data = project.data;
  const taskList = tasks.state === 'ready' ? tasks.data : [];

  return (
    <main className="app-shell">
      <Sidebar active="projects" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/projects">Projects</a><b>/</b><strong>{data.code}</strong></div>
          <TopActions>
            {may('project.update') ? <a className="ghost-button" href={`/projects/${data.id}/edit`}>Edit project</a> : null}
          </TopActions>
        </header>

        <div className="dashboard">
          <section className="welcome">
            <div>
              <p className="eyebrow">{data.status}</p>
              <h1>{data.name}</h1>
              <p className="subtle">{data.clientName ?? 'No client'}{data.phase ? ` · ${data.phase}` : ''}</p>
            </div>
          </section>

          <section className="panel" id="sites">
            <div className="panel-header"><div><h2>Sites</h2><p>{data.sites.length} in this project</p></div></div>
            {data.sites.length === 0
              ? <div className="empty-list"><strong>No sites yet</strong></div>
              : <table className="data-table">
                  <thead><tr><th>Code</th><th>Name</th><th>Region</th><th>City</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {data.sites.map((site) => (
                      <tr key={site.id}>
                        <td><code>{site.siteCode}</code></td>
                        <td>{site.name}</td>
                        <td>{site.region?.name ?? '—'}</td>
                        <td>{site.city ?? '—'}</td>
                        <td><span className="badge">{site.status}</span></td>
                        <td className="row-actions">
                          {may('site.delete')
                            ? <RowAction
                                action={deleteSiteAction}
                                hidden={{ projectId: data.id, siteId: site.id }}
                                label="Delete"
                                confirm={`Delete site ${site.siteCode}? This cannot be undone.`}
                              />
                            : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>}
            {may('site.create') ? <CreateSiteForm projectId={data.id} /> : null}
          </section>

          <section className="panel" id="task-types">
            <div className="panel-header"><div><h2>Task types</h2><p>{data.taskTypes.length} defined</p></div></div>
            {data.taskTypes.length === 0
              ? <div className="empty-list"><strong>No task types yet</strong><p>Tasks need one before they can be created.</p></div>
              : <table className="data-table">
                  <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Order</th><th>Active</th><th></th></tr></thead>
                  <tbody>
                    {data.taskTypes.map((taskType) => (
                      <tr key={taskType.id}>
                        <td><code>{taskType.code}</code></td>
                        <td>{taskType.name}</td>
                        <td>{taskType.category}</td>
                        <td>{taskType.order}</td>
                        <td>{taskType.isActive ? 'Yes' : 'No'}</td>
                        <td className="row-actions">
                          {may('task.update')
                            ? <RowAction
                                action={deleteTaskTypeAction}
                                hidden={{ projectId: data.id, taskTypeId: taskType.id }}
                                label="Delete"
                                confirm={`Delete task type ${taskType.code}?`}
                              />
                            : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>}
            {may('task.create') ? <CreateTaskTypeForm projectId={data.id} /> : null}
          </section>

          <section className="panel" id="tasks">
            <div className="panel-header"><div><h2>Tasks</h2><p>{taskList.length} in this project</p></div></div>
            {taskList.length === 0
              ? <div className="empty-list"><strong>No tasks yet</strong></div>
              : <table className="data-table">
                  <thead><tr><th>Title</th><th>Site</th><th>Status</th><th>Assignee</th><th></th></tr></thead>
                  <tbody>
                    {taskList.map((task) => (
                      <tr key={task.id}>
                        <td>{task.title}</td>
                        <td>{data.sites.find((site) => site.id === task.siteId)?.siteCode ?? '—'}</td>
                        <td><span className="badge">{task.status}</span></td>
                        <td>{task.assigneeId ?? 'Unassigned'}</td>
                        <td className="row-actions">
                          {may('task.delete')
                            ? <RowAction
                                action={deleteTaskAction}
                                hidden={{ projectId: data.id, taskId: task.id }}
                                label="Delete"
                                confirm={`Delete task "${task.title}"?`}
                              />
                            : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>}
            {may('task.create') ? <CreateTaskForm projectId={data.id} sites={data.sites} taskTypes={data.taskTypes} /> : null}
          </section>

          <section className="panel" id="milestones">
            <div className="panel-header"><div><h2>Milestones</h2><p>{data.milestones.length} declared</p></div></div>
            {data.milestones.length === 0
              ? <div className="empty-list"><strong>No milestones yet</strong></div>
              : <table className="data-table">
                  <thead><tr><th>#</th><th>Code</th><th>Name</th><th>Kind</th><th>Requires</th><th></th></tr></thead>
                  <tbody>
                    {data.milestones.map((milestone) => (
                      <tr key={milestone.id}>
                        <td>{milestone.sequence}</td>
                        <td><code>{milestone.code}</code></td>
                        <td>{milestone.name}</td>
                        <td>{milestone.kind}</td>
                        <td>{milestone.requirements.length} task type(s)</td>
                        <td className="row-actions">
                          {may('milestone.update')
                            ? <RowAction
                                action={deleteMilestoneAction}
                                hidden={{ projectId: data.id, milestoneId: milestone.id }}
                                label="Delete"
                                confirm={`Delete milestone ${milestone.code}?`}
                              />
                            : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>}
            {may('milestone.create') ? <CreateMilestoneForm projectId={data.id} taskTypes={data.taskTypes} /> : null}
          </section>
        </div>
      </section>
    </main>
  );
}
