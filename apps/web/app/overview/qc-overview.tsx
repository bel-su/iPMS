import './overview.css';
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listAuditEvents } from '../lib/audit-api';
import { getProjectDashboard } from '../lib/project-api';
import { listTemplates } from '../lib/qc-api';
import { getMyProfile, listUsers } from '../lib/user-api';
import { listWorkOrders } from '../lib/work-order-api';
import { WORK_ORDERS_PATH, WORK_ORDER_TYPE_LABEL, dueText } from '../quality/work-orders/labels';
import { auditRow, dayLabel, firstName, greeting, percent, statusBreakdown, whenLabel, workOrderRef } from './model';
import { CheckIcon, Kpi, SignInPage, newWorkOrderHref } from './parts';
import { Sidebar, TopActions } from '../shell';

/** The QC manager's home: submissions waiting on a review, and the health of the checklists behind them. */
export async function QcOverview() {
  const [review, all, viewer, profile, dashboard, audit, users, enabled, drafts, disabled] = await Promise.all([
    listWorkOrders({ status: 'REVIEWING', limit: 20 }),
    listWorkOrders({ limit: 1 }),
    getCurrentUser(),
    getMyProfile(),
    getProjectDashboard(),
    listAuditEvents(6),
    listUsers(),
    listTemplates({ tab: 'enabled' }),
    listTemplates({ tab: 'draft' }),
    listTemplates({ tab: 'disabled' }),
  ]);
  if (review.state === 'unauthenticated') return <SignInPage what="your review queue" />;

  const now = new Date();
  const name = firstName(profile?.state === 'ready' ? profile.data.fullName : undefined);
  const mayCreate = viewer.state === 'ready' && hasPermission(viewer.data, 'task.create') && hasPermission(viewer.data, 'task.assign');
  const counts = all.state === 'ready' ? all.data.counts : null;
  const waiting = review.state === 'ready'
    ? [...review.data.items].sort((a, b) => new Date(a.plannedCompletionAt).getTime() - new Date(b.plannedCompletionAt).getTime())
    : [];
  const reviewTotal = review.state === 'ready' ? review.data.counts.REVIEWING : 0;
  const late = waiting.filter((order) => dueText(order, now).tone === 'red').length;
  const breakdown = counts ? statusBreakdown(counts) : null;
  const approved = counts?.COMPLETED ?? 0;

  const projects = dashboard.state === 'ready' ? dashboard.data.projects : [];
  const perProject = await Promise.all(projects.map((project) => listWorkOrders({ projectId: project.id, limit: 1 })));

  const people = new Map(users.state === 'ready' ? users.data.items.map((u) => [u.id, u]) : []);
  const activity = audit.state === 'ready'
    ? audit.data.items.map((event) => {
      const actor = event.actorId ? people.get(event.actorId) : undefined;
      return auditRow(event, actor?.fullName ?? (event.actorId ? 'Someone' : 'System'), '');
    })
    : [];
  const library = [
    { label: 'Enabled', result: enabled, note: 'Ready to assign' },
    { label: 'Draft', result: drafts, note: 'Being written' },
    { label: 'Disabled', result: disabled, note: 'Not assignable' },
  ];

  return (
    <main className="app-shell">
      <Sidebar active="overview" />
      <section className="content" id="top">
        <header className="topbar">
          <div className="crumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
          <TopActions />
        </header>

        <div className="dashboard ov">
          <section className="ov-head">
            <div>
              <p className="ov-date">{dayLabel(now)}</p>
              <h1>{greeting(now)}{name ? `, ${name}` : ''}</h1>
              <p>
                {review.state !== 'ready' ? 'Work orders are unavailable right now.'
                  : reviewTotal === 0 ? 'Nothing is waiting for your review.'
                    : `${reviewTotal} submission${reviewTotal === 1 ? '' : 's'} waiting for your review${late > 0 ? `, ${late} overdue` : ''}.`}
              </p>
            </div>
            <div className="ov-head-actions">
              {mayCreate ? <a className="primary-button" href={newWorkOrderHref}>+ New work order</a> : null}
            </div>
          </section>

          <section className="ov-kpis ov-kpis-4" aria-label="Quality summary">
            <Kpi label="Awaiting review" value={review.state === 'ready' ? String(reviewTotal) : '—'} unit="submissions" note={late > 0 ? `${late} overdue` : 'None overdue'} tone={late > 0 ? 'red' : 'green'} />
            <Kpi label="Returned for rework" value={counts ? String(counts.RECTIFYING) : '—'} unit="work orders" note={counts && counts.RECTIFYING > 0 ? 'With the field team' : 'Nothing returned'} tone={counts && counts.RECTIFYING > 0 ? 'amber' : 'green'} />
            <Kpi label="Approved" value={breakdown ? `${percent(approved, breakdown.total)}%` : '—'} unit="of work orders" note={`${approved} approved to date`} />
            <Kpi label="Overdue" value={counts ? String(counts.OVERDUE) : '—'} unit="work orders" note={counts && counts.OVERDUE > 0 ? 'Past their due date' : 'All on time'} tone={counts && counts.OVERDUE > 0 ? 'red' : 'green'} />
          </section>

          <section className="ov-card ov-panel" id="decisions">
            <header className="ov-panel-head">
              <div><h2>Waiting for your review</h2><p>Overdue and oldest first</p></div>
              <a className="ov-link" href={WORK_ORDERS_PATH}>All work orders <span aria-hidden="true">→</span></a>
            </header>
            <ul className="mg-queue">
              {waiting.map((order) => {
                const due = dueText(order, now);
                return (
                  <li key={order.id}>
                    <span className="mg-icon" aria-hidden="true"><CheckIcon /></span>
                    <div className="mg-main">
                      <p><a href={`${WORK_ORDERS_PATH}/${order.id}`}>{order.title}</a><code>{workOrderRef(order.id)}</code></p>
                      <span>{order.site.siteCode} · {order.project.name}</span>
                      <span>{WORK_ORDER_TYPE_LABEL[order.workOrderType]}</span>
                    </div>
                    <div className="mg-end">
                      <b className={due.tone}>{due.text}</b>
                      <a className="mg-review" href={`${WORK_ORDERS_PATH}/${order.id}`}>Review</a>
                    </div>
                  </li>
                );
              })}
              {review.state === 'ready' && waiting.length === 0 ? <li className="mg-empty"><div><strong>Nothing to review</strong><p>New submissions from the field appear here.</p></div></li> : null}
              {review.state !== 'ready' ? <li className="mg-empty"><div><strong>Work orders are unavailable</strong><p>The QC service did not answer.</p></div></li> : null}
            </ul>
          </section>

          <div className="ov-pair">
            <section className="ov-card ov-panel" id="work-order-status">
              <header className="ov-panel-head"><div><h2>Work order status</h2><p>{breakdown ? `${breakdown.total} work orders, cancelled excluded` : 'The QC service did not answer'}</p></div></header>
              {breakdown && breakdown.total > 0 ? (
                <>
                  <div className="ov-stack" role="img" aria-label="Work orders by status">
                    {breakdown.segments.filter((s) => s.count > 0).map((s) => <i key={s.status} className={s.tone} style={{ width: `${s.width}%` }} />)}
                  </div>
                  <ul className="ov-legend">
                    {breakdown.segments.map((s) => <li key={s.status}><i className={s.tone} aria-hidden="true" /><span>{s.label}</span><b>{s.count}</b><em>{s.share}%</em></li>)}
                  </ul>
                </>
              ) : <div className="ov-empty"><strong>No work orders yet</strong></div>}
            </section>

            <section className="ov-card ov-panel" id="library">
              <header className="ov-panel-head">
                <div><h2>Checklist library</h2><p>The templates work orders are raised from</p></div>
                <a className="ov-link" href="/quality/templates">Open library <span aria-hidden="true">→</span></a>
              </header>
              <ul className="ov-legend qc-library">
                {library.map(({ label, result, note }) => (
                  <li key={label}><span /><span>{label} <small>{note}</small></span><b>{result.state === 'ready' ? result.data.length : '—'}</b><span /></li>
                ))}
              </ul>
            </section>
          </div>

          {projects.length > 0 ? (
            <section className="ov-card ov-panel" id="projects">
              <header className="ov-panel-head">
                <div><h2>Projects</h2><p>Work order status by project</p></div>
                <a className="ov-link" href="/projects">All <span aria-hidden="true">→</span></a>
              </header>
              <ul className="mg-projects">
                {projects.map((project, index) => {
                  const result = perProject[index];
                  const parts = result?.state === 'ready' ? statusBreakdown(result.data.counts) : null;
                  const by = (status: string) => parts?.segments.find((s) => s.status === status)?.count ?? 0;
                  return (
                    <li key={project.id}>
                      <div className="mg-project-head">
                        <div><a className="ov-project" href={`/projects/${project.id}`}>{project.name}</a><span className="ov-sub">{project.code}</span></div>
                        <b>{parts ? `${percent(by('COMPLETED'), parts.total)}%` : '—'}</b>
                      </div>
                      {parts && parts.total > 0 ? (
                        <>
                          <div className="ov-stack" role="img" aria-label="Work orders by status">
                            {parts.segments.filter((s) => s.count > 0).map((s) => <i key={s.status} className={s.tone} style={{ width: `${s.width}%` }} />)}
                          </div>
                          <p className="mg-project-legend">
                            <span>{by('COMPLETED')} approved</span><span>{by('REVIEWING')} in review</span>
                            {by('RECTIFYING') > 0 ? <span className="red">{by('RECTIFYING')} in rework</span> : <span className="green">No rework</span>}
                          </p>
                        </>
                      ) : <p className="ov-sub">{parts ? 'No work orders yet' : 'Work orders unavailable'}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {activity.length > 0 ? (
            <section className="ov-card ov-panel" id="activity">
              <header className="ov-panel-head"><div><h2>Recent activity</h2></div></header>
              <ul className="mg-activity">
                {activity.map((row) => (
                  <li key={row.key} className={row.tone}>
                    <p>{row.text} <code>{row.ref}</code> <span>· {row.actor}</span></p>
                    <time dateTime={row.at.toISOString()}>{whenLabel(row.at, now)}</time>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
