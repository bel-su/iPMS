import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { getProject, listTasks } from '../../../lib/project-api';
import { deleteTaskAction } from '../../actions';
import { CreateTaskForm, RowAction } from '../../forms';
import { ProjectFrame, projectProblem } from '../frame';
import { STATUS_LABEL, formatDay } from '../summary';

export default async function ProjectTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, tasks, user] = await Promise.all([getProject(id), listTasks(id), getCurrentUser()]);
  if (project.state !== 'ready') return projectProblem(project);

  // For clarity only — the gateway and the service guards are what enforce this.
  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  const data = project.data;
  const taskList = tasks.state === 'ready' ? tasks.data : [];
  const siteCode = new Map(data.sites.map((site) => [site.id, site.siteCode]));
  const taskType = new Map(data.taskTypes.map((type) => [type.id, type.name]));

  return (
    <ProjectFrame project={data} active="tasks">
      <section className="panel" id="tasks">
        <div className="panel-header"><div><h2>Tasks</h2><p>{taskList.length} in this project</p></div></div>
        {tasks.state !== 'ready'
          ? <div className="empty-list"><strong>Tasks could not be loaded</strong><p>{tasks.state === 'unauthenticated' ? 'Sign in again to continue.' : tasks.message}</p></div>
          : taskList.length === 0
            ? <div className="empty-list"><strong>No tasks yet</strong></div>
            : <table className="data-table">
                <thead><tr><th>Title</th><th>Site</th><th>Type</th><th>Status</th><th>Due</th><th>Assignee</th><th></th></tr></thead>
                <tbody>
                  {taskList.map((task) => (
                    <tr key={task.id}>
                      <td>{task.title}</td>
                      <td>{siteCode.get(task.siteId) ?? '—'}</td>
                      <td>{taskType.get(task.taskTypeId) ?? '—'}</td>
                      <td><span className={`badge ${STATUS_LABEL[task.status].tone}`}>{STATUS_LABEL[task.status].label}</span></td>
                      <td>{task.plannedCompletionAt ? formatDay(task.plannedCompletionAt) : '—'}</td>
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
    </ProjectFrame>
  );
}
