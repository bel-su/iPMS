import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { getProject } from '../../../lib/project-api';
import { deleteMilestoneAction, deleteTaskTypeAction } from '../../actions';
import { CreateMilestoneForm, CreateTaskTypeForm, RowAction } from '../../forms';
import { ProjectFrame, projectProblem } from '../frame';

/** The project's structure: the kinds of work it contains, and the milestones they add up to. */
export default async function ProjectSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, user] = await Promise.all([getProject(id), getCurrentUser()]);
  if (project.state !== 'ready') return projectProblem(project);

  // For clarity only — the gateway and the service guards are what enforce this.
  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  const data = project.data;

  return (
    <ProjectFrame project={data} active="setup">
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
    </ProjectFrame>
  );
}
