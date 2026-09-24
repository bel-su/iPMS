import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';
import { PaginationSchema, type Paginated } from '../common/pagination.js';
import type { TemplateCategory } from '../qc/template.js';
import { TaskStatusSchema } from './project.js';

/**
 * A work order is a task that carries a QC checklist template. Its type says
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

/**
 * Every field is required: a work order nobody is responsible for, or with no
 * date to be done by, is a task that will never be picked up.
 */
export const CreateWorkOrderSchema = z.object({
  workOrderType: WorkOrderTypeSchema,
  templateId: UuidSchema,
  siteId: UuidSchema,
  assigneeId: UuidSchema,
  plannedCompletionAt: z.coerce.date(),
  title: z.string().trim().min(1).max(250),
}).strip();
export type CreateWorkOrderDto = z.infer<typeof CreateWorkOrderSchema>;

export const ListWorkOrdersQuerySchema = PaginationSchema.extend({
  status: TaskStatusSchema.optional(),
  workOrderType: WorkOrderTypeSchema.optional(),
  q: z.string().trim().max(100).optional(),
}).strip();
export type ListWorkOrdersQueryDto = z.infer<typeof ListWorkOrdersQuerySchema>;

/** How many work orders carry each status, before the status filter is applied — the numbers on the tabs. */
export type WorkOrderStatusCounts = Record<z.infer<typeof TaskStatusSchema> | 'ALL', number>;

export type WorkOrderPage<T> = Paginated<T> & { counts: WorkOrderStatusCounts };
