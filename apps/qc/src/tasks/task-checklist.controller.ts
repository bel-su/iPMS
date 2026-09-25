import {
  ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Req,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/qc';
import type { AuthzUser } from '@ipms/authz';
import { UuidSchema } from '@ipms/contracts';
import { PrismaService } from '../prisma.service.js';
import { TemplateQueries } from '../templates/template.queries.js';

/**
 * The checklist a work order's assignee fills in. Addressed by `taskId`, the
 * name the field app has always used; it is the work order's id.
 *
 * Carries no @RequirePermission: access follows assignment.
 */
@Controller('qc/tasks')
export class TaskChecklistController {
  private readonly db: PrismaClient;

  constructor(prisma: PrismaService, private readonly queries: TemplateQueries) { this.db = prisma.db; }

  @Get(':taskId/checklist')
  async checklist(@Param('taskId') taskId: string, @Req() req: { user: AuthzUser }) {
    const id = UuidSchema.parse(taskId);
    const order = await this.db.workOrder.findUnique({ where: { id }, select: { id: true, projectId: true, siteId: true, assigneeId: true, templateId: true } });
    if (!order) throw new NotFoundException('Work order not found');
    if (order.assigneeId !== req.user.id && !req.user.permissions.includes('qc_template.view')) {
      throw new ForbiddenException('This work order is not assigned to you');
    }
    const current = await this.queries.currentTree(order.templateId);
    if (!current) throw new NotFoundException('The checklist assigned to this work order no longer exists');
    if (current.template.disabledAt) throw new ConflictException('This checklist has been disabled');
    if (!current.version) throw new ConflictException('This checklist has not been published yet');
    return { task: { id: order.id, projectId: order.projectId, siteId: order.siteId }, template: current.template, version: current.version };
  }
}
