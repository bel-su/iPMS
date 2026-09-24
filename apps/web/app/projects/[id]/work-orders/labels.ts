import type { TaskStatus } from '../../../lib/project-api';

/**
 * Work order vocabulary, free of imports that reach the server so both the
 * server pages and the client creator can use it.
 */

export type WorkOrderType = 'QUALITY_SELF_CHECK' | 'QUALITY_SPOT_CHECK' | 'EHS_SELF_CHECK' | 'EHS_SPOT_CHECK';
export type TemplateCategory = 'QUALITY' | 'EHS' | 'OTHER';

export const WORK_ORDER_TYPES: readonly { type: WorkOrderType; label: string; category: TemplateCategory; selfCheck: boolean }[] = [
  { type: 'QUALITY_SELF_CHECK', label: 'Quality Self-check', category: 'QUALITY', selfCheck: true },
  { type: 'QUALITY_SPOT_CHECK', label: 'Quality Spot Check', category: 'QUALITY', selfCheck: false },
  { type: 'EHS_SELF_CHECK', label: 'EHS Self-check', category: 'EHS', selfCheck: true },
  { type: 'EHS_SPOT_CHECK', label: 'EHS Spot Check', category: 'EHS', selfCheck: false },
];

export const WORK_ORDER_TYPE_LABEL = Object.fromEntries(WORK_ORDER_TYPES.map(({ type, label }) => [type, label])) as Record<WorkOrderType, string>;

export function isWorkOrderType(value: string | undefined): value is WorkOrderType {
  return WORK_ORDER_TYPES.some(({ type }) => type === value);
}

/** Only templates of the type's category may be used — the service refuses the rest. */
export function templatesFor<T extends { category: TemplateCategory }>(type: WorkOrderType, templates: readonly T[]): T[] {
  const category = WORK_ORDER_TYPES.find((entry) => entry.type === type)?.category;
  return templates.filter((template) => template.category === category);
}

/**
 * The generated work order name, `[Quality Self-check]SAKUWA GACHHI`, with
 * whatever the creator added after it. Empty until a site is chosen: a name
 * without a site says nothing about where the work is.
 */
export function workOrderTitle(type: WorkOrderType, siteName: string | undefined, addition = ''): string {
  if (!siteName) return '';
  const extra = addition.trim();
  return `[${WORK_ORDER_TYPE_LABEL[type]}]${siteName}${extra ? ` ${extra}` : ''}`.slice(0, 250);
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

/** The tabs on the list, in the design's order; 'ALL' is no status filter. */
export const STATUS_TABS: readonly { key: TaskStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'ONGOING', label: 'Ongoing' },
  { key: 'NOT_STARTED', label: 'Not Started' },
  { key: 'REVIEWING', label: 'Reviewing' },
  { key: 'RECTIFYING', label: 'Rectifying' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

/** `2026-09-16 23:59` — the list's timestamp format. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Page numbers to show around the current page, with `null` for a gap: 1 … 4 5 [6] 7 8 … 103. */
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

/** What a task table's Type column says: the task type's name, or the work order type for a work order. */
export function taskKind(task: { taskTypeId: string | null; workOrderType: WorkOrderType | null }, taskTypeNames: ReadonlyMap<string, string>): string {
  if (task.taskTypeId) return taskTypeNames.get(task.taskTypeId) ?? '—';
  return task.workOrderType ? WORK_ORDER_TYPE_LABEL[task.workOrderType] : '—';
}
