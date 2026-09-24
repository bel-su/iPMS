import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzScope, type AuthzUser } from '@ipms/authz';
import { CreateWorkOrderSchema, ListWorkOrdersQuerySchema, UuidSchema } from '@ipms/contracts';
import { ScopeOf } from '../http/scope.decorator.js';
import { WorkOrderService } from './work-order.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

@Controller('projects/:id/work-orders')
export class WorkOrderController {
  constructor(private readonly workOrders: WorkOrderService) {}

  @Get() @RequirePermission('task.view')
  list(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Query() query: unknown) {
    return this.workOrders.list(scope, UuidSchema.parse(id), ListWorkOrdersQuerySchema.parse(query));
  }

  /**
   * A work order is created already assigned, so it takes both verbs. The
   * guard checks one permission per route; the second is checked here, against
   * the same resolved permission set.
   */
  @Post() @RequirePermission('task.create')
  create(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    if (!req.user.permissions.includes('task.assign')) throw new ForbiddenException('Creating a work order assigns it, which needs task.assign');
    return this.workOrders.create(scope, UuidSchema.parse(id), CreateWorkOrderSchema.parse(body), req.user.id, req.headers['authorization'] ?? '');
  }
}
