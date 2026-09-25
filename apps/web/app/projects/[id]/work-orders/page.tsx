import { getProject } from '../../../lib/project-api';
import { loadQueue, type QueueSearch } from '../../../work-orders/load';
import { WorkOrderQueue } from '../../../work-orders/queue';
import { ProjectFrame, projectProblem } from '../frame';

/** The same queue as `/work-orders`, pinned to this project. */
export default async function ProjectWorkOrdersPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<QueueSearch>;
}) {
  const { id } = await params;
  const [project, queue] = await Promise.all([getProject(id), loadQueue(await searchParams, id)]);
  if (project.state !== 'ready') return projectProblem(project);
  const { result } = queue;

  return (
    <ProjectFrame project={project.data} active="work-orders">
      <section className="panel" id="work-orders">
        <div className="panel-header">
          <div><h2>Work orders</h2><p>Project ID (DU) <code>{project.data.code}</code></p></div>
          {queue.may('task.create') && queue.may('task.assign') ? <a className="primary-button" href={`/work-orders/new?projectId=${id}`}>+ Assign a checklist</a> : null}
        </div>
        {result.state !== 'ready'
          ? <div className="empty-list"><strong>Work orders could not be loaded</strong><p>{result.state === 'unauthenticated' ? 'Sign in again to continue.' : result.message}</p></div>
          : <WorkOrderQueue data={result.data} params={queue.params} basePath={`/projects/${id}/work-orders`} names={queue.names} now={new Date()} created={queue.created} />}
      </section>
    </ProjectFrame>
  );
}
