'use client';
import { useActionState } from 'react';
import {
  archiveProjectAction, createMilestoneAction, createProjectAction, createSiteAction,
  createTaskTypeAction, deleteProjectAction, updateProjectAction, updateSiteAction,
} from './actions';
import { EMPTY, type FormState } from '../lib/form-state';
import { FormError, SubmitButton } from '../components/forms';
import type { ProjectDetail } from '../lib/project-api';

export function CreateProjectForm() {
  const [state, action] = useActionState(createProjectAction, EMPTY);
  return (
    <form action={action} className="panel-form">
      <div className="form-grid">
        <label className="field">Code<input name="code" required pattern="[A-Z0-9_\-]+" maxLength={50} /><span className="hint">Upper case, digits, dash or underscore.</span></label>
        <label className="field">Name<input name="name" required maxLength={200} /></label>
        <label className="field">Client<input name="clientName" maxLength={200} /></label>
        <label className="field">Phase<input name="phase" maxLength={100} /></label>
        <label className="field">Start date<input name="startDate" type="date" /></label>
        <label className="field">Target date<input name="targetDate" type="date" /></label>
        <label className="field">Default geofence
          <select name="defaultGeofenceRadiusM" defaultValue="500">
            <option value="500">500 m</option>
            <option value="250">250 m</option>
            <option value="1000">1 km</option>
            <option value="off">No proximity checks on this project</option>
          </select>
          <span className="hint">Sites inherit this. Turn it off for linear works such as fiber runs.</span>
        </label>
      </div>
      <FormError state={state} />
      <p className="form-note">New projects start as <code>DRAFT</code>.</p>
      <SubmitButton>Create project</SubmitButton>
    </form>
  );
}


export function CreateSiteForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(createSiteAction, EMPTY);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">Site code<input name="siteCode" required pattern="[A-Z0-9_\-]+" maxLength={50} /></label>
      <label className="field">Name<input name="name" required maxLength={200} /></label>
      <label className="field">Region<input name="regionName" maxLength={150} /></label>
      <label className="field">City<input name="city" maxLength={100} /></label>
      <label className="field">Latitude<input name="latitude" type="number" step="any" min={-90} max={90} /></label>
      <label className="field">Longitude<input name="longitude" type="number" step="any" min={-180} max={180} /></label>
      <label className="field">Geofence
        <select name="geofenceMode" defaultValue="INHERIT">
          <option value="INHERIT">Use the project default</option>
          <option value="CUSTOM">Custom radius</option>
          <option value="OFF">No proximity check</option>
        </select>
      </label>
      <label className="field">Radius (m)<input name="geofenceRadiusM" type="number" min={1} max={100000} /></label>
      <SubmitButton>Add site</SubmitButton>
      <FormError state={state} />
    </form>
  );
}

export function CreateTaskTypeForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(createTaskTypeAction, EMPTY);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">Code<input name="code" required pattern="[A-Z0-9_\-]+" maxLength={50} /></label>
      <label className="field">Name<input name="name" required maxLength={200} /></label>
      <label className="field">Category<input name="category" required maxLength={100} /></label>
      <SubmitButton>Add task type</SubmitButton>
      <FormError state={state} />
    </form>
  );
}

export function CreateMilestoneForm({
  projectId, taskTypes,
}: {
  projectId: string;
  taskTypes: { id: string; code: string; name: string }[];
}) {
  const [state, action] = useActionState(createMilestoneAction, EMPTY);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">Code<input name="code" required pattern="[A-Z0-9_\-]+" maxLength={50} /></label>
      <label className="field">Name<input name="name" required maxLength={200} /></label>
      <label className="field">Kind
        <select name="kind" defaultValue="PROJECT"><option value="PROJECT">Project</option><option value="CONTRACT">Contract</option></select>
      </label>
      <label className="field">Sequence<input name="sequence" type="number" min={0} defaultValue={0} required /></label>
      <label className="field">Requires
        <select name="taskTypeIds" multiple size={3}>
          {taskTypes.map((type) => <option key={type.id} value={type.id}>{type.code}</option>)}
        </select>
        <span className="hint">Leave empty for none.</span>
      </label>
      <SubmitButton>Add milestone</SubmitButton>
      <FormError state={state} />
    </form>
  );
}

const STATUSES = ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;

export function EditProjectForm({ project }: { project: ProjectDetail }) {
  const [state, action] = useActionState(updateProjectAction, EMPTY);
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="projectId" value={project.id} />
      <div className="form-grid">
        <label className="field">Code<input value={project.code} readOnly disabled /><span className="hint">Fixed at creation.</span></label>
        <label className="field">Name<input name="name" defaultValue={project.name} required maxLength={200} /></label>
        <label className="field">Client<input name="clientName" defaultValue={project.clientName ?? ''} maxLength={200} /></label>
        <label className="field">Phase<input name="phase" defaultValue={project.phase ?? ''} maxLength={100} /></label>
        <label className="field">Status
          <select name="status" defaultValue={project.status}>
            {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
      </div>
      <FormError state={state} />
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}

export function ArchiveForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(archiveProjectAction, EMPTY);
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="projectId" value={projectId} />
      <SubmitButton className="ghost-button">Archive this project</SubmitButton>
      <FormError state={state} />
    </form>
  );
}

export function DeleteProjectForm({ projectId, code }: { projectId: string; code: string }) {
  const [state, action] = useActionState(deleteProjectAction, EMPTY);
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="code" value={code} />
      <label className="field">
        Type <code>{code}</code> to confirm
        <input name="confirmCode" autoComplete="off" required />
      </label>
      <FormError state={state} />
      <SubmitButton className="danger-button">Delete this project</SubmitButton>
    </form>
  );
}

const SITE_STATUSES = ['PLANNED', 'IN_DELIVERY', 'COMPLETED', 'BLOCKED'] as const;

/**
 * The site code is shown but not editable: the Excel import matches an
 * existing site by project and site code, so a site renamed here would be
 * created afresh by the next import instead of updated, and its history would
 * silently split in two.
 */
export function EditSiteForm({
  projectId, site, projectDefaultRadiusM,
}: {
  projectId: string;
  site: ProjectDetail['sites'][number];
  projectDefaultRadiusM: number | null;
}) {
  const [state, action] = useActionState(updateSiteAction, EMPTY);
  const inherited = projectDefaultRadiusM === null
    ? 'Use the project default (no check)'
    : `Use the project default (${projectDefaultRadiusM} m)`;
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="siteId" value={site.id} />
      <div className="form-grid">
        <label className="field">Site code<input value={site.siteCode} readOnly disabled /><span className="hint">Fixed at creation.</span></label>
        <label className="field">Name<input name="name" defaultValue={site.name} required maxLength={200} /></label>
        <label className="field">Region<input name="regionName" defaultValue={site.region?.name ?? ''} maxLength={150} /></label>
        <label className="field">City<input name="city" defaultValue={site.city ?? ''} maxLength={100} /></label>
        <label className="field">Latitude<input name="latitude" type="number" step="any" min={-90} max={90} defaultValue={site.latitude ?? ''} /></label>
        <label className="field">Longitude<input name="longitude" type="number" step="any" min={-180} max={180} defaultValue={site.longitude ?? ''} /></label>
        <label className="field">Geofence
          <select name="geofenceMode" defaultValue={site.geofenceMode}>
            <option value="INHERIT">{inherited}</option>
            <option value="CUSTOM">Custom radius</option>
            <option value="OFF">No proximity check</option>
          </select>
        </label>
        <label className="field">Radius (m)<input name="geofenceRadiusM" type="number" min={1} max={100000} defaultValue={site.geofenceRadiusM ?? ''} /><span className="hint">Used only with a custom radius.</span></label>
        <label className="field">Status
          <select name="status" defaultValue={site.status}>
            {SITE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
      </div>
      <p className="form-note">Emptying a field clears it. Latitude and longitude go together: clear both, or neither.</p>
      <FormError state={state} />
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}
