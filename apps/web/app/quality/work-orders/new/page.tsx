import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { listProjects } from '../../../lib/project-api';
import { listTemplates } from '../../../lib/qc-api';
import { listUserDirectory } from '../../../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../../../shell';
import { loadProjectAction } from '../actions';
import { WORK_ORDERS_PATH } from '../labels';
import { Composer, type ComposerTemplate } from './composer';

export default async function NewWorkOrdersPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const [user, projects, templates, people] = await Promise.all([getCurrentUser(), listProjects(), listTemplates({ tab: 'enabled' }), listUserDirectory()]);
  if (user.state === 'unauthenticated') return <StatePage title="Sign in to assign work"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  if (!may('task.create') || !may('task.assign')) {
    return (
      <StatePage title="Your account cannot assign work orders">
        <p>Assigning a checklist needs both task.create and task.assign.</p>
        <p className="subtle"><a href={WORK_ORDERS_PATH}>Back to work orders</a></p>
      </StatePage>
    );
  }
  const choices = projects.state === 'ready'
    ? projects.data.filter((p) => p.status !== 'CANCELLED' && p.status !== 'COMPLETED').map((p) => ({ id: p.id, code: p.code, name: p.name }))
    : [];
  const initialProject = choices.find((p) => p.id === projectId)?.id ?? (choices.length === 1 ? choices[0]!.id : '');
  const initialContext = initialProject ? await loadProjectAction(initialProject) : null;
  // Only enabled, published templates can be used; the list's 'enabled' tab is exactly that set.
  const usable: ComposerTemplate[] = templates.state === 'ready'
    ? templates.data.flatMap((t) => (t.current ? [{
        id: t.id, code: t.code, name: t.name, category: t.category, version: t.current.version,
        itemCount: t.current.itemCount, criticalCount: t.current.criticalCount, sectionCount: t.current.sectionCount,
      }] : []))
    : [];

  return (
    <main className="app-shell">
      <Sidebar active="work-orders" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality">Quality &amp; EHS</a><b>/</b><a href={WORK_ORDERS_PATH}>Work orders</a><b>/</b><strong>Assign a checklist</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar"><div><p className="eyebrow">QUALITY &amp; EHS</p><h1>Assign a checklist</h1><p className="subtle">One checklist, one responsible person, as many sites as you choose — each site gets its own work order.</p></div></div>
          {templates.state !== 'ready' ? <p className="banner warning" role="alert">Checklists could not be loaded: {templates.state === 'unauthenticated' ? 'sign in again.' : templates.message}</p> : null}
          {people.state !== 'ready' ? <p className="banner warning" role="alert">The list of people could not be loaded: {people.state === 'unauthenticated' ? 'sign in again.' : people.message}</p> : null}
          <Composer
            projects={choices}
            templates={usable}
            directory={people.state === 'ready' ? people.data : []}
            initialProjectId={initialProject}
            initialContext={initialContext}
          />
        </div>
      </section>
    </main>
  );
}
