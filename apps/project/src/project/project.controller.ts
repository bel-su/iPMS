import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { AssignTaskSchema, CreateMilestoneSchema, CreateProjectSchema, CreateSiteSchema, CreateTaskSchema, CreateTaskTypeSchema, ListTasksQuerySchema, UpdateMilestoneSchema, UpdateProjectSchema, UpdateSiteSchema, UpdateTaskSchema, UpdateTaskTypeSchema, UuidSchema } from '@ipms/contracts';
import { ProjectService } from './project.service.js';
@Controller() export class ProjectController { constructor(private readonly service: ProjectService) {}
  @Get('dashboard') @RequirePermission('project.view') dashboard(){ return this.service.dashboard(); }
  @Get('projects') @RequirePermission('project.view') list(){ return this.service.listProjects(); }
  @Get('projects/:id') @RequirePermission('project.view') get(@Param('id') id:string){ return this.service.getProject(UuidSchema.parse(id)); }
  @Get('projects/:id/tasks') @RequirePermission('task.view') tasks(@Param('id') id:string,@Query() query:unknown){ return this.service.listTasks(UuidSchema.parse(id),ListTasksQuerySchema.parse(query)); }
  @Post('projects') @RequirePermission('project.create') create(@Body() body:unknown){ return this.service.createProject(CreateProjectSchema.parse(body)); }
  @Patch('projects/:id') @RequirePermission('project.update') update(@Param('id') id:string,@Body() body:unknown){ return this.service.updateProject(UuidSchema.parse(id),UpdateProjectSchema.parse(body)); }
  @Post('projects/:id/sites') @RequirePermission('site.create') site(@Param('id') id:string,@Body() body:unknown){ return this.service.createSite(UuidSchema.parse(id),CreateSiteSchema.parse(body)); }
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
