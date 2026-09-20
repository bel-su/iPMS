import { CreateProjectForm } from '../forms';

export default function NewProjectPage() {
  return (
    <main className="app-shell">
      <section className="content">
        <header className="topbar"><div className="crumbs"><a href="/projects">Projects</a><b>/</b><strong>New</strong></div></header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header"><div><h2>New project</h2><p>A code cannot be changed after creation.</p></div></div>
            <CreateProjectForm />
          </section>
        </div>
      </section>
    </main>
  );
}
