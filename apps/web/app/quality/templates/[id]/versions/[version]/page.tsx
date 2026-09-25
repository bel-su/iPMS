import { getVersion } from '../../../../../lib/qc-api';
import { Sidebar, StatePage, TopActions } from '../../../../../shell';
import { formatDate } from '../../../labels';
import { VersionView } from '../../../version-view';

export default async function VersionPage({ params }: { params: Promise<{ id: string; version: string }> }) {
  const { id, version } = await params;
  const number = Number(version);
  if (!Number.isInteger(number) || number < 1) return <StatePage title="Unknown version"><a href={`/quality/templates/${id}`}>Back to the template</a></StatePage>;
  const result = await getVersion(id, number);
  if (result.state === 'unauthenticated') {
    return <StatePage title="Sign in to view this template"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (result.state !== 'ready') {
    return <StatePage title="This version is not available"><p>{result.message}</p><a href={`/quality/templates/${id}`}>Back to the template</a></StatePage>;
  }
  const { template, version: detail } = result.data;
  return (
    <main className="app-shell">
      <Sidebar active="checklists" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality">Quality &amp; EHS</a><b>/</b><a href="/quality/templates">Checklist library</a><b>/</b><a href={`/quality/templates/${id}`}>{template.code}</a><b>/</b><strong>v{detail.version}</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">{template.code} · VERSION {detail.version} · {detail.status}</p>
              <h1>{template.name}</h1>
              <p className="subtle">Published {formatDate(detail.publishedAt)}{detail.retiredAt ? `, retired ${formatDate(detail.retiredAt)}` : ''}.</p>
            </div>
            <a className="ghost-button" href={`/api/qc/templates/${id}/versions/${detail.version}/export`}>Export</a>
          </div>
          <section className="panel"><VersionView sections={detail.sections} /></section>
        </div>
      </section>
    </main>
  );
}
