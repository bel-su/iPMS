import { getCurrentUser, hasPermission } from '../../../lib/iam-api';
import { listAssignable } from '../../../lib/project-api';
import { getWorkOrder, type WorkOrderEvent } from '../../../lib/work-order-api';
import { getSubmission, getTemplate, getVersion, type ChecklistSection } from '../../../lib/qc-api';
import { listUserDirectory } from '../../../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../../../shell';
import { ChecklistOutline } from '../checklist-outline';
import { STATUS_TEXT, WORK_ORDERS_PATH, projectWorkOrdersPath, dueText, eligiblePeople, formatDateTime, formatDay, isOpen, isoDay, personLabel, typeInfo } from '../labels';
import { FilledChecklist } from './filled-checklist';
import { ManageWorkOrder } from './manage';

/** The checklist as it stands now: projects always use the latest published version. */
async function currentChecklist(templateId: string): Promise<ChecklistSection[] | null> {
  const template = await getTemplate(templateId);
  if (template.state !== 'ready') return null;
  const published = template.data.versions.find((version) => version.status === 'PUBLISHED');
  if (!published) return null;
  const version = await getVersion(templateId, published.version);
  return version.state === 'ready' ? version.data.version.sections : null;
}

/** The sections of the version a submission was made against, for grouping its answers. */
async function versionSections(templateId: string, version: number): Promise<ChecklistSection[] | null> {
  const detail = await getVersion(templateId, version);
  return detail.state === 'ready' ? detail.data.version.sections : null;
}

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, viewer, people] = await Promise.all([getWorkOrder(id), getCurrentUser(), listUserDirectory()]);
  if (order.state === 'unauthenticated') return <StatePage title="Sign in to see this work order"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (order.state !== 'ready') {
    return <StatePage title="Cannot show this work order"><p>{order.message}</p><p className="subtle"><a href={WORK_ORDERS_PATH}>Back to work orders</a></p></StatePage>;
  }
  const wo = order.data;
  const may = (permission: string) => viewer.state === 'ready' && hasPermission(viewer.data, permission);
  const open = isOpen(wo.status);
  const canAssign = open && may('task.assign');
  const canCancel = open && may('task.cancel');
  const directory = people.state === 'ready' ? people.data : [];
  const name = (userId: string | null | undefined) => {
    if (!userId) return '—';
    const person = directory.find((p) => p.id === userId);
    return person ? personLabel(person) : 'Unknown user';
  };
  const [assignable, sections, submitted] = await Promise.all([
    canAssign ? listAssignable(wo.projectId) : Promise.resolve(null),
    wo.templateId && may('qc_template.view') ? currentChecklist(wo.templateId) : Promise.resolve(null),
    wo.currentSubmissionId && may('qc_submission.view') ? getSubmission(wo.currentSubmissionId) : Promise.resolve(null),
  ]);
  const submission = submitted?.state === 'ready' ? submitted.data : null;
  const submissionSections = submission && may('qc_template.view') ? await versionSections(submission.templateId, submission.templateVersion) : null;
  const candidates = assignable?.state === 'ready' ? eligiblePeople(assignable.data, directory, [wo.site.id]).people : [];
  const info = wo.workOrderType ? typeInfo(wo.workOrderType) : null;
  const status = STATUS_TEXT[wo.status];
  const now = new Date();
  const due = dueText(wo, now);

  return (
    <main className="app-shell">
      <Sidebar active="work-orders" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/quality">Quality &amp; EHS</a><b>/</b><a href={WORK_ORDERS_PATH}>Work orders</a><b>/</b><a href={projectWorkOrdersPath(wo.project.id)}>{wo.project.code}</a><b>/</b><strong>{wo.site.siteCode}</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <section className={`wo-hero ${info?.category === 'EHS' ? 'ehs' : 'quality'}`}>
            <span className="kind big" aria-hidden="true">{info?.category === 'EHS' ? 'EHS' : 'Q'}<small>{info?.selfCheck ? 'self' : 'spot'}</small></span>
            <div>
              <p className="eyebrow">{info?.label ?? 'Work order'}</p>
              <h1>{wo.title}</h1>
              <p className="hero-meta">
                <span className={`state ${status.tone}`}>{status.label}</span>
                <span className={`due ${due.tone}`}>{due.text}</span>
                {wo.currentAttemptNo ? <span className="subtle">Attempt {wo.currentAttemptNo}</span> : null}
              </p>
            </div>
          </section>

          <div className="wo-grid">
            <div className="wo-col">
              <section className="panel">
                <h2 className="panel-title">Details</h2>
                <dl className="facts">
                  <div><dt>Project ID (DU)</dt><dd><a href={projectWorkOrdersPath(wo.project.id)}><code>{wo.project.code}</code></a> {wo.project.name}</dd></div>
                  <div><dt>Site</dt><dd><b>{wo.site.siteCode}</b> {wo.site.name !== wo.site.siteCode ? wo.site.name : ''}<small>{[wo.site.city, wo.site.area].filter(Boolean).join(' · ')}</small></dd></div>
                  <div><dt>Checklist</dt><dd>{wo.templateId && may('qc_template.view') ? <a className="link" href={`/quality/templates/${wo.templateId}`}>{wo.templateName}</a> : wo.templateName ?? '—'}</dd></div>
                  <div><dt>Responsible</dt><dd>{name(wo.assigneeId)}</dd></div>
                  <div><dt>Planned completion</dt><dd>{formatDateTime(wo.plannedCompletionAt)}</dd></div>
                  <div><dt>Completed</dt><dd>{formatDateTime(wo.actualCompletionAt)}</dd></div>
                  <div><dt>Raised</dt><dd>{formatDay(wo.createdAt)} by {name(wo.createdBy)}</dd></div>
                  {wo.cancelReason ? <div><dt>Cancelled because</dt><dd>{wo.cancelReason}</dd></div> : null}
                </dl>
              </section>

              {may('qc_submission.view')
                ? <section className="panel">
                    <h2 className="panel-title">Filled checklist</h2>
                    {submission
                      ? <FilledChecklist submission={submission} sections={submissionSections} name={name} />
                      : <p className="subtle">{submitted && 'message' in submitted ? submitted.message : 'Nothing submitted yet.'}</p>}
                  </section>
                : null}
            </div>

            <div className="wo-col">
              {canAssign || canCancel
                ? <section className="panel">
                    <h2 className="panel-title">Manage</h2>
                    <ManageWorkOrder
                      id={wo.id} projectId={wo.projectId} assigneeId={wo.assigneeId}
                      plannedDay={wo.plannedCompletionAt ? isoDay(new Date(wo.plannedCompletionAt)) : ''}
                      people={candidates} canAssign={canAssign} canCancel={canCancel}
                    />
                  </section>
                : null}
              {sections
                ? <section className="panel">
                    <h2 className="panel-title">Checklist</h2>
                    <ChecklistOutline sections={sections} />
                  </section>
                : null}
              <section className="panel">
                <h2 className="panel-title">Timeline</h2>
                <ol className="timeline">
                  {timeline(wo).reverse().map((event) => (
                    <li key={event.id} className={`tl ${event.kind.toLowerCase()}`}>
                      <span className="tl-dot" aria-hidden="true" />
                      <div>
                        <p>{describe(event, name)}</p>
                        <small>{formatDateTime(event.at)}{event.actorId ? ` · ${name(event.actorId)}` : ''}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * The recorded events, opened by a CREATED entry built from the work order
 * itself when none was recorded — work orders raised before the timeline
 * existed would otherwise show an empty history.
 */
function timeline(wo: { id: string; createdAt: string; createdBy: string; assigneeId: string | null; plannedCompletionAt: string | null; events: WorkOrderEvent[] }): WorkOrderEvent[] {
  if (wo.events.some((event) => event.kind === 'CREATED')) return [...wo.events];
  const raised: WorkOrderEvent = {
    id: `${wo.id}-raised`, workOrderId: wo.id, kind: 'CREATED', at: wo.createdAt, actorId: wo.createdBy,
    detail: { assigneeId: wo.assigneeId, plannedCompletionAt: wo.plannedCompletionAt },
  };
  return [raised, ...wo.events];
}

function describe(event: WorkOrderEvent, name: (id: string | null | undefined) => string): React.ReactNode {
  const d = event.detail;
  const text = (key: string) => (typeof d[key] === 'string' ? d[key] as string : null);
  switch (event.kind) {
    case 'CREATED': return <>Assigned to <b>{name(text('assigneeId'))}</b>, due {formatDay(text('plannedCompletionAt'))}</>;
    case 'REASSIGNED': return <>Handed over from <b>{name(text('from'))}</b> to <b>{name(text('to'))}</b></>;
    case 'RESCHEDULED': return <>Due date moved from {formatDay(text('from'))} to <b>{formatDay(text('to'))}</b></>;
    case 'CANCELLED': return <>Cancelled — {text('reason')}</>;
    case 'SUBMITTED': return <>Checklist submitted{d['attemptNo'] && Number(d['attemptNo']) > 1 ? ` (attempt ${d['attemptNo']})` : ''}</>;
    case 'APPROVED': return <>Approved by QC{text('comment') ? ` — ${text('comment')}` : ''}</>;
    case 'REJECTED': return <>Sent back for rework{text('comment') ? ` — ${text('comment')}` : ''}</>;
  }
}
