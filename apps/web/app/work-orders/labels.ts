import type { AssignableUser, TaskStatus } from '../lib/project-api';
import type { DirectoryUser } from '../lib/user-api';

/**
 * Work order vocabulary and the pure rules the screens share. Free of
 * anything that reaches the server, so the client composer can use it too.
 */

export type WorkOrderType = 'QUALITY_SELF_CHECK' | 'QUALITY_SPOT_CHECK' | 'EHS_SELF_CHECK' | 'EHS_SPOT_CHECK';
export type TemplateCategory = 'QUALITY' | 'EHS' | 'OTHER';

export interface WorkOrderTypeInfo {
  type: WorkOrderType;
  label: string;
  category: TemplateCategory;
  selfCheck: boolean;
  /** One line on who does what, for the composer's type tiles. */
  blurb: string;
}

export const WORK_ORDER_TYPES: readonly WorkOrderTypeInfo[] = [
  { type: 'QUALITY_SELF_CHECK', label: 'Quality Self-check', category: 'QUALITY', selfCheck: true, blurb: 'The installer checks their own work against the quality checklist.' },
  { type: 'QUALITY_SPOT_CHECK', label: 'Quality Spot Check', category: 'QUALITY', selfCheck: false, blurb: 'A QC inspector audits a sample of finished work.' },
  { type: 'EHS_SELF_CHECK', label: 'EHS Self-check', category: 'EHS', selfCheck: true, blurb: 'The site team confirms safety measures before and during work.' },
  { type: 'EHS_SPOT_CHECK', label: 'EHS Spot Check', category: 'EHS', selfCheck: false, blurb: 'An EHS officer inspects the site unannounced.' },
];

export const WORK_ORDER_TYPE_LABEL = Object.fromEntries(WORK_ORDER_TYPES.map(({ type, label }) => [type, label])) as Record<WorkOrderType, string>;

export function typeInfo(type: WorkOrderType): WorkOrderTypeInfo {
  return WORK_ORDER_TYPES.find((entry) => entry.type === type) ?? WORK_ORDER_TYPES[0]!;
}

export function isWorkOrderType(value: string | undefined): value is WorkOrderType {
  return WORK_ORDER_TYPES.some(({ type }) => type === value);
}

/** Only templates of the type's category may be used — the service refuses the rest. */
export function templatesFor<T extends { category: TemplateCategory }>(type: WorkOrderType, templates: readonly T[]): T[] {
  const { category } = typeInfo(type);
  return templates.filter((template) => template.category === category);
}

/** The status a person reads. Distinct from the stored enum, which is written for machines. */
export const STATUS_TEXT: Record<TaskStatus, { label: string; tone: 'slate' | 'blue' | 'amber' | 'red' | 'green' }> = {
  NOT_STARTED: { label: 'Not started', tone: 'slate' },
  ONGOING: { label: 'In progress', tone: 'blue' },
  REVIEWING: { label: 'In review', tone: 'amber' },
  RECTIFYING: { label: 'Needs rework', tone: 'red' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'slate' },
};

const OPEN: readonly TaskStatus[] = ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'];
export const isOpen = (status: TaskStatus): boolean => OPEN.includes(status);

/**
 * The queue's filter pills. Each maps to exactly one query the list API
 * understands, so a pill is a link and the page works without JavaScript.
 */
export const QUEUE_FILTERS = [
  { key: 'open', label: 'Open', query: { view: 'open' } },
  { key: 'overdue', label: 'Overdue', query: { view: 'overdue' } },
  { key: 'review', label: 'In review', query: { status: 'REVIEWING' } },
  { key: 'rework', label: 'Needs rework', query: { status: 'RECTIFYING' } },
  { key: 'done', label: 'Completed', query: { status: 'COMPLETED' } },
  { key: 'cancelled', label: 'Cancelled', query: { status: 'CANCELLED' } },
  { key: 'all', label: 'All', query: {} },
] as const;
export type QueueFilterKey = (typeof QUEUE_FILTERS)[number]['key'];

export function queueFilter(key: string | undefined) {
  return QUEUE_FILTERS.find((entry) => entry.key === key) ?? QUEUE_FILTERS[0];
}

/** The count a pill shows, from the list's status counts. */
export function filterCount(key: QueueFilterKey, counts: Record<string, number>): number {
  switch (key) {
    case 'open': return OPEN.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
    case 'overdue': return counts['OVERDUE'] ?? 0;
    case 'review': return counts['REVIEWING'] ?? 0;
    case 'rework': return counts['RECTIFYING'] ?? 0;
    case 'done': return counts['COMPLETED'] ?? 0;
    case 'cancelled': return counts['CANCELLED'] ?? 0;
    case 'all': return counts['ALL'] ?? 0;
  }
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'closed';
export const DUE_BUCKETS: readonly { key: DueBucket; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Due in the next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No date' },
  { key: 'closed', label: 'Closed' },
];

/** Where a work order sits on the calendar, for grouping the queue. */
export function dueBucket(order: { status: TaskStatus; plannedCompletionAt: string | null }, now: Date): DueBucket {
  if (!isOpen(order.status)) return 'closed';
  if (!order.plannedCompletionAt) return 'none';
  const due = new Date(order.plannedCompletionAt);
  if (due.getTime() < now.getTime()) return 'overdue';
  const days = daysBetween(now, due);
  if (days <= 0) return 'today';
  return days <= 7 ? 'week' : 'later';
}

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const LONG = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatDay(iso: string | null): string {
  return iso ? LONG.format(new Date(iso)) : '—';
}

/** `2026-09-16 23:59`, in the viewer's zone. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The one phrase a row shows about time: how late, how soon, or when it closed. */
export function dueText(order: { status: TaskStatus; plannedCompletionAt: string | null; actualCompletionAt: string | null }, now: Date): { text: string; tone: 'red' | 'amber' | 'slate' | 'green' } {
  if (order.status === 'COMPLETED') return { text: order.actualCompletionAt ? `Done ${SHORT.format(new Date(order.actualCompletionAt))}` : 'Done', tone: 'green' };
  if (order.status === 'CANCELLED') return { text: 'Cancelled', tone: 'slate' };
  if (!order.plannedCompletionAt) return { text: 'No date', tone: 'slate' };
  const due = new Date(order.plannedCompletionAt);
  const days = daysBetween(now, due);
  if (due.getTime() < now.getTime()) {
    const late = Math.max(1, -days);
    return { text: `${late} day${late === 1 ? '' : 's'} overdue`, tone: 'red' };
  }
  if (days <= 0) return { text: 'Due today', tone: 'amber' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'amber' };
  return { text: `Due ${SHORT.format(due)}`, tone: days <= 3 ? 'amber' : 'slate' };
}

/** `YYYY-MM-DD` for a date input, in the local zone. */
export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The composer's one-tap due dates. */
export function quickDates(today: Date): { label: string; day: string }[] {
  const plus = (days: number) => isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
  const endOfMonth = isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  return [
    { label: 'In 3 days', day: plus(3) },
    { label: 'In a week', day: plus(7) },
    { label: 'In 2 weeks', day: plus(14) },
    { label: 'End of month', day: endOfMonth },
  ];
}

/**
 * A planned completion date means "by the end of that day" in the creator's
 * own time zone, so this runs in the browser, where that zone is known.
 */
export function endOfDayIso(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const end = new Date(`${date}T23:59:59`);
  return Number.isNaN(end.getTime()) ? null : end.toISOString();
}

export function personLabel(person: { fullName: string; employeeCode: string | null }): string {
  return person.employeeCode ? `${person.fullName} (${person.employeeCode})` : person.fullName;
}

export function initials(name: string): string {
  const parts = name.replace(/\(.*\)/, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

export interface EligiblePerson { id: string; label: string }

/**
 * Who may take every one of these sites: active people whose scope covers the
 * whole project, or each chosen site. The service applies the same rule; this
 * keeps the picker from offering someone it would refuse. `hidden` counts
 * people with some access to the project who cannot take all of the sites.
 */
export function eligiblePeople(assignable: readonly AssignableUser[], directory: readonly DirectoryUser[], siteIds: readonly string[]): { people: EligiblePerson[]; hidden: number } {
  const byId = new Map(directory.filter((person) => person.isActive).map((person) => [person.id, person]));
  const people: EligiblePerson[] = [];
  let hidden = 0;
  for (const entry of assignable) {
    const person = byId.get(entry.userId);
    if (!person) continue;
    if (entry.wholeProject || siteIds.every((id) => entry.siteIds.includes(id))) people.push({ id: person.id, label: personLabel(person) });
    else hidden += 1;
  }
  return { people: people.sort((a, b) => a.label.localeCompare(b.label)), hidden };
}

/** What a task table's Type column says: the task type's name, or the work order type for a work order. */
export function taskKind(task: { taskTypeId: string | null; workOrderType: WorkOrderType | null }, taskTypeNames: ReadonlyMap<string, string>): string {
  if (task.taskTypeId) return taskTypeNames.get(task.taskTypeId) ?? '—';
  return task.workOrderType ? WORK_ORDER_TYPE_LABEL[task.workOrderType] : '—';
}

/** Page numbers around the current page, with `null` for a gap: 1 … 4 5 [6] 7 8 … 103. */
export function pageWindow(page: number, pages: number, radius = 2): (number | null)[] {
  const shown = new Set([1, pages]);
  for (let n = page - radius; n <= page + radius; n += 1) if (n >= 1 && n <= pages) shown.add(n);
  const sorted = [...shown].filter((n) => n >= 1).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (typeof last === 'number' && n - last > 1) out.push(null);
    out.push(n);
  }
  return out;
}

/**
 * The name the service will give each work order — the same format as
 * `workOrderTitle` in @ipms/contracts, repeated here because the client bundle
 * must not import the contracts barrel (it pulls in zod and node:crypto).
 * `labels.spec.ts` holds the two to the same output.
 */
export function previewTitle(type: WorkOrderType, siteName: string, note?: string): string {
  const extra = note?.trim();
  return `[${WORK_ORDER_TYPE_LABEL[type]}]${siteName}${extra ? ` ${extra}` : ''}`.slice(0, 250);
}
