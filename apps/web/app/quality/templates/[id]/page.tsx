import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { getTemplate, getVersion } from '../../../lib/qc-api';
import { RowAction } from '../../../projects/forms';
import { Sidebar, StatePage, TopActions } from '../../../shell';
import { disableTemplateAction, enableTemplateAction, startDraftAction } from '../actions';
import { RenameTemplateForm } from '../forms';
import { CATEGORY_LABELS, formatDate } from '../labels';
import { VersionView } from '../version-view';

const STATUS_BADGE = { DRAFT: 'amber', PUBLISHED: 'green', RETIRED: 'slate' } as const;

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, viewer] = await Promise.all([getTemplate(id), getCurrentUser()]);
  if (detail.state === 'unauthenticated') {
    return <StatePage title="Sign in to view this template"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (detail.state !== 'ready') {
    return <StatePage title="This template is not available"><p>{detail.message}</p><a href="/quality/templates">Back to templates</a></StatePage>;
  }
  const template = detail.data;
  const published = template.versions.find((version) => version.status === 'PUBLISHED');
  const draft = template.versions.find((version) => version.status === 'DRAFT');
  const current = published ? await getVersion(id, published.version) : null;
  const may = (permission: string): boolean => viewer.state === 'ready' && hasPermission(viewer.data, permission);
  const hidden = { templateId: id };

  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality/templates">Templates</a><b>/</b><strong>{template.code}</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">{CATEGORY_LABELS[template.category].toUpperCase()} TEMPLATE · {template.code}</p>
              <h1>{template.name}</h1>
              <div className="badges">
                {template.disabledAt ? <span className="badge red">Disabled</span> : published ? <span className="badge green">Enabled · v{published.version}</span> : null}
                {draft ? <span className="badge amber">Draft v{draft.version}</span> : null}
              </div>
            </div>
            <div className="toolbar-actions">
              {draft && may('qc_template.update') ? <a className="primary-button" href={`/quality/templates/${id}/draft`}>Continue draft v{draft.version}</a> : null}
              {!draft && published && may('qc_template.update') ? <RowAction action={startDraftAction} hidden={hidden} label="New version" className="primary-button" /> : null}
              {published ? <a className="ghost-button" href={`/api/qc/templates/${id}/versions/${published.version}/export`}>Export v{published.version}</a> : null}
              {may('qc_template.update') ? <RenameTemplateForm templateId={id} name={template.name} category={template.category} /> : null}
              {may('qc_template.publish') && published && !template.disabledAt ? (
                <RowAction action={disableTemplateAction} hidden={hidden} label="Disable" confirm="Disabled templates refuse new submissions. Existing submissions stay reviewable. Disable?" />
              ) : null}
              {may('qc_template.publish') && template.disabledAt ? <RowAction action={enableTemplateAction} hidden={hidden} label="Enable" className="ghost-button" /> : null}
            </div>
          </div>

          <section className="panel">
            <div className="panel-header"><div><h2>{published ? `Current version · v${published.version}` : 'Not published yet'}</h2>
              <p>{published ? `Published ${formatDate(published.publishedAt)}. Every project uses this version.` : 'Publish the draft to make this template available to projects.'}</p></div></div>
            {current?.state === 'ready' ? <VersionView sections={current.data.version.sections} /> : null}
          </section>

          <section className="panel">
            <div className="panel-header"><div><h2>Version history</h2></div></div>
            <table className="data-table">
              <thead><tr><th>Version</th><th>Status</th><th>Source</th><th>Published</th><th>Retired</th><th /></tr></thead>
              <tbody>
                {template.versions.map((version) => (
                  <tr key={version.id}>
                    <td>v{version.version}</td>
                    <td><span className={`badge ${STATUS_BADGE[version.status]}`}>{version.status.toLowerCase()}</span></td>
                    <td>{version.source === 'EXCEL_IMPORT' ? 'Excel import' : 'Web editor'}</td>
                    <td>{formatDate(version.publishedAt)}</td>
                    <td>{formatDate(version.retiredAt)}</td>
                    <td className="row-actions">
                      {version.status === 'DRAFT'
                        ? <a href={`/quality/templates/${id}/draft`}>Edit</a>
                        : <a href={`/quality/templates/${id}/versions/${version.version}`}>View</a>}
                      <a href={`/api/qc/templates/${id}/versions/${version.version}/export`}>Export</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </section>
    </main>
  );
}
