const milestones = [
  { name: 'Survey', complete: 92, state: 'On track', tone: 'green' },
  { name: 'Civil works', complete: 71, state: 'At risk', tone: 'amber' },
  { name: 'Installation', complete: 48, state: 'On track', tone: 'green' },
  { name: 'CW RFI', complete: 18, state: 'Upcoming', tone: 'slate' },
];

const attention = [
  { site: 'KOS121', task: 'Antenna & RRU quality checklist', detail: 'Awaiting QC review · 2h ago', status: 'Review', tone: 'blue' },
  { site: 'KOS232', task: 'Civil foundation inspection', detail: 'Critical item needs rectification', status: 'Action needed', tone: 'red' },
  { site: 'BRT084', task: 'Site access survey', detail: 'Due tomorrow', status: 'Due soon', tone: 'amber' },
];

const activity = [
  ['SP', 'Suman Pandey', 'submitted a checklist for', 'KOS121', '12 min ago'],
  ['RK', 'Rita Karki', 'approved CW RFI for', 'BRT071', '48 min ago'],
  ['AS', 'Anil Shrestha', 'assigned a task to', 'KOS232', '1h ago'],
];

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export default function DashboardPage() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="iPMS home"><span>i</span>PMS</a>
        <p className="workspace-label">WORKSPACE</p>
        <nav aria-label="Primary navigation">
          <a className="nav-item active" href="#top"><Icon>▦</Icon>Overview</a>
          <a className="nav-item" href="#projects"><Icon>◫</Icon>Projects</a>
          <a className="nav-item" href="#sites"><Icon>⌖</Icon>Sites</a>
          <a className="nav-item" href="#quality"><Icon>✓</Icon>Quality</a>
          <a className="nav-item" href="#reports"><Icon>▤</Icon>Reports</a>
        </nav>
        <div className="sidebar-bottom">
          <a className="nav-item" href="#settings"><Icon>⚙</Icon>Settings</a>
          <div className="help-card">
            <span className="help-icon">?</span>
            <div><strong>Need help?</strong><span>View documentation</span></div>
          </div>
        </div>
      </aside>

      <section className="content" id="top">
        <header className="topbar">
          <button className="menu-button" aria-label="Open navigation">☰</button>
          <div className="crumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Search">⌕</button>
            <button className="notification" aria-label="Notifications">♧<span /></button>
            <button className="profile" aria-label="Open account menu"><span>KM</span><i>⌄</i></button>
          </div>
        </header>

        <div className="dashboard">
          <section className="welcome">
            <div><p className="eyebrow">FRIDAY, 18 SEPTEMBER</p><h1>Good morning, Kedar</h1><p className="subtle">Here’s how your delivery portfolio is progressing.</p></div>
            <button className="primary-button">+ Create project</button>
          </section>

          <section className="metrics" aria-label="Portfolio summary">
            <article className="metric-card"><div className="metric-heading"><span className="metric-icon blue">◫</span><span>Active projects</span><button aria-label="More active project options">···</button></div><strong>12</strong><p><em className="positive">↑ 2</em> from last month</p></article>
            <article className="metric-card"><div className="metric-heading"><span className="metric-icon purple">⌖</span><span>Sites in delivery</span><button aria-label="More site options">···</button></div><strong>184</strong><p>Across <em>8 regions</em></p></article>
            <article className="metric-card"><div className="metric-heading"><span className="metric-icon amber">✓</span><span>Pending reviews</span><button aria-label="More review options">···</button></div><strong>27</strong><p><em className="warning">8 due today</em></p></article>
            <article className="metric-card"><div className="metric-heading"><span className="metric-icon green">↗</span><span>Portfolio health</span><button aria-label="More health options">···</button></div><strong>78<span>%</span></strong><p><em className="positive">↑ 4.2%</em> since August</p></article>
          </section>

          <section className="main-grid">
            <article className="panel progress-panel" id="projects">
              <div className="panel-header"><div><h2>Ncell Phase 14</h2><p>Milestone progress · 56 sites</p></div><a href="#projects">View project <span>→</span></a></div>
              <div className="project-summary"><div className="ring"><div><strong>64%</strong><span>complete</span></div></div><div className="summary-copy"><strong>36 of 56 sites</strong><span>have met all milestone requirements</span><div className="legend"><i className="dot green-dot" />On track <i className="dot amber-dot" />Needs attention</div></div></div>
              <div className="milestone-list">{milestones.map((milestone) => <div className="milestone" key={milestone.name}><div className="milestone-name"><strong>{milestone.name}</strong><span className={`badge ${milestone.tone}`}>{milestone.state}</span></div><div className="bar"><span style={{ width: `${milestone.complete}%` }} className={milestone.tone} /></div><b>{milestone.complete}%</b></div>)}</div>
            </article>

            <article className="panel attention-panel" id="quality">
              <div className="panel-header"><div><h2>Needs your attention</h2><p>Items that require follow-up</p></div><a href="#quality">See all <span>→</span></a></div>
              <div className="attention-list">{attention.map((item) => <div className="attention-item" key={item.site}><span className={`site-mark ${item.tone}`}>⌖</span><div><strong>{item.site}</strong><p>{item.task}</p><small>{item.detail}</small></div><span className={`status ${item.tone}`}>{item.status}</span></div>)}</div>
            </article>
          </section>

          <section className="bottom-grid">
            <article className="panel activity-panel"><div className="panel-header"><div><h2>Recent activity</h2><p>Across your projects</p></div><a href="#reports">View audit trail <span>→</span></a></div><div className="activity-list">{activity.map(([initials, name, verb, site, time]) => <div className="activity" key={`${name}-${site}`}><span className="avatar">{initials}</span><p><strong>{name}</strong> {verb} <a href="#sites">{site}</a><small>{time}</small></p></div>)}</div></article>
            <article className="panel region-panel" id="sites"><div className="panel-header"><div><h2>Regional delivery</h2><p>Site completion by region</p></div><button className="select-button">This month ⌄</button></div><div className="region-list"><div><span>Koshi</span><div className="bar"><i style={{ width: '82%' }} /></div><b>82%</b></div><div><span>Bagmati</span><div className="bar"><i style={{ width: '67%' }} /></div><b>67%</b></div><div><span>Lumbini</span><div className="bar"><i style={{ width: '54%' }} /></div><b>54%</b></div></div></article>
          </section>
        </div>
      </section>
    </main>
  );
}
