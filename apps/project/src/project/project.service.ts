import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import { resolveGeofenceRadius, type GeofenceMode } from '@ipms/geo';
import type { AuthzScope } from '@ipms/authz';
import { projectScope, siteScope, visibleProject, visibleSite, visibleTask, visibleViaProject } from '../scope/project-scope.js';
import { scopeWhere } from '@ipms/authz';
import { uuidv7, type AssignTaskDto, type CreateMilestoneDto, type CreateProjectDto, type CreateSiteDto, type CreateTaskDto, type CreateTaskTypeDto, type ListTasksQueryDto, type UpdateMilestoneDto, type UpdateProjectDto, type UpdateSiteDto, type UpdateTaskDto, type UpdateTaskTypeDto } from '@ipms/contracts';

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaClient) {}
  async listProjects(scope: AuthzScope) { return this.prisma.project.findMany({ where: projectScope(scope), orderBy: { updatedAt: 'desc' }, include: { _count: { select: { sites: true, tasks: true } } } }); }
  /**
   * The nested `sites` list is scoped as well as the project itself. Reaching a
   * project through a single site grant must not hand back every other site in
   * it -- without the inner filter, one site grant reads the whole project's
   * site list.
   */
  async getProject(scope: AuthzScope, id: string) {
    const project = await this.prisma.project.findFirst({
      where: visibleProject(scope, id),
      include: {
        sites: { where: siteScope(scope), include: { region: true }, orderBy: { siteCode: 'asc' } },
        taskTypes: { orderBy: { order: 'asc' } },
        milestones: { include: { requirements: true }, orderBy: { sequence: 'asc' } },
        _count: { select: { tasks: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }
  /** Ordered by id, which is a uuidv7 and therefore time-ordered — Task has no createdAt column. */
  async listTasks(scope: AuthzScope, projectId: string, query: ListTasksQueryDto) {
    await this.requireProject(scope, projectId);
    // The caller's own filters are ANDed with the scope fragment rather than
    // spread beside it: scopeWhere returns an `OR` key, and a sibling `OR` from
    // a future filter would collide and silently drop one of them.
    return this.prisma.task.findMany({
      where: {
        AND: [
          { projectId },
          scopeWhere(scope),
          ...(query.siteId ? [{ siteId: query.siteId }] : []),
          ...(query.status ? [{ status: query.status }] : []),
        ],
      },
      orderBy: { id: 'desc' },
    });
  }
  async createProject(dto: CreateProjectDto) { try { return await this.prisma.project.create({ data: { id: uuidv7(), code: dto.code, name: dto.name, clientName: dto.clientName ?? null, phase: dto.phase ?? null, startDate: dto.startDate ?? null, targetDate: dto.targetDate ?? null, defaultGeofenceRadiusM: dto.defaultGeofenceRadiusM === undefined ? 500 : dto.defaultGeofenceRadiusM, status: 'DRAFT' } }); } catch { throw new BadRequestException('Project code is already in use'); } }
  async updateProject(scope: AuthzScope, id: string, dto: UpdateProjectDto) { await this.requireProject(scope, id); return this.prisma.project.update({ where: { id }, data: { ...(dto.name === undefined ? {} : { name: dto.name }), ...(dto.clientName === undefined ? {} : { clientName: dto.clientName }), ...(dto.phase === undefined ? {} : { phase: dto.phase }), ...(dto.startDate === undefined ? {} : { startDate: dto.startDate }), ...(dto.targetDate === undefined ? {} : { targetDate: dto.targetDate }), ...(dto.defaultGeofenceRadiusM === undefined ? {} : { defaultGeofenceRadiusM: dto.defaultGeofenceRadiusM }), ...(dto.status === undefined ? {} : { status: dto.status }) } }); }
  async createSite(scope: AuthzScope, projectId: string, dto: CreateSiteDto) { await this.requireProject(scope, projectId); let regionId: string | null = null; if (dto.regionName) { const region = await this.prisma.region.upsert({ where: { projectId_name: { projectId, name: dto.regionName } }, update: {}, create: { id: uuidv7(), projectId, name: dto.regionName } }); regionId = region.id; } try { return await this.prisma.site.create({ data: { id: uuidv7(), projectId, regionId, siteCode: dto.siteCode, name: dto.name, latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, geofenceMode: dto.geofenceMode, geofenceRadiusM: dto.geofenceRadiusM ?? null, address: dto.address ?? null, city: dto.city ?? null, area: dto.area ?? null, scopeVariant: dto.scopeVariant ?? null } }); } catch { throw new BadRequestException('Site code is already in use in this project'); } }
  async createTaskType(scope: AuthzScope, projectId: string, dto: CreateTaskTypeDto) { await this.requireProject(scope, projectId); try { return await this.prisma.taskType.create({ data: { id: uuidv7(), projectId, code: dto.code, name: dto.name, category: dto.category, templateId: dto.templateId ?? null, order: dto.order ?? 0 } }); } catch { throw new BadRequestException('Task type code is already in use in this project'); } }
  async createMilestone(scope: AuthzScope, projectId: string, dto: CreateMilestoneDto) { await this.requireProject(scope, projectId); const types = dto.taskTypeIds.length ? await this.prisma.taskType.count({ where: { id: { in: dto.taskTypeIds }, projectId } }) : 0; if (types !== dto.taskTypeIds.length) throw new BadRequestException('Every required task type must belong to this project'); try { return await this.prisma.$transaction(async (tx) => { const milestone = await tx.milestone.create({ data: { id: uuidv7(), projectId, code: dto.code, name: dto.name, kind: dto.kind, sequence: dto.sequence, targetDate: dto.targetDate ?? null } }); if (dto.taskTypeIds.length) await tx.milestoneRequirement.createMany({ data: dto.taskTypeIds.map((taskTypeId) => ({ milestoneId: milestone.id, taskTypeId })) }); return milestone; }); } catch (error) { if (error instanceof BadRequestException) throw error; throw new BadRequestException('Milestone code is already in use in this project'); } }
  async createTask(scope: AuthzScope, projectId: string, dto: CreateTaskDto, actorId: string) { await this.requireProject(scope, projectId); const [site, taskType] = await Promise.all([this.prisma.site.findFirst({ where: { AND: [{ id: dto.siteId, projectId }, siteScope(scope)] } }), this.prisma.taskType.findFirst({ where: { id: dto.taskTypeId, projectId } })]); if (!site || !taskType) throw new BadRequestException('Site and task type must belong to this project'); if (dto.origin === 'PLANNED') { const existing = await this.prisma.task.findFirst({ where: { siteId: dto.siteId, taskTypeId: dto.taskTypeId, origin: 'PLANNED' } }); if (existing) throw new BadRequestException('A planned task already exists for this site and task type'); } return this.prisma.task.create({ data: { id: uuidv7(), projectId, siteId:dto.siteId, taskTypeId:dto.taskTypeId, title:dto.title, origin:dto.origin, assigneeId:dto.assigneeId ?? null, plannedCompletionAt:dto.plannedCompletionAt ?? null, createdBy: actorId, templateId: dto.templateId ?? taskType.templateId } }); }
  async assignTask(scope: AuthzScope, id: string, dto: AssignTaskDto) { await this.requireTask(scope, id); return this.prisma.task.update({ where: { id }, data: { assigneeId: dto.assigneeId } }); }
  async updateSite(scope: AuthzScope, id:string,dto:UpdateSiteDto){ const site=await this.requireSite(scope, id); let regionId:string|null|undefined; if(dto.regionName===null){ regionId=null; } else if(dto.regionName){ const region=await this.prisma.region.upsert({where:{projectId_name:{projectId:site.projectId,name:dto.regionName}},update:{},create:{id:uuidv7(),projectId:site.projectId,name:dto.regionName}}); regionId=region.id; } const data={...(dto.siteCode===undefined?{}:{siteCode:dto.siteCode}),...(dto.name===undefined?{}:{name:dto.name}),...(dto.latitude===undefined?{}:{latitude:dto.latitude}),...(dto.longitude===undefined?{}:{longitude:dto.longitude}),...(dto.geofenceMode===undefined?{}:{geofenceMode:dto.geofenceMode}),...(dto.geofenceRadiusM===undefined?{}:{geofenceRadiusM:dto.geofenceRadiusM}),...(dto.address===undefined?{}:{address:dto.address}),...(dto.city===undefined?{}:{city:dto.city}),...(dto.area===undefined?{}:{area:dto.area}),...(dto.scopeVariant===undefined?{}:{scopeVariant:dto.scopeVariant}),...(dto.status===undefined?{}:{status:dto.status}),...(regionId===undefined?{}:{regionId})}; try{ return await this.prisma.site.update({where:{id},data}); }catch{ throw new BadRequestException('Site code is already in use in this project'); } }
  async updateTaskType(scope: AuthzScope, id:string,dto:UpdateTaskTypeDto){ await this.requireTaskType(scope, id); try{ return await this.prisma.taskType.update({where:{id},data:{...(dto.code===undefined?{}:{code:dto.code}),...(dto.name===undefined?{}:{name:dto.name}),...(dto.category===undefined?{}:{category:dto.category}),...(dto.templateId===undefined?{}:{templateId:dto.templateId}),...(dto.order===undefined?{}:{order:dto.order}),...(dto.isActive===undefined?{}:{isActive:dto.isActive})}}); }catch{ throw new BadRequestException('Task type code is already in use in this project'); } }
  async updateMilestone(scope: AuthzScope, id:string,dto:UpdateMilestoneDto){ const milestone=await this.requireMilestone(scope, id); if(dto.taskTypeIds){ const found=dto.taskTypeIds.length?await this.prisma.taskType.count({where:{id:{in:dto.taskTypeIds},projectId:milestone.projectId}}):0; if(found!==dto.taskTypeIds.length) throw new BadRequestException('Every required task type must belong to this project'); } const data={...(dto.code===undefined?{}:{code:dto.code}),...(dto.name===undefined?{}:{name:dto.name}),...(dto.kind===undefined?{}:{kind:dto.kind}),...(dto.sequence===undefined?{}:{sequence:dto.sequence}),...(dto.targetDate===undefined?{}:{targetDate:dto.targetDate})}; return this.prisma.$transaction(async(tx)=>{ const saved=await tx.milestone.update({where:{id},data}); if(dto.taskTypeIds){ await tx.milestoneRequirement.deleteMany({where:{milestoneId:id}}); if(dto.taskTypeIds.length) await tx.milestoneRequirement.createMany({data:dto.taskTypeIds.map((taskTypeId)=>({milestoneId:id,taskTypeId}))}); } return saved; }); }
  /** Sets status; it does not police transitions — that is the tracking plan's Task 11. */
  async updateTask(scope: AuthzScope, id:string,dto:UpdateTaskDto){ await this.requireTask(scope, id); return this.prisma.task.update({where:{id},data:{...(dto.title===undefined?{}:{title:dto.title}),...(dto.status===undefined?{}:{status:dto.status}),...(dto.assigneeId===undefined?{}:{assigneeId:dto.assigneeId}),...(dto.plannedCompletionAt===undefined?{}:{plannedCompletionAt:dto.plannedCompletionAt})}}); }
  async archiveProject(scope: AuthzScope, id:string){ await this.requireProject(scope, id); return this.prisma.project.update({where:{id},data:{status:'CANCELLED'}}); }
  /** Refuses while tasks remain: the schema cascades Project to its sites, task types, milestones and tasks, so this would take the lot. */
  async deleteProject(scope: AuthzScope, id:string){ await this.requireProject(scope, id); const tasks=await this.prisma.task.count({where:{projectId:id}}); if(tasks>0) throw new ConflictException(`This project still has ${tasks} task(s). Delete them, or archive the project instead.`); await this.prisma.project.delete({where:{id}}); }
  async deleteSite(scope: AuthzScope, id:string){ await this.requireSite(scope, id); const tasks=await this.prisma.task.count({where:{siteId:id}}); if(tasks>0) throw new ConflictException(`This site still has ${tasks} task(s). Delete them first.`); await this.prisma.site.delete({where:{id}}); }
  /** Checked here rather than caught from Prisma's onDelete:Restrict, so the message can say which way out there is. */
  async deleteTaskType(scope: AuthzScope, id:string){ await this.requireTaskType(scope, id); const tasks=await this.prisma.task.count({where:{taskTypeId:id}}); if(tasks>0) throw new ConflictException(`This task type is used by ${tasks} task(s). Deactivate it instead.`); await this.prisma.taskType.delete({where:{id}}); }
  async deleteMilestone(scope: AuthzScope, id:string){ await this.requireMilestone(scope, id); await this.prisma.milestone.delete({where:{id}}); }
  async deleteTask(scope: AuthzScope, id:string){ const task=await this.requireTask(scope, id); if(task.currentSubmissionId) throw new ConflictException('This task has a QC submission. Cancel the task instead of deleting it.'); await this.prisma.task.delete({where:{id}}); }
  /**
   * Coordinates and effective radius for one site, for the qc service.
   *
   * Decimal columns arrive as Prisma `Decimal`; they are narrowed to `number`
   * here so the caller never has to know which driver produced them.
   */
  async siteGeofence(id: string): Promise<{ latitude: number | null; longitude: number | null; effectiveRadiusM: number | null }> {
    const site = await this.prisma.site.findUnique({ where: { id }, include: { project: { select: { defaultGeofenceRadiusM: true } } } });
    if (!site) throw new NotFoundException('Site not found');
    return {
      latitude: site.latitude === null ? null : Number(site.latitude),
      longitude: site.longitude === null ? null : Number(site.longitude),
      effectiveRadiusM: resolveGeofenceRadius(
        { geofenceMode: site.geofenceMode as GeofenceMode, geofenceRadiusM: site.geofenceRadiusM },
        { defaultGeofenceRadiusM: site.project.defaultGeofenceRadiusM },
      ),
    };
  }
  async internalTask(id: string): Promise<{ id: string; projectId: string; siteId: string; assigneeId: string | null; templateId: string | null; status: string }> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true, projectId: true, siteId: true, assigneeId: true, templateId: true, status: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
  /** Every count is scoped: an unscoped tally leaks the shape of the whole platform. */
  async dashboard(scope: AuthzScope) {
    const visible = projectScope(scope);
    const tasks = scopeWhere(scope);
    const [projects, reviewCount, rectifying] = await Promise.all([
      this.prisma.project.findMany({ where: { AND: [{ status: 'ACTIVE' }, visible] }, include: { _count: { select: { sites: { where: siteScope(scope) } } } }, take: 12, orderBy: { updatedAt: 'desc' } }),
      this.prisma.task.count({ where: { AND: [{ status: 'REVIEWING' }, tasks] } }),
      this.prisma.task.count({ where: { AND: [{ status: 'RECTIFYING' }, tasks] } }),
    ]);
    return { activeProjectCount: projects.length, sitesInDelivery: projects.reduce((total, p) => total + p._count.sites, 0), pendingReviews: reviewCount, rectifyingTasks: rectifying, projects };
  }
  /**
   * The five guards below are where scope is enforced for almost every method
   * in this service: each one already funnelled through them, so they are the
   * one place that has to be right.
   *
   * NotFound, never Forbidden, and the scope filter is part of the lookup
   * rather than a check after it. A 403 would confirm the id names something
   * real, which is exactly what an enumeration attack is looking for, and a
   * fetch-then-check would have already read the row it is meant to protect.
   */
  private async requireProject(scope: AuthzScope, id: string) {
    if (!await this.prisma.project.findFirst({ where: visibleProject(scope, id), select: { id: true } })) {
      throw new NotFoundException('Project not found');
    }
  }
  private async requireSite(scope: AuthzScope, id: string) {
    const site = await this.prisma.site.findFirst({ where: visibleSite(scope, id) });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }
  private async requireTaskType(scope: AuthzScope, id: string) {
    const taskType = await this.prisma.taskType.findFirst({ where: visibleViaProject(scope, id) });
    if (!taskType) throw new NotFoundException('Task type not found');
    return taskType;
  }
  private async requireMilestone(scope: AuthzScope, id: string) {
    const milestone = await this.prisma.milestone.findFirst({ where: visibleViaProject(scope, id) });
    if (!milestone) throw new NotFoundException('Milestone not found');
    return milestone;
  }
  private async requireTask(scope: AuthzScope, id: string) {
    const task = await this.prisma.task.findFirst({ where: visibleTask(scope, id) });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
