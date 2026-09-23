import { getCurrentUser, hasPermission } from '../../../../lib/iam-api';
import { getTemplate, getVersion } from '../../../../lib/qc-api';
import { Sidebar, StatePage, TopActions } from '../../../../shell';
import { DraftEditor } from './draft-editor';

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, viewer] = await Promise.all([getTemplate(id), getCurrentUser()]);
  if (detail.state === 'unauthenticated') {
    return <StatePage title="Sign in to edit this template"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (detail.state !== 'ready') {
    return <StatePage title="This template is not available"><p>{detail.message}</p><a href="/quality/templates">Back to templates</a></StatePage>;
  }
  if (!(viewer.state === 'ready' && hasPermission(viewer.data, 'qc_template.update'))) {
    return <StatePage title="Your account cannot edit templates"><p>Ask for a role that grants <code>qc_template.update</code>.</p><a href={`/quality/templates/${id}`}>Back to the template</a></StatePage>;
  }
  const template = detail.data;
  const draft = template.versions.find((version) => version.status === 'DRAFT');
  if (!draft) {
    return <StatePage title="This template has no draft"><p>Start a new version from the template page.</p><a href={`/quality/templates/${id}`}>Back to the template</a></StatePage>;
  }
  const loaded = await getVersion(id, draft.version);
  if (loaded.state !== 'ready') {
    return <StatePage title="The draft could not be loaded"><p>{loaded.state === 'unauthenticated' ? 'Sign in again.' : loaded.message}</p></StatePage>;
  }
  const previous = template.versions.find((version) => version.status === 'PUBLISHED')?.version ?? null;

  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality/templates">Templates</a><b>/</b><a href={`/quality/templates/${id}`}>{template.code}</a><b>/</b><strong>Draft v{draft.version}</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">{template.code} · DRAFT v{draft.version}</p><h1>{template.name}</h1></div>
          </div>
          <DraftEditor
            templateId={id}
            version={draft.version}
            revision={loaded.data.version.revision}
            sections={loaded.data.version.sections}
            previousVersion={previous}
            neverPublished={template.currentVersionId === null}
          />
        </div>
      </section>
    </main>
  );
}
