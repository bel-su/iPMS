import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { getProject, listWorkOrders, type TaskStatus } from '../../../lib/project-api';
import { listUserDirectory } from '../../../lib/user-api';
import { ProjectFrame, projectProblem } from '../frame';
import { STATUS_LABEL } from '../summary';
import { STATUS_TABS, WORK_ORDER_TYPE_LABEL, formatDateTime, pageWindow, personLabel } from './labels';

const PAGE_SIZE = 20;

export default async function WorkOrdersPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const status = STATUS_TABS.find((tab) => tab.key === query.status && tab.key !== 'ALL')?.key as TaskStatus | undefined;
  const q = query.q?.trim().slice(0, 100) || undefined;
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);

  const [project, workOrders, user, people] = await Promise.all([
    getProject(id), listWorkOrders(id, { status, q, page, limit: PAGE_SIZE }), getCurrentUser(), listUserDirectory(),
  ]);
  if (project.state !== 'ready') return projectProblem(project);

  // For clarity only — the gateway and the service are what enforce this.
  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  const name = new Map(people.state === 'ready' ? people.data.map((person) => [person.id, personLabel(person)]) : []);
  const base = `/projects/${project.data.id}/work-orders`;
  const href = (changes: { status?: string | undefined; page?: number }) => {
    const next = new URLSearchParams();
    const s = 'status' in changes ? changes.status : status;
    if (s) next.set('status', s);
    if (q) next.set('q', q);
    if (changes.page && changes.page > 1) next.set('page', String(changes.page));
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <ProjectFrame project={project.data} active="work-orders">
      <section className="panel" id="work-orders">
        <div className="toolbar">
          <div className="toolbar-actions">
            {may('task.create') && may('task.assign') ? <a className="primary-button" href={`${base}/new`}>+ Create</a> : null}
            {may('qc_template.view') ? <a className="ghost-button" href="/quality/templates">Templates</a> : null}
          </div>
          <form className="search-form" method="get" action={base} role="search">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <input name="q" defaultValue={q ?? ''} placeholder="Site code/name, work order or template name" aria-label="Search work orders" maxLength={100} />
            <button className="ghost-button" type="submit">Search</button>
          </form>
        </div>

        {workOrders.state !== 'ready'
          ? <div className="empty-list"><strong>Work orders could not be loaded</strong><p>{workOrders.state === 'unauthenticated' ? 'Sign in again to continue.' : workOrders.message}</p></div>
          : <>
              <nav className="tab-row" aria-label="Work order status">
                {STATUS_TABS.map((tab) => (
                  <a key={tab.key} href={href({ status: tab.key === 'ALL' ? undefined : tab.key })} aria-current={(status ?? 'ALL') === tab.key ? 'page' : undefined}>
                    {tab.label}<span className="tab-count">({workOrders.data.counts[tab.key]})</span>
                  </a>
                ))}
              </nav>
              {workOrders.data.items.length === 0
                ? <div className="empty-list">
                    <strong>{q || status ? 'No work orders match' : 'No work orders yet'}</strong>
                    <p>{q || status ? 'Try another tab or search.' : 'Create one to assign a checklist to a site.'}</p>
                  </div>
                : <div className="table-scroll">
                    <table className="data-table compact">
                      <thead>
                        <tr>
                          <th>No.</th><th>Site Code</th><th>Site Name</th><th>Work Order Name</th><th>Status</th>
                          <th>Template Name</th><th>Work Order Type</th><th>Responsible Person</th>
                          <th>Planned Completion</th><th>Actual Completion</th><th>Area</th><th>City</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workOrders.data.items.map((order, index) => (
                          <tr key={order.id}>
                            <td>{(page - 1) * PAGE_SIZE + index + 1}</td>
                            <td><code>{order.site.siteCode}</code></td>
                            <td>{order.site.name}</td>
                            <td className="clip" title={order.title}>{order.title}</td>
                            <td><span className={`badge ${STATUS_LABEL[order.status].tone}`}>{STATUS_LABEL[order.status].label}</span></td>
                            <td className="clip" title={order.templateName ?? ''}>
                              {order.templateId && may('qc_template.view')
                                ? <a className="link" href={`/quality/templates/${order.templateId}`}>{order.templateName ?? 'Template'}</a>
                                : order.templateName ?? '—'}
                            </td>
                            <td>{order.workOrderType ? WORK_ORDER_TYPE_LABEL[order.workOrderType] : '—'}</td>
                            <td>{order.assigneeId ? name.get(order.assigneeId) ?? 'Unknown user' : 'Unassigned'}</td>
                            <td>{formatDateTime(order.plannedCompletionAt)}</td>
                            <td>{formatDateTime(order.actualCompletionAt)}</td>
                            <td>{order.site.area ?? '—'}</td>
                            <td>{order.site.city ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>}
              <Pagination total={workOrders.data.total} page={page} href={(n) => href({ page: n })} />
            </>}
      </section>
    </ProjectFrame>
  );
}

function Pagination({ total, page, href }: { total: number; page: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <nav className="pagination" aria-label="Pages">
      <span className="subtle">Total {total}</span>
      {page > 1 ? <a href={href(page - 1)} aria-label="Previous page">‹</a> : <span aria-hidden="true">‹</span>}
      {pageWindow(Math.min(page, pages), pages).map((n, i) => n === null
        ? <span key={`gap-${i}`} aria-hidden="true">…</span>
        : <a key={n} href={href(n)} aria-current={n === page ? 'page' : undefined}>{n}</a>)}
      {page < pages ? <a href={href(page + 1)} aria-label="Next page">›</a> : <span aria-hidden="true">›</span>}
    </nav>
  );
}
