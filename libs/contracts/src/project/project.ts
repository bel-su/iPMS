import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

export const ProjectStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
export const SiteStatusSchema = z.enum(['PLANNED', 'IN_DELIVERY', 'COMPLETED', 'BLOCKED']);
export const TaskStatusSchema = z.enum(['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING', 'COMPLETED', 'CANCELLED']);
export const MilestoneKindSchema = z.enum(['PROJECT', 'CONTRACT']);

export const CreateProjectSchema = z.object({
  code: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
  clientName: z.string().trim().max(200).optional(),
  phase: z.string().trim().max(100).optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
}).strip();
export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;
export const UpdateProjectSchema = CreateProjectSchema.omit({ code: true }).partial().extend({ status: ProjectStatusSchema.optional() });
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;

export const CreateSiteSchema = z.object({
  siteCode: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
  regionName: z.string().trim().min(1).max(150).optional(),
  latitude: z.number().gte(-90).lte(90).optional(),
  longitude: z.number().gte(-180).lte(180).optional(),
  geofenceRadiusM: z.number().int().positive().max(100_000).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  area: z.string().max(100).optional(),
  scopeVariant: z.string().max(100).optional(),
}).strip();
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
