'use client';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import type { ChecklistItem } from '../../../../lib/qc-api';
import { RESPONSE_TYPE_LABELS, photoLabel } from '../../../../quality/templates/labels';
import { FormError } from '../../../forms';
import { createWorkOrderAction, loadChecklistAction, type ChecklistPreview, type WorkOrderFormState } from '../actions';
import {
  WORK_ORDER_TYPES, endOfDayIso, formatDateTime, templatesFor, workOrderTitle,
  type TemplateCategory, type WorkOrderType,
} from '../labels';

export interface CreatorTemplate { id: string; code: string; name: string; category: TemplateCategory; version: number; itemCount: number }
interface CreatorSite { id: string; siteCode: string; name: string; city: string | null; area: string | null }
interface CreatorPerson { id: string; label: string }

const INITIAL: WorkOrderFormState = {};

function AssignButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className="assign-button" type="submit" disabled={disabled || pending}>{pending ? 'Assigning…' : 'Assign Work Orders'}</button>;
}

/**
 * The create screen: the work order's fields on the left and, on the right,
 * the checklist exactly as the responsible person will receive it.
 *
 * With continuous creation on, a successful submit keeps the type, template
 * and date and clears the site and person, so a batch of sites can be assigned
 * the same checklist one after another.
 */
export function WorkOrderCreator({ project, sites, templates, people }: {
  project: { id: string; code: string; name: string };
  sites: CreatorSite[];
  templates: CreatorTemplate[];
  people: CreatorPerson[];
}) {
  const [state, action] = useActionState(createWorkOrderAction, INITIAL);
  const [type, setType] = useState<WorkOrderType>('QUALITY_SELF_CHECK');
  const [templateId, setTemplateId] = useState('');
  const [date, setDate] = useState('');
  const [siteId, setSiteId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [addition, setAddition] = useState('');
  const [continuous, setContinuous] = useState(true);

  const offered = templatesFor(type, templates);
  const template = offered.find((t) => t.id === templateId);
  const site = sites.find((s) => s.id === siteId);
  const person = people.find((p) => p.id === assigneeId);
  const typeInfo = WORK_ORDER_TYPES.find((entry) => entry.type === type) ?? WORK_ORDER_TYPES[0]!;
  const title = workOrderTitle(type, site?.name, addition);
  const planned = endOfDayIso(date);

  // A Quality template stays selected only while the type is still a Quality check.
  const chooseType = (next: WorkOrderType) => {
    setType(next);
    if (!templatesFor(next, templates).some((t) => t.id === templateId)) setTemplateId('');
  };

  // Clear the per-site fields after each successful continuous submit.
  const created = state.created?.id;
  useEffect(() => {
    if (!created) return;
    setSiteId('');
    setAssigneeId('');
    setAddition('');
  }, [created]);

  const preview = useChecklist(template);

  return (
    <form action={action} className="wo-screen">
      <input type="hidden" name="projectId" value={project.id} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="plannedCompletionAt" value={planned ?? ''} />

      <div className="wo-bar">
        <a className="ghost-button" href={`/projects/${project.id}/work-orders`}>← Go Back</a>
        <label className="check">
          <input type="checkbox" name="continuous" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} />
          Continuous Creation
        </label>
        <AssignButton disabled={!template || !site || !person || !planned || !title} />
      </div>

      {state.created
        ? <p className="banner success" role="status">Assigned “{state.created.title}”. Choose the next site, or <a href={`/projects/${project.id}/work-orders`}>see all work orders</a>.</p>
        : null}
      <FormError state={state} />

      <div className="wo-layout">
        <section className="panel wo-form" aria-labelledby="wo-create">
          <h2 id="wo-create" className="pane-title">Create</h2>
          <div className="wo-fields">
            <span className="wo-label required" id="wo-type">Work Order Type</span>
            <div className="radio-grid" role="radiogroup" aria-labelledby="wo-type">
              {WORK_ORDER_TYPES.map((entry) => (
                <label key={entry.type}>
                  <input type="radio" name="workOrderType" value={entry.type} checked={type === entry.type} onChange={() => chooseType(entry.type)} />
                  {entry.label}
                </label>
              ))}
            </div>

            <label className="wo-label required" htmlFor="wo-template">Template Name</label>
            <div>
              <select id="wo-template" name="templateId" value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
                <option value="">Select</option>
                {offered.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code} v{t.version})</option>)}
              </select>
              {offered.length === 0 ? <span className="hint">No enabled {typeInfo.category === 'EHS' ? 'EHS' : 'Quality'} templates are published yet.</span> : null}
            </div>

            <label className="wo-label required" htmlFor="wo-date">Planned Completion Date</label>
            <input id="wo-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

            <label className="wo-label required" htmlFor="wo-site">Site</label>
            <div>
              <select id="wo-site" name="siteId" value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
                <option value="">Select Site Name-Site Code</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}-{s.siteCode}</option>)}
              </select>
              {sites.length === 0 ? <span className="hint">This project has no sites you can see.</span> : null}
            </div>

            <label className="wo-label required" htmlFor="wo-person">Responsible person{typeInfo.selfCheck ? ' for the self-check' : ''}</label>
            <select id="wo-person" name="assigneeId" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} required>
              <option value="">Select</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          <div className="wo-name">
            <strong>{title || 'The work order name is generated once a site is chosen'}</strong>
            <input
              value={addition} onChange={(e) => setAddition(e.target.value)} maxLength={120}
              placeholder="Click to add text" aria-label="Text to add after the generated work order name"
              disabled={!site}
            />
          </div>
        </section>

        <section className="panel wo-preview" aria-labelledby="wo-preview-title">
          <h2 id="wo-preview-title" className="pane-title">Preview</h2>
          {!template
            ? <div className="empty-preview"><span aria-hidden="true">⇱</span><p>No relevant content. Please set information on the left before previewing.</p></div>
            : <Preview
                template={template} project={project} site={site} person={person} planned={planned}
                selfCheck={typeInfo.selfCheck} checklist={preview}
              />}
        </section>
      </div>
    </form>
  );
}

type Loaded = ChecklistPreview | { state: 'loading' } | null;

/** Loads a template's checklist once and keeps it, so switching back and forth does not refetch. */
function useChecklist(template: CreatorTemplate | undefined): Loaded {
  const [loaded, setLoaded] = useState<Record<string, ChecklistPreview>>({});
  const [, startTransition] = useTransition();
  const key = template ? `${template.id}@${template.version}` : '';
  const known = key in loaded;

  useEffect(() => {
    if (!template || known) return;
    startTransition(async () => {
      const result = await loadChecklistAction(template.id, template.version);
      setLoaded((previous) => ({ ...previous, [key]: result }));
    });
  }, [key, known, template]);

  if (!template) return null;
  return loaded[key] ?? { state: 'loading' };
}

function Preview({ template, project, site, person, planned, selfCheck, checklist }: {
  template: CreatorTemplate;
  project: { code: string; name: string };
  site: CreatorSite | undefined;
  person: CreatorPerson | undefined;
  planned: string | null;
  selfCheck: boolean;
  checklist: Loaded;
}) {
  const meta: [string, string][] = [
    ['Project Name', project.name], ['Project Code', project.code],
    ['Site Name', site?.name ?? ''], ['Site Code', site?.siteCode ?? ''],
    ['City', site?.city ?? ''], ['Area', site?.area ?? ''],
    ['Responsible Person', person?.label ?? ''], ['Planned Completion', planned ? formatDateTime(planned) : ''],
  ];
  return (
    <div className="preview-doc">
      <h3 className="preview-title">{template.name}</h3>
      <dl className="preview-meta">
        {meta.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}
      </dl>
      {checklist === null || checklist.state === 'loading'
        ? <p className="subtle">Loading the checklist…</p>
        : checklist.state === 'error'
          ? <p className="form-error" role="alert">The checklist could not be loaded: {checklist.message}</p>
          : checklist.sections.map((section, index) => (
              <details key={section.id} className="preview-section" open={index === 0}>
                <summary>{section.number}. {section.title} <span className="subtle">({section.items.length})</span></summary>
                <ol className="preview-items">
                  {section.items.map((item) => <PreviewItem key={item.id} item={item} selfCheck={selfCheck} />)}
                </ol>
              </details>
            ))}
    </div>
  );
}

/** One item as the responsible person will see it: every control shown, none of them live. */
function PreviewItem({ item, selfCheck }: { item: ChecklistItem; selfCheck: boolean }) {
  const photos = photoLabel(item.minPhotos, item.maxPhotos);
  const result = selfCheck ? 'Self-check Result' : 'Check Result';
  return (
    <li className="preview-item">
      <p className="preview-requirement">
        <b>{item.number}.</b> {item.requirementText}
        {item.severity === 'CRITICAL' ? <span className="badge red">Critical</span> : null}
      </p>
      <div className="preview-row">
        <span className={item.isRequired ? 'preview-label required' : 'preview-label'}>{result}</span>
        <span className="preview-options">
          <label><input type="radio" disabled /> Approved</label>
          <label><input type="radio" disabled /> Rejected</label>
          {item.allowsNa ? <label><input type="radio" disabled /> No Check</label> : null}
        </span>
      </div>
      {item.responseType !== 'RESULT_ONLY'
        ? <div className="preview-row">
            <span className="preview-label">{RESPONSE_TYPE_LABELS[item.responseType]}</span>
            {item.responseType === 'SELECT'
              ? <span className="preview-options">{item.selectOptions.map((option) => <label key={option}><input type="radio" disabled /> {option}</label>)}</span>
              : item.responseType === 'BOOLEAN'
                ? <span className="preview-options"><label><input type="radio" disabled /> Yes</label><label><input type="radio" disabled /> No</label></span>
                : <input className="preview-input" disabled type={item.responseType === 'NUMBER' ? 'number' : 'text'} aria-label={RESPONSE_TYPE_LABELS[item.responseType]} />}
          </div>
        : null}
      {photos
        ? <div className="preview-row">
            <span className={item.minPhotos > 0 ? 'preview-label required' : 'preview-label'}>Upload Pictures</span>
            <span className="photo-slot" aria-hidden="true">📷</span>
            <span className="hint">{photos}</span>
          </div>
        : null}
      {item.guidanceText ? <p className="subtle preview-guidance">{item.guidanceText}</p> : null}
      <div className="preview-row">
        <span className="preview-label">{selfCheck ? 'Self-Check Description' : 'Check Description'}</span>
        <input className="preview-input" disabled aria-label="Description" />
      </div>
    </li>
  );
}

