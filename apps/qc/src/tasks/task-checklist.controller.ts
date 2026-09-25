import {
  ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Req,
} from '@nestjs/common';
import type { AuthzUser } from '@ipms/authz';
import { UuidSchema } from '@ipms/contracts';
import { TemplateQueries } from '../templates/template.queries.js';
import { TaskLookupClient, requireTask } from './task-lookup.client.js';

/** Carries no @RequirePermission: access follows task assignment, which only project knows. */
@Controller('qc/tasks')
export class TaskChecklistController {
  constructor(private readonly tasks: TaskLookupClient, private readonly queries: TemplateQueries) {}

  @Get(':taskId/checklist')
  async checklist(@Param('taskId') taskId: string, @Req() req: { user: AuthzUser; headers: Record<string, string | undefined> }) {
    const id = UuidSchema.parse(taskId);
    const task = requireTask(await this.tasks.fetch(id, req.headers['authorization'] ?? ''));
    if (task.assigneeId !== req.user.id && !req.user.permissions.includes('qc_template.view')) {
      throw new ForbiddenException('This task is not assigned to you');
    }
    if (!task.templateId) throw new NotFoundException('This task has no checklist assigned');
    const current = await this.queries.currentTree(task.templateId);
    if (!current) throw new NotFoundException('The checklist assigned to this task no longer exists');
    if (current.template.disabledAt) throw new ConflictException('This checklist has been disabled');
    if (!current.version) throw new ConflictException('This checklist has not been published yet');
    return { task: { id: task.id, projectId: task.projectId, siteId: task.siteId }, template: current.template, version: current.version };
  }
}
