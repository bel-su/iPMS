'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  archiveProjectAction, createMilestoneAction, createProjectAction, createSiteAction, createTaskAction,
  createTaskTypeAction, deleteProjectAction, updateProjectAction,
} from './actions';
import { EMPTY, type FormState } from './form-state';
import type { ProjectDetail } from '../lib/project-api';

/** Disables itself while the action runs, so a slow API cannot be double-submitted. */
export function SubmitButton({ children, className = 'primary-button' }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending}>{pending ? 'Working…' : children}</button>;
}

export function FormError({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <p className="form-error" role="alert">
      {state.error}
      {state.correlationId ? <> <span className="subtle">({state.correlationId})</span></> : null}
    </p>
  );
}

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
      </div>
      <FormError state={state} />
      <p className="form-note">New projects start as <code>DRAFT</code>.</p>
      <SubmitButton>Create project</SubmitButton>
    </form>
  );
}

/**
 * A one-button form for a destructive row action.
 *
 * A form rather than a link because a GET must not delete anything, and a
 * confirm because the row itself offers no other chance to stop. The action is
 * passed in by the page: a Server Action reference crosses this boundary
 * fine, and it keeps this component ignorant of what it is deleting.
 */
export function RowAction({
  action, hidden, label, confirm, className = 'danger-button',
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  label: string;
  confirm?: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY);
  return (
    <form action={formAction} onSubmit={(event) => { if (confirm && !window.confirm(confirm)) event.preventDefault(); }}>
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <SubmitButton className={className}>{label}</SubmitButton>
      <FormError state={state} />
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

export function CreateTaskForm({
  projectId, sites, taskTypes,
}: {
  projectId: string;
  sites: { id: string; siteCode: string; name: string }[];
  taskTypes: { id: string; code: string; name: string; isActive: boolean }[];
}) {
  const [state, action] = useActionState(createTaskAction, EMPTY);
  const active = taskTypes.filter((type) => type.isActive);
  if (sites.length === 0 || active.length === 0) {
    return <p className="form-note">Add a site and an active task type before creating tasks.</p>;
  }
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="field">Site
        <select name="siteId" required defaultValue="">
          <option value="" disabled>Choose a site</option>
          {sites.map((site) => <option key={site.id} value={site.id}>{site.siteCode} — {site.name}</option>)}
        </select>
      </label>
      <label className="field">Task type
        <select name="taskTypeId" required defaultValue="">
          <option value="" disabled>Choose a task type</option>
          {active.map((type) => <option key={type.id} value={type.id}>{type.code} — {type.name}</option>)}
        </select>
      </label>
      <label className="field">Title<input name="title" required maxLength={250} /></label>
      <SubmitButton>Add task</SubmitButton>
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
