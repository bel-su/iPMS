import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { AssignTaskSchema, CreateMilestoneSchema, CreateProjectSchema, CreateSiteSchema, CreateTaskSchema, CreateTaskTypeSchema, ListTasksQuerySchema, UpdateMilestoneSchema, UpdateProjectSchema, UpdateSiteSchema, UpdateTaskSchema, UpdateTaskTypeSchema, UuidSchema } from '@ipms/contracts';
import { SiteImportCommitSchema } from '@ipms/contracts';
import { buildTemplate } from './import/template.js';
import { SiteImportService } from './import/site-import.service.js';
import { ProjectService } from './project.service.js';
@Controller() export class ProjectController { constructor(private readonly service: ProjectService, private readonly imports: SiteImportService) {}
  @Get('dashboard') @RequirePermission('project.view') dashboard(){ return this.service.dashboard(); }
  /** Service-to-service only: the gateway refuses every '/internal/' path. Still permission-checked, because the caller forwards the submitting user's own token. */
  @Get('internal/sites/:id/geofence') @RequirePermission('site.view') siteGeofence(@Param('id') id:string){ return this.service.siteGeofence(UuidSchema.parse(id)); }
  @Get('projects') @RequirePermission('project.view') list(){ return this.service.listProjects(); }
  @Get('projects/:id') @RequirePermission('project.view') get(@Param('id') id:string){ return this.service.getProject(UuidSchema.parse(id)); }
  @Get('projects/:id/tasks') @RequirePermission('task.view') tasks(@Param('id') id:string,@Query() query:unknown){ return this.service.listTasks(UuidSchema.parse(id),ListTasksQuerySchema.parse(query)); }
  @Post('projects') @RequirePermission('project.create') create(@Body() body:unknown){ return this.service.createProject(CreateProjectSchema.parse(body)); }
  @Patch('projects/:id') @RequirePermission('project.update') update(@Param('id') id:string,@Body() body:unknown){ return this.service.updateProject(UuidSchema.parse(id),UpdateProjectSchema.parse(body)); }
  @Post('projects/:id/sites') @RequirePermission('site.create') site(@Param('id') id:string,@Body() body:unknown){ return this.service.createSite(UuidSchema.parse(id),CreateSiteSchema.parse(body)); }
  @Get('projects/:id/sites/import/template') @RequirePermission('site.import') async template(@Param('id') id:string,@Res() reply:FastifyReply){ const project=await this.service.getProject(UuidSchema.parse(id)); const file=await buildTemplate(project.defaultGeofenceRadiusM); return reply.header('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition',`attachment; filename="sites-${project.code}.xlsx"`).send(file); }
  @Post('projects/:id/sites/import/preview') @RequirePermission('site.import') async previewImport(@Param('id') id:string,@Req() req:FastifyRequest){ const file=await req.file(); if(!file) throw new BadRequestException('Attach an .xlsx file in a "file" field'); return this.imports.preview(UuidSchema.parse(id),await file.toBuffer()); }
  @Post('projects/:id/sites/import/commit') @RequirePermission('site.import') commitImport(@Param('id') id:string,@Body() body:unknown){ return this.imports.commit(UuidSchema.parse(id),SiteImportCommitSchema.parse(body)); }
  @Post('projects/:id/task-types') @RequirePermission('task.create') taskType(@Param('id') id:string,@Body() body:unknown){ return this.service.createTaskType(UuidSchema.parse(id),CreateTaskTypeSchema.parse(body)); }
  @Post('projects/:id/milestones') @RequirePermission('milestone.create') milestone(@Param('id') id:string,@Body() body:unknown){ return this.service.createMilestone(UuidSchema.parse(id),CreateMilestoneSchema.parse(body)); }
  @Post('projects/:id/tasks') @RequirePermission('task.create') task(@Param('id') id:string,@Body() body:unknown,@Req() req:{user:AuthzUser}){ return this.service.createTask(UuidSchema.parse(id),CreateTaskSchema.parse(body),req.user.id); }
  @Post('projects/:id/archive') @RequirePermission('project.archive') archive(@Param('id') id:string){ return this.service.archiveProject(UuidSchema.parse(id)); }
  @Delete('projects/:id') @RequirePermission('project.delete') remove(@Param('id') id:string){ return this.service.deleteProject(UuidSchema.parse(id)); }
  @Delete('sites/:id') @RequirePermission('site.delete') removeSite(@Param('id') id:string){ return this.service.deleteSite(UuidSchema.parse(id)); }
  @Delete('task-types/:id') @RequirePermission('task.update') removeTaskType(@Param('id') id:string){ return this.service.deleteTaskType(UuidSchema.parse(id)); }
  @Delete('milestones/:id') @RequirePermission('milestone.update') removeMilestone(@Param('id') id:string){ return this.service.deleteMilestone(UuidSchema.parse(id)); }
  @Delete('tasks/:id') @RequirePermission('task.delete') removeTask(@Param('id') id:string){ return this.service.deleteTask(UuidSchema.parse(id)); }
  @Patch('sites/:id') @RequirePermission('site.update') updateSite(@Param('id') id:string,@Body() body:unknown){ return this.service.updateSite(UuidSchema.parse(id),UpdateSiteSchema.parse(body)); }
  @Patch('task-types/:id') @RequirePermission('task.update') updateTaskType(@Param('id') id:string,@Body() body:unknown){ return this.service.updateTaskType(UuidSchema.parse(id),UpdateTaskTypeSchema.parse(body)); }
  @Patch('milestones/:id') @RequirePermission('milestone.update') updateMilestone(@Param('id') id:string,@Body() body:unknown){ return this.service.updateMilestone(UuidSchema.parse(id),UpdateMilestoneSchema.parse(body)); }
  @Patch('tasks/:id') @RequirePermission('task.update') updateTask(@Param('id') id:string,@Body() body:unknown){ return this.service.updateTask(UuidSchema.parse(id),UpdateTaskSchema.parse(body)); }
  @Post('tasks/:id/assign') @RequirePermission('task.assign') assign(@Param('id') id:string,@Body() body:unknown){ return this.service.assignTask(UuidSchema.parse(id),AssignTaskSchema.parse(body)); }
}
