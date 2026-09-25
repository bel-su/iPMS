import type { WorkOrderPage, WorkOrderStatusCounts } from '@ipms/contracts';
import type { WorkOrder } from '../lib/project-api';
import {
  DUE_BUCKETS, QUEUE_FILTERS, STATUS_TEXT, dueBucket, dueText, filterCount, initials, pageWindow, typeInfo,
  type QueueFilterKey, type WorkOrderType,
} from './labels';

export interface QueueParams {
  filter: QueueFilterKey;
  projectId?: string | undefined;
  type?: WorkOrderType | undefined;
  mine?: boolean;
  q?: string | undefined;
  page: number;
}

export const QUEUE_PAGE_SIZE = 25;

/**
 * The work order queue: what needs doing, soonest first.
 *
 * Grouped by when it is due rather than laid out as a wide grid, because the
 * question a coordinator asks of it is "what is late and what is next", and
 * each row carries the project (DU) beside the site because the same site
 * code is worked under several projects.
 *
 * Every control is a link or a GET form, so the queue works without
 * JavaScript and every view has a URL that can be shared.
 */
export function WorkOrderQueue({ data, params, basePath, projects, names, now, created }: {
  data: WorkOrderPage<WorkOrder>;
  params: QueueParams;
  basePath: string;
  /** The project filter's choices — the project ID (DU) is how a site's work is told apart across projects. */
  projects: readonly { id: string; code: string; name: string }[];
  names: ReadonlyMap<string, string>;
  now: Date;
  created?: number | undefined;
}) {
  const href = (changes: Partial<QueueParams>) => {
    const next = { ...params, page: 1, ...changes };
    const query = new URLSearchParams();
    if (next.filter !== 'open') query.set('filter', next.filter);
    if (next.projectId) query.set('projectId', next.projectId);
    if (next.type) query.set('type', next.type);
    if (next.mine) query.set('mine', '1');
    if (next.q) query.set('q', next.q);
    if (next.page > 1) query.set('page', String(next.page));
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  const grouped = params.filter === 'open' || params.filter === 'overdue';
  const groups = grouped
    ? DUE_BUCKETS.map((bucket) => ({ ...bucket, rows: data.items.filter((order) => dueBucket(order, now) === bucket.key) })).filter((group) => group.rows.length > 0)
    : [{ key: 'all', label: '', rows: data.items }];
  const pages = Math.max(1, Math.ceil(data.total / QUEUE_PAGE_SIZE));

  return (
    <div className="queue">
      {created ? <p className="banner success" role="status">{created === 1 ? 'Work order created.' : `${created} work orders created.`}</p> : null}

      <StatusBar counts={data.counts} />

      <nav className="pills" aria-label="Filter by state">
        {QUEUE_FILTERS.map((entry) => (
          <a key={entry.key} href={href({ filter: entry.key })} aria-current={entry.key === params.filter ? 'page' : undefined} className={entry.key === 'overdue' && data.counts.OVERDUE > 0 ? 'alert' : undefined}>
            {entry.label}<b>{filterCount(entry.key, data.counts)}</b>
          </a>
        ))}
      </nav>

      <form className="queue-filters" method="get" action={basePath}>
        {params.filter !== 'open' ? <input type="hidden" name="filter" value={params.filter} /> : null}
        <input type="search" name="q" defaultValue={params.q ?? ''} placeholder="Search site, project ID, work order or checklist" aria-label="Search work orders" maxLength={100} />
        <select name="projectId" defaultValue={params.projectId ?? ''} aria-label="Project ID (DU)">
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.code} — {project.name}</option>)}
        </select>
        <select name="type" defaultValue={params.type ?? ''} aria-label="Type of check">
          <option value="">Any check</option>
          <option value="QUALITY_SELF_CHECK">Quality Self-check</option>
          <option value="QUALITY_SPOT_CHECK">Quality Spot Check</option>
          <option value="EHS_SELF_CHECK">EHS Self-check</option>
          <option value="EHS_SPOT_CHECK">EHS Spot Check</option>
        </select>
        <label className="toggle"><input type="checkbox" name="mine" value="1" defaultChecked={params.mine} /> Assigned to me</label>
        <button className="ghost-button" type="submit">Apply</button>
      </form>

      {data.items.length === 0
        ? <div className="queue-empty">
            <strong>{params.filter === 'overdue' ? 'Nothing is overdue' : 'No work orders here'}</strong>
            <p>{params.q || params.type || params.mine ? 'Try clearing the search or filters.' : 'Work orders appear here once a checklist is assigned to a site.'}</p>
          </div>
        : groups.map((group) => (
            <section key={group.key} className={`queue-group ${group.key}`} aria-label={group.label || 'Work orders'}>
              {group.label ? <h3>{group.label}<span>{group.rows.length}</span></h3> : null}
              <ul className="queue-rows">
                {group.rows.map((order) => <QueueRow key={order.id} order={order} names={names} now={now} />)}
              </ul>
            </section>
          ))}

      {pages > 1
        ? <nav className="pager" aria-label="Pages">
            <span>{data.total} work orders</span>
            {params.page > 1 ? <a href={href({ page: params.page - 1 })} aria-label="Previous page">‹</a> : null}
            {pageWindow(Math.min(params.page, pages), pages).map((n, i) => n === null
              ? <span key={`gap-${i}`} aria-hidden="true">…</span>
              : <a key={n} href={href({ page: n })} aria-current={n === params.page ? 'page' : undefined}>{n}</a>)}
            {params.page < pages ? <a href={href({ page: params.page + 1 })} aria-label="Next page">›</a> : null}
          </nav>
        : null}
    </div>
  );
}

function QueueRow({ order, names, now }: { order: WorkOrder; names: ReadonlyMap<string, string>; now: Date }) {
  const info = order.workOrderType ? typeInfo(order.workOrderType) : null;
  const due = dueText(order, now);
  const status = STATUS_TEXT[order.status];
  const assignee = order.assigneeId ? names.get(order.assigneeId) ?? 'Unknown user' : 'Unassigned';
  return (
    <li className="queue-row">
      <span className={`kind ${info?.category === 'EHS' ? 'ehs' : 'quality'}`} title={info?.label}>
        {info?.category === 'EHS' ? 'EHS' : 'Q'}<small>{info?.selfCheck ? 'self' : 'spot'}</small>
      </span>
      <div className="queue-main">
        <a className="queue-title" href={`/work-orders/${order.id}`}>{order.title}</a>
        <div className="queue-meta">
          <span className="du" title={`Project ID (DU): ${order.project.name}`}>{order.project.code}</span>
          <span className="site"><b>{order.site.siteCode}</b>{order.site.name !== order.site.siteCode ? ` ${order.site.name}` : ''}</span>
          {order.site.city ? <span>{order.site.city}</span> : null}
          <span className="checklist" title={order.templateName ?? ''}>{order.templateName ?? 'No checklist'}</span>
        </div>
      </div>
      <span className="who" title={assignee}><i aria-hidden="true">{initials(assignee)}</i><span>{assignee}</span></span>
      <span className={`due ${due.tone}`}>{due.text}</span>
      <span className={`state ${status.tone}`}>{status.label}</span>
    </li>
  );
}

/** Where the work stands, as one bar: done, waiting on QC, bounced back, in hand, not begun. */
function StatusBar({ counts }: { counts: WorkOrderStatusCounts }) {
  const parts = [
    { key: 'COMPLETED', label: 'Completed', tone: 'green' },
    { key: 'REVIEWING', label: 'In review', tone: 'amber' },
    { key: 'RECTIFYING', label: 'Needs rework', tone: 'red' },
    { key: 'ONGOING', label: 'In progress', tone: 'blue' },
    { key: 'NOT_STARTED', label: 'Not started', tone: 'slate' },
  ] as const;
  const total = parts.reduce((sum, part) => sum + counts[part.key], 0);
  if (total === 0) return null;
  const done = Math.round((counts.COMPLETED / total) * 100);
  return (
    <div className="statusbar">
      <div className="statusbar-head"><strong>{done}%</strong> of {total} active and completed work orders passed QC</div>
      <div className="statusbar-track" role="img" aria-label={parts.map((part) => `${part.label} ${counts[part.key]}`).join(', ')}>
        {parts.map((part) => counts[part.key] > 0
          ? <span key={part.key} className={part.tone} style={{ flexGrow: counts[part.key] }} title={`${part.label}: ${counts[part.key]}`} />
          : null)}
      </div>
      <ul className="statusbar-legend">
        {parts.map((part) => <li key={part.key}><i className={part.tone} />{part.label} <b>{counts[part.key]}</b></li>)}
      </ul>
    </div>
  );
}
