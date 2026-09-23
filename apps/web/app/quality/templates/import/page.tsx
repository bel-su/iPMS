import { Sidebar, TopActions } from '../../../shell';
import { TemplateImportForm } from './import-form';

export default function TemplateImportPage() {
  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality/templates">Templates</a><b>/</b><strong>Import from Excel</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Import a checklist from Excel</h2>
                <p>A new Code creates a new template. An existing Code becomes that template&apos;s next draft. Nothing is saved until you confirm the preview.</p>
              </div>
              <a className="ghost-button" href="/api/qc/templates/blank">Download blank workbook</a>
            </div>
            <TemplateImportForm />
          </section>
        </div>
      </section>
    </main>
  );
}
