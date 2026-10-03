import './overview.css';
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listAuditEvents } from '../lib/audit-api';
import { getProjectDashboard } from '../lib/project-api';
import { getMyProfile, listUsers } from '../lib/user-api';
import { listWorkOrders } from '../lib/work-order-api';
import { WORK_ORDERS_PATH, WORK_ORDER_TYPE_LABEL, dueText } from '../quality/work-orders/labels';
import { ADVANCE_PIPELINE, ADVANCE_REQUESTS } from './placeholders';
import { auditRow, dayLabel, firstName, formatNpr, greeting, percent, statusBreakdown, whenLabel, workOrderRef } from './model';
import { Sidebar, StatePage, TopActions } from '../shell';

type QueueTab = 'all' | 'work-orders' | 'advances';
const TABS: readonly { key: QueueTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'work-orders', label: 'Work orders' },
  { key: 'advances', label: 'Cash advances' },
];

function SampleTag() {
  return <span className="ov-sample" title="Placeholder figures. The Finance service is not connected yet.">Sample data</span>;
}

function Kpi({ label, value, unit, note, tone = 'muted', sample = false }: {
  label: string; value: string; unit: string; note: string; tone?: 'muted' | 'green' | 'amber' | 'red'; sample?: boolean;
}) {
  return (
    <article className="ov-card ov-kpi">
      <p className="ov-kpi-label">{label}</p>
      {sample ? <SampleTag /> : null}
      <p className="ov-kpi-value"><strong>{value}</strong><span>{unit}</span></p>
      <p className={`ov-kpi-note ${tone}`}>{note}</p>
    </article>
  );
}

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></svg>
);
const CashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>
);

/** The project manager's home: what is waiting on their decision, then how their projects are doing. */
export async function ManagerOverview({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const requested = (await searchParams).tab;
  const tab: QueueTab = TABS.find(({ key }) => key === requested)?.key ?? 'all';
  const [dashboard, review, rework, viewer, profile, audit, users] = await Promise.all([
    getProjectDashboard(),
    listWorkOrders({ status: 'REVIEWING', limit: 20 }),
    listWorkOrders({ limit: 1 }),
    getCurrentUser(),
    getMyProfile(),
    listAuditEvents(10),
    listUsers(),
  ]);

  if (dashboard.state === 'unauthenticated') return <StatePage eyebrow="SECURE WORKSPACE" title="Sign in to see your projects"><p>Your decision queue reads live data through the iPMS gateway.</p><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (dashboard.state === 'forbidden') return <StatePage eyebrow="ACCESS NEEDED" title="Your account cannot view projects"><p>{dashboard.message}</p><p className="subtle">Ask an administrator for a role that grants <code>project.view</code>.</p></StatePage>;
  if (dashboard.state === 'unavailable') return <StatePage eyebrow="CONNECTION NEEDED" title="Project API is not available"><p>{dashboard.message}</p><p className="subtle">Start the gateway, Project service, PostgreSQL, Redis, and NATS, then refresh this page.</p><code>docker compose -f docker/docker-compose.yml up</code>{dashboard.correlationId ? <p className="subtle">Correlation ID: <code>{dashboard.correlationId}</code></p> : null}</StatePage>;

  const now = new Date();
  const perProject = await Promise.all(dashboard.data.projects.map((project) => listWorkOrders({ projectId: project.id, limit: 1 })));
  const mayCreate = viewer.state === 'ready' && hasPermission(viewer.data, 'task.create') && hasPermission(viewer.data, 'task.assign');
  const name = firstName(profile?.state === 'ready' ? profile.data.fullName : undefined);

  // Most overdue first, then soonest due: the order a manager should clear them in.
  const waiting = review.state === 'ready'
    ? [...review.data.items].sort((a, b) => new Date(a.plannedCompletionAt).getTime() - new Date(b.plannedCompletionAt).getTime())
    : [];
  const reviewTotal = review.state === 'ready' ? review.data.counts.REVIEWING : 0;
  const lateCount = waiting.filter((order) => dueText(order, now).tone === 'red').length;
  const reworkCount = rework.state === 'ready' ? rework.data.counts.RECTIFYING : 0;

  const advanceTotal = ADVANCE_REQUESTS.reduce((sum, request) => sum + request.amount, 0);
  const withFinance = ADVANCE_PIPELINE[1];
  const showOrders = tab !== 'advances';
  const showAdvances = tab !== 'work-orders';

  const people = new Map(users.state === 'ready' ? users.data.items.map((u) => [u.id, u]) : []);
  const activity = audit.state === 'ready'
    ? audit.data.items.slice(0, 5).map((event) => {
      const actor = event.actorId ? people.get(event.actorId) : undefined;
      return auditRow(event, actor?.fullName ?? (event.actorId ? 'Someone' : 'System'), '');
    })
    : [];

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
                  : reviewTotal === 0 ? 'No work orders are waiting on you.'
                    : `${reviewTotal} work order${reviewTotal === 1 ? '' : 's'} need${reviewTotal === 1 ? 's' : ''} your decision${lateCount > 0 ? `, ${lateCount} overdue` : ''}.`}
              </p>
            </div>
            <div className="ov-head-actions">
              {mayCreate ? <a className="primary-button" href={`${WORK_ORDERS_PATH}/new`}>+ New work order</a> : null}
            </div>
          </section>

          <section className="ov-kpis ov-kpis-4" aria-label="What is waiting on you">
            <Kpi label="Awaiting QC review" value={review.state === 'ready' ? String(reviewTotal) : '—'} unit="work orders" note={lateCount > 0 ? `${lateCount} overdue` : 'None overdue'} tone={lateCount > 0 ? 'red' : 'green'} />
            <Kpi label="Returned for rework" value={rework.state === 'ready' ? String(reworkCount) : '—'} unit="with field team" note={reworkCount > 0 ? 'Waiting on resubmission' : 'Nothing returned'} tone={reworkCount > 0 ? 'amber' : 'green'} />
            <Kpi label="Advances to approve" value={String(ADVANCE_REQUESTS.length)} unit="requests" note={`${formatNpr(advanceTotal)} requested`} tone="muted" sample />
            <Kpi label="With Finance for payout" value={String(withFinance.count)} unit="approved" note={`${formatNpr(withFinance.amount)} pending`} tone="muted" sample />
          </section>

          <section className="ov-card ov-panel" id="decisions">
            <header className="ov-panel-head">
              <div><h2>Needs your decision</h2><p>Overdue and oldest first</p></div>
              <a className="ov-link" href={WORK_ORDERS_PATH}>Open full queue <span aria-hidden="true">→</span></a>
            </header>
            <nav className="mg-tabs" aria-label="Filter the queue">
              {TABS.map(({ key, label }) => {
                const count = key === 'all' ? reviewTotal + ADVANCE_REQUESTS.length : key === 'work-orders' ? reviewTotal : ADVANCE_REQUESTS.length;
                return (
                  <a key={key} href={key === 'all' ? '/#decisions' : `/?tab=${key}#decisions`} className={key === tab ? 'on' : undefined} aria-current={key === tab ? 'true' : undefined}>
                    {label}<span>{count}</span>
                  </a>
                );
              })}
            </nav>

            <ul className="mg-queue">
              {showOrders && waiting.map((order) => {
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
              {showOrders && review.state === 'ready' && waiting.length === 0 ? (
                <li className="mg-empty"><div><strong>No work orders to review</strong><p>New submissions from the field appear here.</p></div></li>
              ) : null}
              {showOrders && review.state !== 'ready' ? (
                <li className="mg-empty"><div><strong>Work orders are unavailable</strong><p>The QC service did not answer. Cash advances below are unaffected.</p></div></li>
              ) : null}
              {showAdvances ? <li className="mg-divider"><span>Cash advance requests <SampleTag /> shown until the Finance service is connected</span></li> : null}
              {showAdvances && ADVANCE_REQUESTS.map((request) => (
                <li key={request.ref}>
                  <span className="mg-icon cash" aria-hidden="true"><CashIcon /></span>
                  <div className="mg-main">
                    <p>{request.title}<code>{request.ref}</code></p>
                    <span>{request.who} · {request.where}</span>
                    <span>{request.context}</span>
                  </div>
                  <div className="mg-end">
                    <b className="mg-amount">{formatNpr(request.amount)}</b>
                    <span className="mg-when">{request.requested}</span>
                    <div className="mg-actions">
                      <button type="button" className="mg-reject" disabled title="Available when the Finance service is connected">Reject</button>
                      <button type="button" className="mg-approve" disabled title="Available when the Finance service is connected">Approve</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <div className="ov-pair">
            <section className="ov-card ov-panel" id="cash-advances">
              <header className="ov-panel-head">
                <div><h2>Cash advance pipeline <SampleTag /></h2><p>This month, synced from the Finance service</p></div>
              </header>
              <ol className="mg-pipeline">
                {ADVANCE_PIPELINE.map((step) => (
                  <li key={step.stage} className={step.tone}>
                    <div><b>{step.stage}</b><span>{step.owner}</span></div>
                    <div className="mg-pipe-end"><b>{formatNpr(step.amount)}</b><span>{step.count} requests</span></div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="ov-card ov-panel" id="projects">
              <header className="ov-panel-head">
                <div><h2>Projects</h2><p>Work order status by project</p></div>
                <a className="ov-link" href="/projects">All <span aria-hidden="true">→</span></a>
              </header>
              {dashboard.data.projects.length === 0 ? (
                <div className="ov-empty"><strong>No active projects yet</strong></div>
              ) : (
                <ul className="mg-projects">
                  {dashboard.data.projects.map((project, index) => {
                    const result = perProject[index];
                    const parts = result?.state === 'ready' ? statusBreakdown(result.data.counts) : null;
                    const by = (status: string) => parts?.segments.find((s) => s.status === status)?.count ?? 0;
                    return (
                      <li key={project.id}>
                        <div className="mg-project-head">
                          <div><a className="ov-project" href={`/projects/${project.id}`}>{project.name}</a><span className="ov-sub">{project.code} · {project._count.sites} sites</span></div>
                          <b>{parts ? `${percent(by('COMPLETED'), parts.total)}%` : '—'}</b>
                        </div>
                        {parts && parts.total > 0 ? (
                          <>
                            <div className="ov-stack" role="img" aria-label="Work orders by status">
                              {parts.segments.filter((s) => s.count > 0).map((s) => <i key={s.status} className={s.tone} style={{ width: `${s.width}%` }} />)}
                            </div>
                            <p className="mg-project-legend">
                              <span>{by('COMPLETED')} approved</span><span>{by('REVIEWING')} in QC</span><span>{by('ONGOING') + by('NOT_STARTED')} to do</span>
                              {by('RECTIFYING') > 0 ? <span className="red">{by('RECTIFYING')} in rework</span> : <span className="green">No rework</span>}
                            </p>
                          </>
                        ) : <p className="ov-sub">{parts ? 'No work orders yet' : 'Work orders unavailable'}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <section className="ov-card ov-panel" id="activity">
            <header className="ov-panel-head"><div><h2>Recent activity</h2></div></header>
            {audit.state !== 'ready' ? (
              <p className="ov-note">{audit.state === 'forbidden' ? 'Your role cannot read the audit ledger, so recent activity is not shown.' : 'The audit ledger did not answer.'}</p>
            ) : activity.length === 0 ? (
              <div className="ov-empty"><strong>Nothing recorded yet</strong></div>
            ) : (
              <ul className="mg-activity">
                {activity.map((row) => (
                  <li key={row.key} className={row.tone}>
                    <p>{row.text} <code>{row.ref}</code> <span>· {row.actor}</span></p>
                    <time dateTime={row.at.toISOString()}>{whenLabel(row.at, now)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
