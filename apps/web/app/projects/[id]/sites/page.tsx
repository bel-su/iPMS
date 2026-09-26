import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { getProject } from '../../../lib/project-api';
import { deleteSiteAction } from '../../actions';
import { RowAction } from '../../../components/forms';
import { CreateSiteForm } from '../../forms';
import { ProjectFrame, projectProblem } from '../frame';

export default async function ProjectSitesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, user] = await Promise.all([getProject(id), getCurrentUser()]);
  if (project.state !== 'ready') return projectProblem(project);

  // For clarity only — the gateway and the service guards are what enforce this.
  const may = (permission: string) => user.state === 'ready' && hasPermission(user.data, permission);
  const data = project.data;

  return (
    <ProjectFrame project={data} active="sites">
      <section className="panel" id="sites">
        <div className="panel-header"><div><h2>Sites</h2><p>{data.sites.length} in this project</p></div>{may('site.import') ? <a className="button" href={`/projects/${data.id}/sites/import`}>Import from Excel</a> : null}</div>
        {data.sites.length === 0
          ? <div className="empty-list"><strong>No sites yet</strong></div>
          : <table className="data-table">
              <thead><tr><th>Code</th><th>Name</th><th>Region</th><th>City</th><th>Coordinates</th><th>Geofence</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {data.sites.map((site) => (
                  <tr key={site.id}>
                    <td><code>{site.siteCode}</code></td>
                    <td>{site.name}</td>
                    <td>{site.region?.name ?? '—'}</td>
                    <td>{site.city ?? '—'}</td>
                    <td>{site.latitude && site.longitude ? `${Number(site.latitude).toFixed(4)}, ${Number(site.longitude).toFixed(4)}` : '—'}</td>
                    <td>{site.geofenceMode === 'CUSTOM' ? `${site.geofenceRadiusM} m` : site.geofenceMode === 'OFF' ? 'No check' : 'Project default'}</td>
                    <td><span className="badge">{site.status}</span></td>
                    <td className="row-actions">
                      {may('site.update')
                        ? <a className="ghost-button" href={`/projects/${data.id}/sites/${site.id}/edit`}>Edit</a>
                        : null}
                      {may('site.delete')
                        ? <RowAction
                            action={deleteSiteAction}
                            hidden={{ projectId: data.id, siteId: site.id }}
                            label="Delete"
                            confirm={`Delete site ${site.siteCode}? This cannot be undone.`}
                          />
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
        {may('site.create') ? <CreateSiteForm projectId={data.id} /> : null}
      </section>
    </ProjectFrame>
  );
}
