import { listProjects } from '../../lib/project-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { WORK_ORDERS_PATH } from './labels';
import { loadQueue, type QueueSearch } from './load';
import { WorkOrderQueue } from './queue';

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<QueueSearch> }) {
  const search = await searchParams;
  const [queue, projects] = await Promise.all([loadQueue(search), listProjects()]);
  const { result } = queue;
  if (result.state === 'unauthenticated') {
    return <StatePage title="Sign in to see work orders"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (result.state !== 'ready') {
    return <StatePage title="Work orders are not available"><p>{result.message}</p></StatePage>;
  }
  const choices = projects.state === 'ready' ? projects.data.filter((p) => p.status !== 'CANCELLED').map((p) => ({ id: p.id, code: p.code, name: p.name })) : [];
  const newHref = queue.params.projectId ? `${WORK_ORDERS_PATH}/new?projectId=${queue.params.projectId}` : `${WORK_ORDERS_PATH}/new`;

  return (
    <main className="app-shell">
      <Sidebar active="work-orders" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/quality">Quality &amp; EHS</a><b>/</b><strong>Work orders</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">QUALITY &amp; EHS</p><h1>Work orders</h1><p className="subtle">Checklists assigned to sites, across every project you can see.</p></div>
            {queue.may('task.create') && queue.may('task.assign') ? <a className="primary-button" href={newHref}>+ Assign a checklist</a> : null}
          </div>
          <section className="panel">
            <WorkOrderQueue data={result.data} params={queue.params} basePath={WORK_ORDERS_PATH} projects={choices} names={queue.names} now={new Date()} created={queue.created} />
          </section>
        </div>
      </section>
    </main>
  );
}
