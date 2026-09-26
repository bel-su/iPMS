import { getProjectDashboard } from './lib/project-api';
import { listWorkOrders } from './lib/work-order-api';
import { STATUS_TEXT, WORK_ORDER_TYPE_LABEL, WORK_ORDERS_PATH, dueText, filterCount, workOrderPath } from './quality/work-orders/labels';
import { Sidebar, StatePage, TopActions } from './shell';

function Metric({ icon, label, value, detail, tone }: { icon: string; label: string; value: number; detail: string; tone: string }) {
  return <article className="metric-card"><div className="metric-heading"><span className={`metric-icon ${tone}`}>{icon}</span><span>{label}</span></div><strong>{value}</strong><p>{detail}</p></article>;
}

export default async function DashboardPage() {
  // Review and rework counts are QC's: it holds the work orders. The open view
  // comes back soonest-due first, and its counts ignore the view, so one call
  // fills both the metrics and the quality queue.
  const [result, workOrders] = await Promise.all([getProjectDashboard(), listWorkOrders({ view: 'open', limit: 5 })]);
  const counts = workOrders.state === 'ready' ? workOrders.data.counts : null;
  const nextUp = workOrders.state === 'ready' ? workOrders.data.items : [];
  const now = new Date();
  if (result.state === 'unauthenticated') return <StatePage eyebrow="SECURE WORKSPACE" title="Sign in to see your projects"><p>Your dashboard reads live portfolio data through the iPMS gateway.</p><a className="primary-button" href="/login">Sign in</a></StatePage>;
  // Signed in, but without project.view. A sign-in link would send them round a
  // loop that cannot grant what an administrator has to.
  if (result.state === 'forbidden') return <StatePage eyebrow="ACCESS NEEDED" title="Your account cannot view projects"><p>{result.message}</p><p className="subtle">Ask an administrator for a role that grants <code>project.view</code>.</p></StatePage>;
  if (result.state === 'unavailable') return <StatePage eyebrow="CONNECTION NEEDED" title="Project API is not available"><p>{result.message}</p><p className="subtle">Start the gateway, Project service, PostgreSQL, Redis, and NATS, then refresh this page.</p><code>docker compose -f docker/docker-compose.yml up</code>{result.correlationId ? <p className="subtle">Correlation ID: <code>{result.correlationId}</code></p> : null}</StatePage>;

  const { data } = result;
  return <main className="app-shell">
    <Sidebar active="overview" />
    <section className="content" id="top"><header className="topbar"><div className="crumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div><TopActions /></header>
      <div className="dashboard"><section className="welcome"><div><p className="eyebrow">LIVE PORTFOLIO</p><h1>Project delivery overview</h1><p className="subtle">Data is supplied by the Project API.</p></div><a className="primary-button" href="/projects">View projects</a></section>
        <section className="metrics" aria-label="Portfolio summary"><Metric icon="◫" label="Active projects" value={data.activeProjectCount} detail="Currently in delivery" tone="blue" /><Metric icon="⌖" label="Sites in delivery" value={data.sitesInDelivery} detail="Across active projects" tone="purple" /><Metric icon="✓" label="Pending reviews" value={counts?.REVIEWING ?? 0} detail={counts ? 'Work orders awaiting QC' : 'QC counts unavailable'} tone="amber" /><Metric icon="↗" label="Needs rework" value={counts?.RECTIFYING ?? 0} detail={counts ? 'Returned from QC' : 'QC counts unavailable'} tone="green" /></section>
        <section className="panel project-table" id="projects"><div className="panel-header"><div><h2>Active projects</h2><p>Current data from the Project service</p></div></div>{data.projects.length === 0 ? <div className="empty-list"><strong>No active projects yet</strong><p><a href="/projects/new">Create a project</a>, then set its status to <code>ACTIVE</code>.</p></div> : <div className="project-rows">{data.projects.map((project) => <div className="project-row" key={project.id}><span className="site-mark blue">◫</span><div><strong><a href={`/projects/${project.id}`}>{project.name}</a></strong><p>{project.code}{project.phase ? ` · ${project.phase}` : ''}</p></div><span>{project._count.sites} sites</span><span className="badge green">{project.status}</span></div>)}</div>}</section>
        <section className="panel project-table" id="quality"><div className="panel-header"><div><h2>Quality queue</h2><p>{counts ? `${filterCount('open', counts)} open · ${counts.OVERDUE ?? 0} overdue — soonest due first` : 'Current work orders from the QC service'}</p></div><a href={WORK_ORDERS_PATH}>All work orders<span>→</span></a></div>{!counts ? <div className="empty-list"><strong>Work orders are unavailable</strong><p>The QC service did not answer. Project data above is unaffected.</p></div> : nextUp.length === 0 ? <div className="empty-list"><strong>Nothing open</strong><p>No work orders are waiting. <a href={`${WORK_ORDERS_PATH}/new`}>Raise a work order</a>.</p></div> : <div className="project-rows">{nextUp.map((order) => { const status = STATUS_TEXT[order.status]; const due = dueText(order, now); return <div className="project-row due-row" key={order.id}><span className={`site-mark ${due.tone === 'red' ? 'red' : 'amber'}`}>✓</span><div><strong><a href={workOrderPath(order.id)}>{order.title}</a></strong><p>{order.project.code} · {order.site.siteCode} · {WORK_ORDER_TYPE_LABEL[order.workOrderType]}</p></div><span className={`due ${due.tone}`}>{due.text}</span><span className={`badge ${status.tone}`}>{status.label}</span></div>; })}</div>}</section>
      </div></section>
  </main>;
}
