import './overview/overview.css';
import { getCurrentUser, hasPermission } from './lib/iam-api';
import { listAuditEvents } from './lib/audit-api';
import { getProjectDashboard } from './lib/project-api';
import { listUsers } from './lib/user-api';
import { listWorkOrders } from './lib/work-order-api';
import { WORK_ORDERS_PATH } from './quality/work-orders/labels';
import {
  FINANCE_AUDIT_SAMPLES, OVERDUE_ADVANCE_NOTE, ADVANCES_OUT_BY_ROW, ADVANCES_PAID_OUT, ADVANCES_UNSETTLED, UNSETTLED_AGEING,
} from './overview/placeholders';
import {
  LOG_FILTERS, auditRow, filterLog, formatNpr, parseLogFilter, percent, statusBreakdown, whenLabel, type LogRow,
} from './overview/model';
import { Sidebar, StatePage, TopActions, initialsOf } from './shell';

function SampleTag() {
  return <span className="ov-sample" title="Placeholder figures. The Finance service is not connected yet.">Sample data</span>;
}

function Kpi({ label, value, unit, note, tone = 'muted', sample = false, money = false }: {
  label: string; value: string; unit?: string; note: string; tone?: 'muted' | 'green' | 'amber' | 'red'; sample?: boolean; money?: boolean;
}) {
  return (
    <article className="ov-card ov-kpi">
      <p className="ov-kpi-label">{label}{sample ? <SampleTag /> : null}</p>
      <p className={money ? 'ov-kpi-value money' : 'ov-kpi-value'}><strong>{value}</strong>{unit ? <span>{unit}</span> : null}</p>
      <p className={`ov-kpi-note ${tone}`}>{note}</p>
    </article>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ log?: string }> }) {
  const logFilter = parseLogFilter((await searchParams).log);
  const [result, org, viewer, audit, users] = await Promise.all([
    getProjectDashboard(),
    listWorkOrders({ limit: 1 }),
    getCurrentUser(),
    listAuditEvents(40),
    listUsers(),
  ]);

  if (result.state === 'unauthenticated') return <StatePage eyebrow="SECURE WORKSPACE" title="Sign in to see your projects"><p>Your dashboard reads live portfolio data through the Axiom gateway.</p><a className="primary-button" href="/login">Sign in</a></StatePage>;
  // Signed in, but without project.view. A sign-in link would send them round a
  // loop that cannot grant what an administrator has to.
  if (result.state === 'forbidden') return <StatePage eyebrow="ACCESS NEEDED" title="Your account cannot view projects"><p>{result.message}</p><p className="subtle">Ask an administrator for a role that grants <code>project.view</code>.</p></StatePage>;
  if (result.state === 'unavailable') return <StatePage eyebrow="CONNECTION NEEDED" title="Project API is not available"><p>{result.message}</p><p className="subtle">Start the gateway, Project service, PostgreSQL, Redis, and NATS, then refresh this page.</p><code>docker compose -f docker/docker-compose.yml up</code>{result.correlationId ? <p className="subtle">Correlation ID: <code>{result.correlationId}</code></p> : null}</StatePage>;

  const { data } = result;
  const now = new Date();
  // Work orders are QC's. `counts` ignores every filter, so a one-row page per
  // project is enough to read that project's tallies.
  const perProject = await Promise.all(data.projects.map((project) => listWorkOrders({ projectId: project.id, limit: 1 })));
  const counts = org.state === 'ready' ? org.data.counts : null;
  const mayCreateWorkOrder = viewer.state === 'ready' && hasPermission(viewer.data, 'task.create') && hasPermission(viewer.data, 'task.assign');

  const total = counts ? statusBreakdown(counts).total : 0;
  const approved = counts?.COMPLETED ?? 0;
  const reviewing = counts?.REVIEWING ?? 0;
  const rework = counts?.RECTIFYING ?? 0;
  const overdue = counts?.OVERDUE ?? 0;
  const dash = '—';
  const breakdown = counts ? statusBreakdown(counts) : null;

  const rows = data.projects.map((project, index) => {
    const c = perProject[index]?.state === 'ready' ? perProject[index].data.counts : null;
    const all = c ? statusBreakdown(c).total : 0;
    const open = c ? (c.NOT_STARTED ?? 0) + (c.ONGOING ?? 0) + (c.REVIEWING ?? 0) + (c.RECTIFYING ?? 0) : null;
    return { project, c, all, done: c?.COMPLETED ?? 0, open, overdue: c?.OVERDUE ?? 0, rework: c?.RECTIFYING ?? 0, reviewing: c?.REVIEWING ?? 0, advance: ADVANCES_OUT_BY_ROW[index % ADVANCES_OUT_BY_ROW.length]! };
  });
  const maxPending = Math.max(1, ...rows.map((row) => row.reviewing + row.rework));

  // The ledger holds real decisions; Finance rows are samples until that service exists.
  const people = new Map(users.state === 'ready' ? users.data.items.map((u) => [u.id, u]) : []);
  const real: LogRow[] = audit.state === 'ready'
    ? audit.data.items.map((event) => {
      const actor = event.actorId ? people.get(event.actorId) : undefined;
      return auditRow(event, actor?.fullName ?? (event.actorId ? 'Unknown user' : 'System'), actor?.roles[0]?.name ?? (event.actorId ? '' : 'Automated'));
    })
    : [];
  const samples: LogRow[] = FINANCE_AUDIT_SAMPLES.map((entry, index) => ({
    key: `finance-${index}`, at: new Date(now.getTime() - entry.minutesAgo * 60_000), tag: entry.tag, tone: entry.tone, group: 'finance',
    text: entry.text, actor: entry.actor, actorRole: entry.actorRole, ref: entry.ref, sample: true,
  }));
  const log = filterLog([...real, ...samples].sort((a, b) => b.at.getTime() - a.at.getTime()), logFilter).slice(0, 8);

  return (
    <main className="app-shell">
      <Sidebar active="overview" />
      <section className="content" id="top">
        <header className="topbar">
          <div className="crumbs">
            <span>Workspace</span>
            <b>/</b>
            <strong>Overview</strong>
          </div>
          <TopActions>
            <form className="ov-search" action={WORK_ORDERS_PATH} method="get" role="search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input type="search" name="q" placeholder="Search work orders…" aria-label="Search work orders" />
            </form>
          </TopActions>
        </header>

        <div className="dashboard ov">
          <section className="ov-head">
            <div>
              <h1>Organisation overview</h1>
              <p>All projects, reviews and payouts. Approvals are made by project managers and Finance.</p>
            </div>
            <div className="ov-head-actions">
              <a className="secondary-button" href="/projects">View projects</a>
              {mayCreateWorkOrder ? <a className="primary-button" href={`${WORK_ORDERS_PATH}/new`}>+ New work order</a> : null}
            </div>
          </section>

          <section className="ov-kpis" aria-label="Organisation summary">
            <Kpi label="Active projects" value={String(data.activeProjectCount)} unit={`${data.sitesInDelivery} sites`} note={counts ? `${approved} work orders approved to date` : 'Work order counts unavailable'} />
            <Kpi label="Work orders raised" value={counts ? String(total) : dash} unit="in total" note={counts ? (overdue > 0 ? `${overdue} overdue` : 'None overdue') : 'QC service unavailable'} tone={counts ? (overdue > 0 ? 'red' : 'green') : 'muted'} />
            <Kpi label="Approved" value={counts ? `${percent(approved, total)}%` : dash} unit="of work orders" note={counts ? `${reviewing} waiting on QC` : 'QC service unavailable'} tone={counts && reviewing > 0 ? 'amber' : 'muted'} />
            <Kpi label="Returned for rework" value={counts ? String(rework) : dash} unit="work orders" note={counts ? (rework > 0 ? 'Waiting on the field team' : 'Nothing returned') : 'QC service unavailable'} tone={counts && rework > 0 ? 'amber' : 'green'} />
            <Kpi label="Advances paid out" value={formatNpr(ADVANCES_PAID_OUT)} note={`${formatNpr(ADVANCES_UNSETTLED)} not yet settled`} tone="amber" sample money />
          </section>

          <section className="ov-card ov-panel" id="projects">
            <header className="ov-panel-head">
              <div><h2>Projects</h2><p>Delivery, quality and cash position per project</p></div>
              <a className="ov-link" href="/projects">All projects <span aria-hidden="true">→</span></a>
            </header>
            {rows.length === 0 ? (
              <div className="ov-empty"><strong>No active projects yet</strong><p><a href="/projects/new">Create a project</a>, then set its status to <code>ACTIVE</code>.</p></div>
            ) : (
              <div className="ov-scroll">
                <table className="ov-table">
                  <thead>
                    <tr>
                      <th scope="col">Project</th>
                      <th scope="col">Work orders approved</th>
                      <th scope="col">Open</th>
                      <th scope="col">In rework</th>
                      <th scope="col">Advances out <SampleTag /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ project, c, all, done, open, overdue: late, rework: back, advance }) => (
                      <tr key={project.id}>
                        <td>
                          <a className="ov-project" href={`/projects/${project.id}`}>{project.name}</a>
                          <span className="ov-sub">{project.code} · {project._count.sites} sites{project.phase ? ` · ${project.phase}` : ''}</span>
                        </td>
                        <td>
                          {c ? (
                            <>
                              <span className="ov-frac"><b>{done}</b> / {all}</span>
                              <span className="ov-meter" role="img" aria-label={`${done} of ${all} work orders approved`}><i className="green" style={{ width: `${percent(done, all)}%` }} /></span>
                            </>
                          ) : <span className="ov-sub">{dash}</span>}
                        </td>
                        <td>
                          {open === null ? <span className="ov-sub">{dash}</span> : (
                            <>
                              <span>{open}{late > 0 ? <em className="red"> · {late}</em> : null}</span>
                              {late > 0 ? <span className="ov-sub red">overdue</span> : null}
                            </>
                          )}
                        </td>
                        <td className={back > 0 ? 'amber' : undefined}>{c ? back : dash}</td>
                        <td className="ov-money">{formatNpr(advance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                    {breakdown.segments.map((s) => (
                      <li key={s.status}><i className={s.tone} aria-hidden="true" /><span>{s.label}</span><b>{s.count}</b><em>{s.share}%</em></li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="ov-empty"><strong>{breakdown ? 'No work orders yet' : 'Work orders are unavailable'}</strong><p>{breakdown ? <><a href={`${WORK_ORDERS_PATH}/new`}>Raise a work order</a> to start the QC cycle.</> : 'Project data is unaffected.'}</p></div>
              )}
            </section>

            <section className="ov-card ov-panel" id="review-queue">
              <header className="ov-panel-head"><div><h2>Review queue by project</h2><p>Work orders waiting on a decision or back with the field team</p></div></header>
              {rows.length === 0 ? <div className="ov-empty"><strong>Nothing to review</strong></div> : (
                <ul className="ov-queue">
                  {rows.map(({ project, reviewing: waiting, rework: back }) => {
                    const pending = waiting + back;
                    return (
                      <li key={project.id}>
                        <span className="ov-avatar" aria-hidden="true">{initialsOf(project.code)}</span>
                        <div>
                          <b>{project.name}</b>
                          <span className="ov-sub">{waiting} awaiting QC · {back} in rework</span>
                        </div>
                        <div className="ov-queue-end">
                          <span className={pending > 0 ? 'amber' : 'green'}>{pending} pending</span>
                          <span className="ov-meter"><i className={pending > 0 ? 'amber' : 'green'} style={{ width: `${(pending / maxPending) * 100}%` }} /></span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="ov-pair">
            <section className="ov-card ov-panel" id="cash-advances">
              <header className="ov-panel-head">
                <div><h2>Unsettled cash advances <SampleTag /></h2><p>Paid out, receipts not yet submitted</p></div>
                <strong className="ov-total">{formatNpr(ADVANCES_UNSETTLED)}</strong>
              </header>
              <ul className="ov-ageing">
                {UNSETTLED_AGEING.map((bucket) => (
                  <li key={bucket.label}>
                    <span>{bucket.label}</span>
                    <span className="ov-meter wide"><i className={bucket.tone} style={{ width: `${percent(bucket.amount, UNSETTLED_AGEING[0].amount)}%` }} /></span>
                    <b>{formatNpr(bucket.amount)}</b>
                    <em>{bucket.count}</em>
                  </li>
                ))}
              </ul>
              <p className="ov-alert">{OVERDUE_ADVANCE_NOTE}</p>
            </section>

            <section className="ov-card ov-panel" id="audit-log">
              <header className="ov-panel-head">
                <div><h2>Audit log</h2><p>Every decision on work orders and advances, with who made it</p></div>
                <nav className="ov-chips" aria-label="Filter the audit log">
                  {LOG_FILTERS.map(({ key, label }) => (
                    <a key={key} href={key === 'all' ? '/#audit-log' : `/?log=${key}#audit-log`} className={key === logFilter ? 'on' : undefined} aria-current={key === logFilter ? 'true' : undefined}>{label}</a>
                  ))}
                </nav>
              </header>
              {audit.state !== 'ready' ? <p className="ov-note">{audit.state === 'forbidden' ? 'Your role cannot read the audit ledger, so only sample Finance entries appear.' : 'The audit ledger did not answer, so only sample Finance entries appear.'}</p> : null}
              {log.length === 0 ? (
                <div className="ov-empty"><strong>No entries match</strong><p>Nothing has been recorded under this filter yet.</p></div>
              ) : (
                <ol className="ov-log">
                  {log.map((row) => (
                    <li key={row.key}>
                      <time dateTime={row.at.toISOString()}>{whenLabel(row.at, now)}</time>
                      <p><span className={`ov-tag ${row.tone}`}>{row.tag}</span>{row.text}{row.sample ? <SampleTag /> : null}</p>
                      <div className="ov-by"><b>{row.actor}</b>{row.actorRole ? <span>{row.actorRole}</span> : null}</div>
                      <code>{row.ref}</code>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
