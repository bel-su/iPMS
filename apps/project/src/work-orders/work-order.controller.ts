import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzScope, type AuthzUser } from '@ipms/authz';
import {
  CancelWorkOrderSchema, CreateWorkOrdersSchema, ListWorkOrdersQuerySchema, UpdateWorkOrderSchema, UuidSchema,
} from '@ipms/contracts';
import { ScopeOf } from '../http/scope.decorator.js';
import { WorkOrderService } from './work-order.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

/**
 * Work orders are created within a project (a batch of its sites) and read
 * across projects: `/work-orders` is the workspace queue, filtered by project
 * when the caller wants one.
 */
@Controller()
export class WorkOrderController {
  constructor(private readonly workOrders: WorkOrderService) {}

  @Get('work-orders') @RequirePermission('task.view')
  list(@ScopeOf() scope: AuthzScope, @Query() query: unknown) {
    return this.workOrders.list(scope, ListWorkOrdersQuerySchema.parse(query));
  }

  @Get('work-orders/:id') @RequirePermission('task.view')
  get(@ScopeOf() scope: AuthzScope, @Param('id') id: string) {
    return this.workOrders.get(scope, UuidSchema.parse(id));
  }

  /** Reassigning is the assign verb; moving the date goes with it, since both decide who does what by when. */
  @Patch('work-orders/:id') @RequirePermission('task.assign')
  update(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.workOrders.update(scope, UuidSchema.parse(id), UpdateWorkOrderSchema.parse(body), req.user.id);
  }

  @Post('work-orders/:id/cancel') @RequirePermission('task.cancel')
  cancel(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.workOrders.cancel(scope, UuidSchema.parse(id), CancelWorkOrderSchema.parse(body), req.user.id);
  }

  /**
   * A work order is created already assigned, so it takes both verbs. The
   * guard checks one permission per route; the second is checked here, against
   * the same resolved permission set.
   */
  @Post('projects/:id/work-orders') @RequirePermission('task.create')
  create(@ScopeOf() scope: AuthzScope, @Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    if (!req.user.permissions.includes('task.assign')) throw new ForbiddenException('Creating a work order assigns it, which needs task.assign');
    return this.workOrders.create(scope, UuidSchema.parse(id), CreateWorkOrdersSchema.parse(body), req.user.id, req.headers['authorization'] ?? '');
  }

  @Get('projects/:id/work-orders/assignable') @RequirePermission('task.assign')
  assignable(@ScopeOf() scope: AuthzScope, @Param('id') id: string) {
    return this.workOrders.assignable(scope, UuidSchema.parse(id));
  }
}
