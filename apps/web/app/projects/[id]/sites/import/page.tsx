import { Sidebar, TopActions } from '../../../../shell';
import { SiteImportForm } from './import-form';

export default async function SiteImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="app-shell">
      <Sidebar active="projects" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs">
            <a href="/projects">Projects</a><b>/</b>
            <a href={`/projects/${id}`}>Project</a><b>/</b>
            <a href={`/projects/${id}/sites`}>Sites</a><b>/</b>
            <strong>Import sites</strong>
          </div>
          <TopActions />
        </header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Import sites</h2>
                <p>Upload a spreadsheet to create or update many sites at once.</p>
              </div>
              <a className="button" href={`/api/projects/${id}/sites/import/template`}>Download template</a>
            </div>
            <p className="form-note">
              <code>site_code</code> and <code>name</code> are required. A column you leave out of the
              sheet is never written, so a file of just <code>site_code</code>, <code>latitude</code> and{' '}
              <code>longitude</code> corrects coordinates and touches nothing else. A blank cell in a
              column you <em>do</em> include clears that field. Nothing is saved until you confirm the preview.
            </p>
            <SiteImportForm projectId={id} />
          </section>
        </div>
      </section>
    </main>
  );
}
