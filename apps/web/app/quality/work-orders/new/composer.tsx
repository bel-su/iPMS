'use client';
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { EMPTY } from '../../../lib/form-state';
import type { DirectoryUser } from '../../../lib/user-api';
import { FormError } from '../../../projects/forms';
import {
  createWorkOrdersAction, loadChecklistAction, loadProjectAction,
  type ChecklistPreview, type ProjectContext,
} from '../actions';
import { ChecklistOutline } from '../checklist-outline';
import {
  WORK_ORDER_TYPES, eligiblePeople, endOfDayIso, isoDay, previewTitle, quickDates, templatesFor, typeInfo,
  type TemplateCategory, type WorkOrderType,
} from '../labels';

export interface ComposerTemplate {
  id: string; code: string; name: string; category: TemplateCategory; version: number;
  itemCount: number; criticalCount: number; sectionCount: number;
}

const NAME_PREVIEW = 4;

function Submit({ count, ready }: { count: number; ready: boolean }) {
  const { pending } = useFormStatus();
  const label = count > 1 ? `Create ${count} work orders` : 'Create work order';
  return <button className="primary-button composer-submit" type="submit" disabled={!ready || pending}>{pending ? 'Creating…' : label}</button>;
}

/**
 * Assigning work, in the order the decision is made: what kind of check and
 * which checklist, then where, then who and by when. The summary beside it is
 * the whole order at a glance — how many work orders, their names, and the
 * checklist's outline — so nothing is committed blind.
 *
 * Many sites at once is the point: a coordinator rolling a checklist out to a
 * cluster picks them all here instead of repeating one form per site.
 */
export function Composer({ projects, templates, directory, initialProjectId, initialContext }: {
  projects: { id: string; code: string; name: string }[];
  templates: ComposerTemplate[];
  directory: DirectoryUser[];
  initialProjectId: string;
  initialContext: ProjectContext | null;
}) {
  const [state, action] = useActionState(createWorkOrdersAction, EMPTY);
  const [type, setType] = useState<WorkOrderType>('QUALITY_SELF_CHECK');
  const [templateId, setTemplateId] = useState('');
  const [templateQuery, setTemplateQuery] = useState('');
  const [projectId, setProjectId] = useState(initialProjectId);
  const [context, setContext] = useState<ProjectContext | null>(initialContext);
  const [loadingProject, startProjectLoad] = useTransition();
  const [siteQuery, setSiteQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [day, setDay] = useState('');
  const [note, setNote] = useState('');

  const info = typeInfo(type);
  const offered = templatesFor(type, templates);
  const q = templateQuery.trim().toLowerCase();
  const shownTemplates = q ? offered.filter((t) => `${t.name} ${t.code}`.toLowerCase().includes(q)) : offered;
  const template = offered.find((t) => t.id === templateId);
  const project = projects.find((p) => p.id === projectId);
  const sites = context?.state === 'ready' ? context.sites : [];
  const sq = siteQuery.trim().toLowerCase();
  const shownSites = sq ? sites.filter((s) => `${s.siteCode} ${s.name} ${s.city ?? ''} ${s.area ?? ''}`.toLowerCase().includes(sq)) : sites;
  const chosenSites = sites.filter((s) => selected.includes(s.id));
  const { people, hidden } = useMemo(
    () => (context?.state === 'ready' ? eligiblePeople(context.assignable, directory, selected) : { people: [], hidden: 0 }),
    [context, directory, selected],
  );
  // A person stays chosen only while they can still take every chosen site.
  const assignee = people.find((p) => p.id === assigneeId);
  const planned = endOfDayIso(day);
  const outline = useChecklist(template);
  const ready = Boolean(project && template && chosenSites.length > 0 && assignee && planned);

  const chooseType = (next: WorkOrderType) => {
    setType(next);
    if (!templatesFor(next, templates).some((t) => t.id === templateId)) setTemplateId('');
  };
  const chooseProject = (next: string) => {
    setProjectId(next);
    setSelected([]);
    setContext(null);
    if (!next) return;
    startProjectLoad(async () => { setContext(await loadProjectAction(next)); });
  };
  const toggleSite = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]));
  const selectShown = () => setSelected((current) => [...new Set([...current, ...shownSites.map((s) => s.id)])]);
  const today = useMemo(() => new Date(), []);

  return (
    <form action={action} className="composer">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="plannedCompletionAt" value={planned ?? ''} />
      {chosenSites.map((site) => <input key={site.id} type="hidden" name="siteIds" value={site.id} />)}

      <div className="composer-steps">
        <section className="step" aria-labelledby="step-what">
          <header><span className="step-num" aria-hidden="true">1</span><div><h2 id="step-what">What should be checked?</h2><p>The kind of check decides which checklists fit.</p></div></header>
          <div className="type-tiles" role="radiogroup" aria-label="Kind of check">
            {WORK_ORDER_TYPES.map((entry) => (
              <label key={entry.type} className={`type-tile ${entry.category === 'EHS' ? 'ehs' : 'quality'}`}>
                <input type="radio" name="workOrderType" value={entry.type} checked={type === entry.type} onChange={() => chooseType(entry.type)} />
                <span className="type-mark" aria-hidden="true">{entry.category === 'EHS' ? 'EHS' : 'Q'}</span>
                <span><strong>{entry.label}</strong><small>{entry.blurb}</small></span>
              </label>
            ))}
          </div>

          <div className="picker-head">
            <h3>Checklist</h3>
            <input type="search" value={templateQuery} onChange={(e) => setTemplateQuery(e.target.value)} placeholder={`Search ${info.category === 'EHS' ? 'EHS' : 'Quality'} checklists`} aria-label="Search checklists" />
          </div>
          {offered.length === 0
            ? <p className="picker-empty">No {info.category === 'EHS' ? 'EHS' : 'Quality'} checklist is published yet. <a href="/quality/templates">Publish one</a> first.</p>
            : <div className="choice-list" role="radiogroup" aria-label="Checklist">
                {shownTemplates.map((t) => (
                  <label key={t.id} className="choice">
                    <input type="radio" name="templateId" value={t.id} checked={templateId === t.id} onChange={() => setTemplateId(t.id)} />
                    <span className="choice-body">
                      <strong>{t.name}</strong>
                      <small>{t.code} · v{t.version} · {t.sectionCount} sections · {t.itemCount} items{t.criticalCount ? ` · ${t.criticalCount} critical` : ''}</small>
                    </span>
                  </label>
                ))}
                {shownTemplates.length === 0 ? <p className="picker-empty">Nothing matches “{templateQuery}”.</p> : null}
              </div>}
        </section>

        <section className="step" aria-labelledby="step-where">
          <header><span className="step-num" aria-hidden="true">2</span><div><h2 id="step-where">Where?</h2><p>A site can belong to several projects — the project (DU) decides which one this work is for.</p></div></header>
          <label className="field-row">
            <span>Project ID (DU)</span>
            <select value={projectId} onChange={(e) => chooseProject(e.target.value)} aria-label="Project">
              <option value="">Choose a project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </label>
          {!projectId
            ? <p className="picker-empty">Choose a project to see its sites.</p>
            : loadingProject || !context
              ? <p className="picker-empty">Loading sites…</p>
              : context.state === 'error'
                ? <p className="form-error" role="alert">{context.message}</p>
                : <>
                    <div className="picker-head">
                      <input type="search" value={siteQuery} onChange={(e) => setSiteQuery(e.target.value)} placeholder="Filter by code, name, city or area" aria-label="Filter sites" />
                      <button type="button" className="link-button" onClick={selectShown} disabled={shownSites.length === 0}>Select {sq ? 'shown' : 'all'} ({shownSites.length})</button>
                      <button type="button" className="link-button" onClick={() => setSelected([])} disabled={selected.length === 0}>Clear</button>
                    </div>
                    {sites.length === 0
                      ? <p className="picker-empty">This project has no sites you can see.</p>
                      : <ul className="site-list" aria-label="Sites">
                          {shownSites.map((site) => (
                            <li key={site.id}>
                              <label className={selected.includes(site.id) ? 'on' : undefined}>
                                <input type="checkbox" checked={selected.includes(site.id)} onChange={() => toggleSite(site.id)} />
                                <b>{site.siteCode}</b>
                                <span>{site.name !== site.siteCode ? site.name : ''}</span>
                                <small>{[site.city, site.area].filter(Boolean).join(' · ')}</small>
                              </label>
                            </li>
                          ))}
                        </ul>}
                  </>}
        </section>

        <section className="step" aria-labelledby="step-who">
          <header><span className="step-num" aria-hidden="true">3</span><div><h2 id="step-who">Who, and by when?</h2><p>Only people who can open every chosen site are offered.</p></div></header>
          <label className="field-row">
            <span>{info.selfCheck ? 'Responsible for the self-check' : 'Inspector'}</span>
            <select name="assigneeId" value={assignee ? assigneeId : ''} onChange={(e) => setAssigneeId(e.target.value)} disabled={!projectId}>
              <option value="">{selected.length === 0 ? 'Choose sites first' : people.length === 0 ? 'Nobody can take all of these sites' : 'Choose a person'}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          {hidden > 0 ? <p className="hint-line">{hidden} {hidden === 1 ? 'person has' : 'people have'} access to only some of these sites and {hidden === 1 ? 'is' : 'are'} not listed.</p> : null}
          <div className="field-row">
            <span>Planned completion</span>
            <div className="date-pick">
              <input type="date" value={day} min={isoDay(today)} onChange={(e) => setDay(e.target.value)} aria-label="Planned completion date" />
              <div className="chips">
                {quickDates(today).map((chip) => (
                  <button key={chip.label} type="button" className={day === chip.day ? 'chip on' : 'chip'} onClick={() => setDay(chip.day)}>{chip.label}</button>
                ))}
              </div>
            </div>
          </div>
          <label className="field-row">
            <span>Note <small>(optional)</small></span>
            <input name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Added after each work order name, e.g. “sector A”" />
          </label>
        </section>
      </div>

      <aside className="composer-summary" aria-label="Summary">
        <div className="summary-count"><strong>{chosenSites.length}</strong><span>work order{chosenSites.length === 1 ? '' : 's'} will be created</span></div>
        <dl className="summary-facts">
          <div><dt>Check</dt><dd>{info.label}</dd></div>
          <div><dt>Checklist</dt><dd>{template ? `${template.name} (v${template.version})` : '—'}</dd></div>
          <div><dt>Project (DU)</dt><dd>{project ? <><code>{project.code}</code> {project.name}</> : '—'}</dd></div>
          <div><dt>Responsible</dt><dd>{assignee?.label ?? '—'}</dd></div>
          <div><dt>Due</dt><dd>{day ? `${day}, end of day` : '—'}</dd></div>
        </dl>
        {chosenSites.length > 0
          ? <ul className="summary-names">
              {chosenSites.slice(0, NAME_PREVIEW).map((site) => <li key={site.id}>{previewTitle(type, site.name, note)}</li>)}
              {chosenSites.length > NAME_PREVIEW ? <li className="more">and {chosenSites.length - NAME_PREVIEW} more</li> : null}
            </ul>
          : null}
        <FormError state={state} />
        <Submit count={chosenSites.length} ready={ready} />
        {template
          ? <div className="summary-outline">
              <h3>Checklist outline</h3>
              {!outline || outline.state === 'loading'
                ? <p className="subtle">Loading…</p>
                : outline.state === 'error'
                  ? <p className="form-error" role="alert">{outline.message}</p>
                  : <ChecklistOutline sections={outline.sections} />}
            </div>
          : null}
      </aside>
    </form>
  );
}

type Loaded = ChecklistPreview | { state: 'loading' } | null;

/** Loads a template's checklist once and keeps it, so switching back and forth does not refetch. */
function useChecklist(template: ComposerTemplate | undefined): Loaded {
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
