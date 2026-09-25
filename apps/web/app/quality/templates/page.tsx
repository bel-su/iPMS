import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { listTemplates, type TemplateCategory, type TemplateTab } from '../../lib/qc-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { CATEGORIES, CATEGORY_LABELS, TABS, formatDate } from './labels';

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ tab?: string; category?: string; q?: string }> }) {
  const params = await searchParams;
  const tab: TemplateTab = TABS.find((entry) => entry.key === params.tab)?.key ?? 'enabled';
  const category: TemplateCategory | undefined = CATEGORIES.find((entry) => entry === params.category);
  const q = params.q?.trim() || undefined;

  const [templates, viewer] = await Promise.all([listTemplates({ tab, category, q }), getCurrentUser()]);
  if (templates.state === 'unauthenticated') {
    return <StatePage title="Sign in to view checklist templates"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (templates.state === 'forbidden') {
    return <StatePage title="Your account cannot view checklist templates"><p>{templates.message}</p></StatePage>;
  }
  if (templates.state === 'unavailable') {
    return (
      <StatePage title="Checklist templates are not available">
        <p>{templates.message}</p>
        {templates.correlationId ? <p className="subtle">Correlation ID: <code>{templates.correlationId}</code></p> : null}
      </StatePage>
    );
  }

  const may = (permission: string): boolean => viewer.state === 'ready' && hasPermission(viewer.data, permission);
  const tabHref = (target: TemplateTab): string => {
    const query = new URLSearchParams({ tab: target });
    if (category) query.set('category', category);
    if (q) query.set('q', q);
    return `/quality/templates?${query.toString()}`;
  };

  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><span>Quality &amp; EHS</span><b>/</b><strong>Templates</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">QUALITY &amp; EHS</p><h1>Checklist templates</h1></div>
            <div className="toolbar-actions">
              <a className="ghost-button" href="/api/qc/templates/blank">Download blank workbook</a>
              {may('qc_template.import') ? <a className="ghost-button" href="/quality/templates/import">Import from Excel</a> : null}
              {may('qc_template.create') ? <a className="primary-button" href="/quality/templates/new">New template</a> : null}
            </div>
          </div>
          <section className="panel">
            <nav className="tab-row" aria-label="Template status">
              {TABS.map((entry) => (
                <a key={entry.key} href={tabHref(entry.key)} aria-current={entry.key === tab ? 'true' : undefined}>{entry.label}</a>
              ))}
            </nav>
            <form className="inline-form" method="get" action="/quality/templates">
              <input type="hidden" name="tab" value={tab} />
              <input name="q" defaultValue={q ?? ''} placeholder="Search code or name" aria-label="Search code or name" maxLength={100} />
              <select name="category" defaultValue={category ?? ''} aria-label="Category">
                <option value="">All categories</option>
                {CATEGORIES.map((entry) => <option key={entry} value={entry}>{CATEGORY_LABELS[entry]}</option>)}
              </select>
              <button className="ghost-button" type="submit">Filter</button>
            </form>
            {templates.data.length === 0 ? (
              <p className="empty-list">No templates here yet.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>No.</th><th>Template Name</th><th>Template No.</th><th>Template Type</th>
                    {tab === 'draft' ? <><th>Draft</th><th>Updated On</th></> : <><th>Version</th><th>Items</th><th>Updated On</th></>}
                  </tr>
                </thead>
                <tbody>
                  {templates.data.map((template, index) => (
                    <tr key={template.id}>
                      <td>{index + 1}</td>
                      <td><a className="link" href={`/quality/templates/${template.id}`}><strong>{template.name}</strong></a></td>
                      <td><code>{template.code}</code></td>
                      <td>{CATEGORY_LABELS[template.category]}</td>
                      {tab === 'draft' ? (
                        <>
                          <td><a href={`/quality/templates/${template.id}/draft`}>v{template.draft?.version}</a>{template.draft?.source === 'EXCEL_IMPORT' ? <span className="badge slate">Excel</span> : null}</td>
                          <td>{formatDate(template.draft?.updatedAt ?? null)}</td>
                        </>
                      ) : (
                        <>
                          <td>{template.current ? `v${template.current.version}` : '—'}{template.draft ? <span className="badge amber">Draft v{template.draft.version}</span> : null}</td>
                          <td>{template.current ? <>{template.current.itemCount}{template.current.criticalCount ? <span className="subtle"> ({template.current.criticalCount} critical)</span> : null}</> : '—'}</td>
                          <td>{formatDate(template.current?.publishedAt ?? null)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
