import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { AssignTaskSchema, CreateMilestoneSchema, CreateProjectSchema, CreateSiteSchema, CreateTaskSchema, CreateTaskTypeSchema, ListTasksQuerySchema, UpdateProjectSchema, UuidSchema } from '@ipms/contracts';
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
  @Post('tasks/:id/assign') @RequirePermission('task.assign') assign(@Param('id') id:string,@Body() body:unknown){ return this.service.assignTask(UuidSchema.parse(id),AssignTaskSchema.parse(body)); }
}
