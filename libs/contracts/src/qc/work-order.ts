import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';
import { PaginationSchema, type Paginated } from '../common/pagination.js';
import type { TemplateCategory } from './template.js';
import { TaskStatusSchema } from '../project/project.js';

/**
 * A work order is a QC checklist template assigned to one site of a project,
 * owned by the qc service. Its statuses are the task statuses. Its type says
 * which kind of check it is and, through `WORK_ORDER_TEMPLATE_CATEGORY`, which
 * templates it may use: a Quality check cannot be raised on an EHS checklist.
 */
export const WorkOrderTypeSchema = z.enum(['QUALITY_SELF_CHECK', 'QUALITY_SPOT_CHECK', 'EHS_SELF_CHECK', 'EHS_SPOT_CHECK']);
export type WorkOrderType = z.infer<typeof WorkOrderTypeSchema>;

export const WORK_ORDER_TEMPLATE_CATEGORY: Record<WorkOrderType, TemplateCategory> = {
  QUALITY_SELF_CHECK: 'QUALITY',
  QUALITY_SPOT_CHECK: 'QUALITY',
  EHS_SELF_CHECK: 'EHS',
  EHS_SPOT_CHECK: 'EHS',
};

/** The label in a generated work order name: `[Quality Self-check]SAKUWA GACHHI`. */
export const WORK_ORDER_TYPE_LABEL: Record<WorkOrderType, string> = {
  QUALITY_SELF_CHECK: 'Quality Self-check',
  QUALITY_SPOT_CHECK: 'Quality Spot Check',
  EHS_SELF_CHECK: 'EHS Self-check',
  EHS_SPOT_CHECK: 'EHS Spot Check',
};

export const WORK_ORDER_BATCH_LIMIT = 200;
export const WORK_ORDER_NOTE_MAX = 120;

/**
 * The name a work order gets: the type label, the site's name, and the
 * creator's note if there is one. Generated rather than typed so every work
 * order on a site reads the same way, and so a batch of sites needs no
 * per-site naming. Shared by the service and the composer's preview.
 */
export function workOrderTitle(type: WorkOrderType, siteName: string, note?: string | null): string {
  const extra = note?.trim();
  return `[${WORK_ORDER_TYPE_LABEL[type]}]${siteName}${extra ? ` ${extra}` : ''}`.slice(0, 250);
}

/**
 * One template, one person, one due date, and every site that should be
 * checked with them — one work order per site. Every field but the note is
 * required: a work order nobody is responsible for, or with no date to be done
 * by, is a task that will never be picked up.
 */
export const CreateWorkOrdersSchema = z.object({
  projectId: UuidSchema,
  workOrderType: WorkOrderTypeSchema,
  templateId: UuidSchema,
  siteIds: z.array(UuidSchema).min(1).max(WORK_ORDER_BATCH_LIMIT)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each site may be chosen once' }),
  assigneeId: UuidSchema,
  plannedCompletionAt: z.coerce.date(),
  note: z.string().trim().max(WORK_ORDER_NOTE_MAX).optional(),
}).strip();
export type CreateWorkOrdersDto = z.infer<typeof CreateWorkOrdersSchema>;

/** Reassign, reschedule, or both. At least one is required. */
export const UpdateWorkOrderSchema = z.object({
  assigneeId: UuidSchema.optional(),
  plannedCompletionAt: z.coerce.date().optional(),
}).strip().refine((value) => value.assigneeId !== undefined || value.plannedCompletionAt !== undefined, {
  message: 'Change the responsible person or the planned completion date',
});
export type UpdateWorkOrderDto = z.infer<typeof UpdateWorkOrderSchema>;

export const CancelWorkOrderSchema = z.object({
  reason: z.string().trim().min(3).max(500),
}).strip();
export type CancelWorkOrderDto = z.infer<typeof CancelWorkOrderSchema>;

/** `overdue` is open work whose planned completion has passed; it is a view, not a stored status. */
export const WorkOrderViewSchema = z.enum(['open', 'overdue', 'closed']);

export const ListWorkOrdersQuerySchema = PaginationSchema.extend({
  projectId: UuidSchema.optional(),
  status: TaskStatusSchema.optional(),
  view: WorkOrderViewSchema.optional(),
  workOrderType: WorkOrderTypeSchema.optional(),
  assigneeId: UuidSchema.optional(),
  q: z.string().trim().max(100).optional(),
}).strip();
export type ListWorkOrdersQueryDto = z.infer<typeof ListWorkOrdersQuerySchema>;

/**
 * How many work orders carry each status, plus the overdue view, before the
 * status and view filters are applied — the numbers on the filter pills.
 */
export type WorkOrderStatusCounts = Record<z.infer<typeof TaskStatusSchema> | 'ALL' | 'OVERDUE', number>;

export type WorkOrderPage<T> = Paginated<T> & { counts: WorkOrderStatusCounts };

/**
 * A project's work orders in brief, for the project dashboard: enough to
 * count by status, place on a site and a date, and link to. Not paginated:
 * the dashboard summarises all of them.
 */
export interface WorkOrderBrief {
  id: string; siteId: string; siteCode: string; title: string;
  workOrderType: WorkOrderType; status: z.infer<typeof TaskStatusSchema>;
  assigneeId: string | null; plannedCompletionAt: Date | string | null;
}

/** What happened to a work order, in order — the detail page's timeline. */
export const WORK_ORDER_EVENT_KINDS = [
  'CREATED', 'REASSIGNED', 'RESCHEDULED', 'CANCELLED', 'SUBMITTED', 'APPROVED', 'REJECTED',
] as const;
export type WorkOrderEventKind = (typeof WORK_ORDER_EVENT_KINDS)[number];
