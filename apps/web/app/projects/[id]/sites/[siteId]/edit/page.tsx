import { getCurrentUser, hasPermission } from '../../../../../lib/iam-api';
import { getProject } from '../../../../../lib/project-api';
import { EditSiteForm } from '../../../../forms';
import { Sidebar, StatePage, TopActions } from '../../../../../shell';

export default async function EditSitePage({ params }: { params: Promise<{ id: string; siteId: string }> }) {
  const { id, siteId } = await params;
  const [project, user] = await Promise.all([getProject(id), getCurrentUser()]);

  if (project.state === 'unauthenticated') {
    return <StatePage title="Sign in to edit this site"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (project.state !== 'ready') {
    return <StatePage title="Cannot edit this site"><p>{project.message}</p><p className="subtle"><a href="/projects">Back to projects</a></p></StatePage>;
  }

  const data = project.data;
  // There is no GET for a single site. Reading the project instead also hands
  // us its default radius, which is what lets the geofence control say what
  // inheriting actually means here.
  const site = data.sites.find((candidate) => candidate.id === siteId);
  if (!site) {
    return (
      <StatePage title="Cannot edit this site">
        <p>This project has no such site.</p>
        <p className="subtle"><a href={`/projects/${data.id}`}>Back to the project</a></p>
      </StatePage>
    );
  }
  // The row's Edit link is hidden without this permission; checked again here
  // because a bookmarked URL would otherwise show a form that cannot save.
  if (!(user.state === 'ready' && hasPermission(user.data, 'site.update'))) {
    return (
      <StatePage title="You cannot edit sites">
        <p className="subtle"><a href={`/projects/${data.id}`}>Back to the project</a></p>
      </StatePage>
    );
  }

  return (
    <main className="app-shell">
      <Sidebar active="projects" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs">
            <a href="/projects">Projects</a><b>/</b>
            <a href={`/projects/${data.id}`}>{data.code}</a><b>/</b>
            <strong>{site.siteCode}</strong>
          </div>
          <TopActions />
        </header>
        <div className="dashboard">
          <section className="panel">
            <div className="panel-header"><div><h2>Edit site</h2><p>{site.name}</p></div></div>
            <EditSiteForm projectId={data.id} site={site} projectDefaultRadiusM={data.defaultGeofenceRadiusM} />
          </section>
        </div>
      </section>
    </main>
  );
}
