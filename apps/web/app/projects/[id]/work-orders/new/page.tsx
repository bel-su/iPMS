import { getCurrentUser, hasPermission } from '../../../../lib/iam-api';
import { getProject } from '../../../../lib/project-api';
import { listTemplates } from '../../../../lib/qc-api';
import { listUserDirectory } from '../../../../lib/user-api';
import { StatePage } from '../../../../shell';
import { ProjectFrame, projectProblem } from '../../frame';
import { personLabel } from '../labels';
import { WorkOrderCreator, type CreatorTemplate } from './work-order-creator';

export default async function NewWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, user, templates, people] = await Promise.all([
    getProject(id), getCurrentUser(), listTemplates({ tab: 'enabled' }), listUserDirectory(),
  ]);
  if (project.state !== 'ready') return projectProblem(project);
  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  if (!may('task.create') || !may('task.assign')) {
    return (
      <StatePage title="Your account cannot create work orders">
        <p>Creating a work order needs both task.create and task.assign.</p>
        <p className="subtle"><a href={`/projects/${id}/work-orders`}>Back to work orders</a></p>
      </StatePage>
    );
  }

  // Only enabled, published templates can be used; the list's 'enabled' tab is exactly that set.
  const usable: CreatorTemplate[] = templates.state === 'ready'
    ? templates.data.flatMap((t) => (t.current ? [{ id: t.id, code: t.code, name: t.name, category: t.category, version: t.current.version, itemCount: t.current.itemCount }] : []))
    : [];
  const data = project.data;

  return (
    <ProjectFrame project={data} active="work-orders">
      {templates.state !== 'ready'
        ? <p className="banner warning" role="alert">Checklist templates could not be loaded: {templates.state === 'unauthenticated' ? 'sign in again.' : templates.message}</p>
        : null}
      {people.state !== 'ready'
        ? <p className="banner warning" role="alert">The list of people could not be loaded: {people.state === 'unauthenticated' ? 'sign in again.' : people.message}</p>
        : null}
      <WorkOrderCreator
        project={{ id: data.id, code: data.code, name: data.name }}
        sites={data.sites.map((site) => ({ id: site.id, siteCode: site.siteCode, name: site.name, city: site.city, area: site.area }))}
        templates={usable}
        people={people.state === 'ready' ? people.data.filter((p) => p.isActive).map((p) => ({ id: p.id, label: personLabel(p) })) : []}
      />
    </ProjectFrame>
  );
}
