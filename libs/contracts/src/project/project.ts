import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

export const ProjectStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
export const SiteStatusSchema = z.enum(['PLANNED', 'IN_DELIVERY', 'COMPLETED', 'BLOCKED']);
export const TaskStatusSchema = z.enum(['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING', 'COMPLETED', 'CANCELLED']);
export const MilestoneKindSchema = z.enum(['PROJECT', 'CONTRACT']);
export const GeofenceModeSchema = z.enum(['INHERIT', 'CUSTOM', 'OFF']);
export const GeofenceRadiusSchema = z.number().int().positive().max(100_000);

export const CreateProjectSchema = z.object({
  code: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
  clientName: z.string().trim().max(200).optional(),
  phase: z.string().trim().max(100).optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
  defaultGeofenceRadiusM: GeofenceRadiusSchema.nullable().optional(),
}).strip();
export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;
export const UpdateProjectSchema = CreateProjectSchema.omit({ code: true }).partial().extend({ status: ProjectStatusSchema.optional() });
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;

/** The site fields as a plain object, so both schemas below can derive from it. */
const SiteFields = z.object({
  siteCode: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
  regionName: z.string().trim().min(1).max(150).optional(),
  latitude: z.number().gte(-90).lte(90).optional(),
  longitude: z.number().gte(-180).lte(180).optional(),
  geofenceMode: GeofenceModeSchema.default('INHERIT'),
  geofenceRadiusM: GeofenceRadiusSchema.nullable().optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  area: z.string().max(100).optional(),
  scopeVariant: z.string().max(100).optional(),
});

/** A CUSTOM site with no radius would resolve to "no check", which is the opposite of what CUSTOM means. */
const customNeedsRadius = (value: { geofenceMode?: string | undefined; geofenceRadiusM?: number | null | undefined }): boolean =>
  value.geofenceMode !== 'CUSTOM' || (value.geofenceRadiusM !== null && value.geofenceRadiusM !== undefined);

const CUSTOM_RADIUS_MESSAGE = { message: 'A custom geofence needs a radius in metres', path: ['geofenceRadiusM'] };

export const CreateSiteSchema = SiteFields.strip().refine(customNeedsRadius, CUSTOM_RADIUS_MESSAGE);
export type CreateSiteDto = z.infer<typeof CreateSiteSchema>;

export const CreateTaskTypeSchema = z.object({
  code: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  templateId: UuidSchema.optional(),
  order: z.number().int().min(0).optional(),
}).strip();
export type CreateTaskTypeDto = z.infer<typeof CreateTaskTypeSchema>;

export const CreateMilestoneSchema = z.object({
  code: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
  kind: MilestoneKindSchema,
  sequence: z.number().int().min(0),
  targetDate: z.coerce.date().optional(),
  taskTypeIds: z.array(UuidSchema).default([]),
}).strip();
export type CreateMilestoneDto = z.infer<typeof CreateMilestoneSchema>;

export const CreateTaskSchema = z.object({
  siteId: UuidSchema,
  taskTypeId: UuidSchema,
  title: z.string().trim().min(1).max(250),
  templateId: UuidSchema.optional(),
  assigneeId: UuidSchema.optional(),
  plannedCompletionAt: z.coerce.date().optional(),
  origin: z.enum(['PLANNED', 'AD_HOC']).default('AD_HOC'),
}).strip();
export type CreateTaskDto = z.infer<typeof CreateTaskSchema>;

export const AssignTaskSchema = z.object({ assigneeId: UuidSchema }).strip();
export type AssignTaskDto = z.infer<typeof AssignTaskSchema>;

/**
 * The update shapes.
 *
 * Each is its create schema made partial, so a validation rule is written once
 * and cannot drift between the two paths, plus the one field only an update
 * may set. `taskTypeIds` on a milestone update is a wholesale replacement of
 * the requirement set: absent leaves it alone, `[]` clears it. The explicit
 * `.extend` is what makes that possible — `.partial()` keeps the create
 * schema's `.default([])`, which would silently re-add an empty array.
 */
export const UpdateSiteSchema = SiteFields
  .partial()
  .extend({ status: SiteStatusSchema.optional() })
  .strip()
  .refine(customNeedsRadius, CUSTOM_RADIUS_MESSAGE);
export type UpdateSiteDto = z.infer<typeof UpdateSiteSchema>;

export const UpdateTaskTypeSchema = CreateTaskTypeSchema.partial().extend({ isActive: z.boolean().optional() });
export type UpdateTaskTypeDto = z.infer<typeof UpdateTaskTypeSchema>;

export const UpdateMilestoneSchema = CreateMilestoneSchema.partial().extend({ taskTypeIds: z.array(UuidSchema).optional() });
export type UpdateMilestoneDto = z.infer<typeof UpdateMilestoneSchema>;

/**
 * `assigneeId` is nullable rather than merely optional: absent means "leave
 * the assignee alone", null means "unassign", and a form needs both.
 */
export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).max(250).optional(),
  status: TaskStatusSchema.optional(),
  assigneeId: UuidSchema.nullable().optional(),
  plannedCompletionAt: z.coerce.date().nullable().optional(),
}).strip();
export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>;

export const ListTasksQuerySchema = z.object({
  siteId: UuidSchema.optional(),
  status: TaskStatusSchema.optional(),
}).strip();
export type ListTasksQueryDto = z.infer<typeof ListTasksQuerySchema>;
