import { Sidebar, TopActions } from '../../../shell';
import { CreateTemplateForm } from '../forms';

export default function NewTemplatePage() {
  return (
    <main className="app-shell">
      <Sidebar active="quality" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality/templates">Templates</a><b>/</b><strong>New template</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header"><div><h2>New checklist template</h2><p>Templates are shared by every project. You will add sections and items in the draft editor next.</p></div></div>
            <CreateTemplateForm />
          </section>
        </div>
      </section>
    </main>
  );
}
