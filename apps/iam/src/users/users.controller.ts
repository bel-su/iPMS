import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import type { AuthzUser } from '@ipms/authz';
import {
  AssignRolesSchema, CreateUserSchema, ResetPasswordSchema,
  UpdateUserSchema, UserListQuerySchema, UuidSchema,
} from '@ipms/contracts';
import { UsersService } from './users.service.js';

/**
 * The object gate — which users this actor may touch — is applied in
 * `UsersService`, not here. The actor's roles are passed down rather than
 * decided here so a future caller reaching the service directly cannot bypass
 * it, and so the rule has exactly one implementation.
 */
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermission('user.view')
  async list(@Query() query: unknown) {
    return this.users.list(UserListQuerySchema.parse(query));
  }

  /**
   * Not object-gated: `user.view` grants the directory, and a project manager
   * needs an administrator's name to know who to ask. What they cannot do is
   * change one.
   */
  @Get('users/:id')
  @RequirePermission('user.view')
  async get(@Param('id') id: string) {
    return this.users.get(UuidSchema.parse(id));
  }

  @Post('users')
  @RequirePermission('user.create')
  async create(@Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.users.create(CreateUserSchema.parse(body), req.user.id, req.user.roles);
  }

  @Patch('users/:id')
  @RequirePermission('user.update')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.users.update(UuidSchema.parse(id), UpdateUserSchema.parse(body), req.user.id, req.user.roles);
  }

  /**
   * Deactivates. There is no hard-delete route and no `user.delete`
   * permission: audit entries, task assignees and QC submissions all reference
   * user ids, and a removed row turns every one of them into an unresolvable
   * reference.
   */
  @Delete('users/:id')
  @RequirePermission('user.deactivate')
  async deactivate(@Param('id') id: string, @Req() req: { user: AuthzUser }) {
    return this.users.deactivate(UuidSchema.parse(id), req.user.id, req.user.roles);
  }

  @Post('users/:id/reactivate')
  @RequirePermission('user.update')
  async reactivate(@Param('id') id: string, @Req() req: { user: AuthzUser }) {
    return this.users.reactivate(UuidSchema.parse(id), req.user.id, req.user.roles);
  }

  /** PUT, not PATCH: the body is the complete desired set, so the write is idempotent. */
  @Put('users/:id/roles')
  @RequirePermission('role.assign')
  async setRoles(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.users.setRoles(UuidSchema.parse(id), AssignRolesSchema.parse(body), req.user.id, req.user.roles);
  }

  @Post('users/:id/reset-password')
  @RequirePermission('user.update')
  async resetPassword(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.users.resetPassword(UuidSchema.parse(id), ResetPasswordSchema.parse(body), req.user.id, req.user.roles);
  }
}
