import 'server-only';
import type {
  AssignTaskDto,
  CreateMilestoneDto,
  CreateProjectDto,
  CreateSiteInput,
  CreateTaskDto,
  CreateTaskTypeDto,
  CreateWorkOrderDto,
  SiteImportCommitDto,
  SiteImportPreviewDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
  UpdateSiteDto,
  UpdateTaskDto,
  UpdateTaskTypeDto,
  WorkOrderPage,
  WorkOrderType,
} from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * The Project service's public surface, as reached through the gateway.
 *
 * Request shapes come from `@ipms/contracts` — the same schemas the service
 * parses with — so a field renamed there stops this app from compiling rather
 * than producing a 422 at runtime. The imports are type-only on purpose: the
 * contracts barrel pulls in `node:crypto` and zod, which have no business in
 * this app's bundle when only the shapes are needed.
 *
 * Response shapes are declared here rather than in contracts because they are
 * Prisma models, which contracts does not describe. They are written as the
 * wire sees them, which is not quite the service's own types: `DateTime`
 * arrives as an ISO string and `Decimal` as a string, because that is what
 * JSON.stringify makes of them.
 */

export type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type SiteStatus = 'PLANNED' | 'IN_DELIVERY' | 'COMPLETED' | 'BLOCKED';
export type TaskStatus = 'NOT_STARTED' | 'ONGOING' | 'REVIEWING' | 'RECTIFYING' | 'COMPLETED' | 'CANCELLED';

export interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  phase: string | null;
  status: ProjectStatus;
  startDate: string | null;
  targetDate: string | null;
  defaultGeofenceRadiusM: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Region { id: string; projectId: string; name: string }

export interface Site {
  id: string;
  projectId: string;
  regionId: string | null;
  siteCode: string;
  name: string;
  /** Prisma Decimal, serialized by its own toJSON. */
  latitude: string | null;
  longitude: string | null;
  geofenceMode: 'INHERIT' | 'CUSTOM' | 'OFF';
  geofenceRadiusM: number | null;
  address: string | null;
  city: string | null;
  area: string | null;
  scopeVariant: string | null;
  status: SiteStatus;
}

export interface TaskType {
  id: string; projectId: string; code: string; name: string; category: string;
  templateId: string | null; order: number; isActive: boolean;
}

export interface MilestoneRequirement { milestoneId: string; taskTypeId: string }

export interface Milestone {
  id: string; projectId: string; code: string; name: string;
  kind: 'PROJECT' | 'CONTRACT'; sequence: number; targetDate: string | null;
}

export interface Task {
  /** Null for a work order, which is raised against a checklist template instead of a task type. */
  id: string; projectId: string; siteId: string; taskTypeId: string | null; templateId: string | null;
  /** Set only on a work order; `templateName` is the template's name when it was raised. */
  workOrderType: WorkOrderType | null; templateName: string | null;
  title: string; status: TaskStatus; assigneeId: string | null;
  plannedCompletionAt: string | null; actualCompletionAt: string | null;
  currentSubmissionId: string | null; origin: 'PLANNED' | 'AD_HOC'; createdBy: string;
}

/** A work order as the list returns it: the task with the site columns the list shows. */
export type WorkOrder = Task & { site: { siteCode: string; name: string; city: string | null; area: string | null } };

export interface WorkOrderFilter {
  status?: TaskStatus | undefined;
  workOrderType?: WorkOrderType | undefined;
  q?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

/** `listProjects` counts sites and tasks rather than returning them. */
export type ProjectListEntry = Project & { _count: { sites: number; tasks: number } };

/** `getProject` returns the project with its sites, task types and milestones expanded. */
export type ProjectDetail = Project & {
  sites: (Site & { region: Region | null })[];
  taskTypes: TaskType[];
  milestones: (Milestone & { requirements: MilestoneRequirement[] })[];
  _count: { tasks: number };
};

export interface DashboardProject {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  phase: string | null;
  _count: { sites: number };
}

export interface ProjectDashboard {
  activeProjectCount: number;
  sitesInDelivery: number;
  pendingReviews: number;
  rectifyingTasks: number;
  projects: DashboardProject[];
}

export type DashboardResult = ApiResult<ProjectDashboard>;

/** Calls the gateway, never the Project service directly, preserving one public API boundary. */
export async function getProjectDashboard(): Promise<DashboardResult> {
  return authFetch<ProjectDashboard>('/api/v1/dashboard');
}

export async function listProjects(): Promise<ApiResult<ProjectListEntry[]>> {
  return authFetch<ProjectListEntry[]>('/api/v1/projects');
}

export async function getProject(id: string): Promise<ApiResult<ProjectDetail>> {
  return authFetch<ProjectDetail>(`/api/v1/projects/${id}`);
}

export async function createProject(project: CreateProjectDto): Promise<ApiResult<Project>> {
  return authFetch<Project>('/api/v1/projects', { method: 'POST', json: project });
}

export async function updateProject(id: string, changes: UpdateProjectDto): Promise<ApiResult<Project>> {
  return authFetch<Project>(`/api/v1/projects/${id}`, { method: 'PATCH', json: changes });
}

export async function createSite(projectId: string, site: CreateSiteInput): Promise<ApiResult<Site>> {
  return authFetch<Site>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', json: site });
}

export async function createTaskType(projectId: string, taskType: CreateTaskTypeDto): Promise<ApiResult<TaskType>> {
  return authFetch<TaskType>(`/api/v1/projects/${projectId}/task-types`, { method: 'POST', json: taskType });
}

export async function createMilestone(projectId: string, milestone: CreateMilestoneDto): Promise<ApiResult<Milestone>> {
  return authFetch<Milestone>(`/api/v1/projects/${projectId}/milestones`, { method: 'POST', json: milestone });
}

export async function createTask(projectId: string, task: CreateTaskDto): Promise<ApiResult<Task>> {
  return authFetch<Task>(`/api/v1/projects/${projectId}/tasks`, { method: 'POST', json: task });
}

/** Assignment is addressed by task, not by project — `/api/v1/tasks` is its own gateway prefix. */
export async function assignTask(taskId: string, assignment: AssignTaskDto): Promise<ApiResult<Task>> {
  return authFetch<Task>(`/api/v1/tasks/${taskId}/assign`, { method: 'POST', json: assignment });
}

export async function listTasks(projectId: string, filter: { siteId?: string; status?: TaskStatus } = {}): Promise<ApiResult<Task[]>> {
  return authFetch<Task[]>(`/api/v1/projects/${projectId}/tasks`, { query: filter });
}

export async function listWorkOrders(projectId: string, filter: WorkOrderFilter = {}): Promise<ApiResult<WorkOrderPage<WorkOrder>>> {
  return authFetch<WorkOrderPage<WorkOrder>>(`/api/v1/projects/${projectId}/work-orders`, {
    query: {
      status: filter.status,
      workOrderType: filter.workOrderType,
      q: filter.q,
      page: filter.page === undefined ? undefined : String(filter.page),
      limit: filter.limit === undefined ? undefined : String(filter.limit),
    },
  });
}

/** Creates the work order already assigned; the service checks the template is published, enabled and of the right category. */
export async function createWorkOrder(projectId: string, workOrder: CreateWorkOrderDto): Promise<ApiResult<WorkOrder>> {
  return authFetch<WorkOrder>(`/api/v1/projects/${projectId}/work-orders`, { method: 'POST', json: workOrder });
}

export async function updateSite(id: string, changes: UpdateSiteDto): Promise<ApiResult<Site>> {
  return authFetch<Site>(`/api/v1/sites/${id}`, { method: 'PATCH', json: changes });
}

export async function updateTaskType(id: string, changes: UpdateTaskTypeDto): Promise<ApiResult<TaskType>> {
  return authFetch<TaskType>(`/api/v1/task-types/${id}`, { method: 'PATCH', json: changes });
}

export async function updateMilestone(id: string, changes: UpdateMilestoneDto): Promise<ApiResult<Milestone>> {
  return authFetch<Milestone>(`/api/v1/milestones/${id}`, { method: 'PATCH', json: changes });
}

export async function updateTask(id: string, changes: UpdateTaskDto): Promise<ApiResult<Task>> {
  return authFetch<Task>(`/api/v1/tasks/${id}`, { method: 'PATCH', json: changes });
}

/** Archiving is the ordinary end of a project's life; `deleteProject` is the irreversible one. */
export async function archiveProject(id: string): Promise<ApiResult<Project>> {
  return authFetch<Project>(`/api/v1/projects/${id}/archive`, { method: 'POST' });
}

export async function deleteProject(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/projects/${id}`, { method: 'DELETE' });
}

export async function deleteSite(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/sites/${id}`, { method: 'DELETE' });
}

export async function deleteTaskType(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/task-types/${id}`, { method: 'DELETE' });
}

export async function deleteMilestone(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/milestones/${id}`, { method: 'DELETE' });
}

export async function deleteTask(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/tasks/${id}`, { method: 'DELETE' });
}


/**
 * Uploads a workbook for validation. Writes nothing: the report it returns is
 * what the manager confirms, and `importable` is the payload commit takes.
 */
export async function previewSiteImport(projectId: string, file: File): Promise<ApiResult<SiteImportPreviewDto>> {
  const body = new FormData();
  body.set('file', file, file.name);
  return authFetch<SiteImportPreviewDto>(`/api/v1/projects/${projectId}/sites/import/preview`, { method: 'POST', body });
}

export async function commitSiteImport(projectId: string, payload: SiteImportCommitDto): Promise<ApiResult<{ created: number; updated: number }>> {
  return authFetch(`/api/v1/projects/${projectId}/sites/import/commit`, { method: 'POST', json: payload });
}
