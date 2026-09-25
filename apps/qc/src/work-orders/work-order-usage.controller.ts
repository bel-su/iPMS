import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import type { AuthzUser } from '@ipms/authz';
import { UuidSchema } from '@ipms/contracts';
import { WorkOrderService } from './work-order.service.js';

/**
 * Service-to-service only: the gateway refuses every '/internal/' path.
 *
 * `project` calls this before deleting a project or a site, forwarding the
 * deleting user's own token: a work order outliving its site would point at
 * nothing. Checked against the verb the caller is using rather than one fixed
 * permission, since the two deletes are granted separately.
 */
@Controller('internal/work-orders')
export class WorkOrderUsageController {
  constructor(private readonly workOrders: WorkOrderService) {}

  @Get('usage')
  usage(@Query('projectId') projectId: string | undefined, @Query('siteId') siteId: string | undefined, @Req() req: { user: AuthzUser }) {
    const needed = siteId ? 'site.delete' : 'project.delete';
    if (!req.user.permissions.includes(needed)) throw new ForbiddenException(`Checking work order usage needs ${needed}`);
    return this.workOrders.usage({
      projectId: projectId ? UuidSchema.parse(projectId) : undefined,
      siteId: siteId ? UuidSchema.parse(siteId) : undefined,
    });
  }
}
