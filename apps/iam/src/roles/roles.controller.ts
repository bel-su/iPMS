import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission, mayAssign } from '@ipms/authz';
import { PERMISSIONS } from '@ipms/authz';
import { CloneRoleSchema, CreateRoleSchema, UpdateRoleSchema, UuidSchema } from '@ipms/contracts';
import type { AuthzUser } from '@ipms/authz';
import { RolesService } from './roles.service.js';

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /**
   * Each role carries whether *this caller* may confer it.
   *
   * The assignable-roles table lives in `@ipms/authz`, which a Next build
   * cannot import — its barrel reaches `@nestjs/common`, and the web app's
   * only other option would be a second copy of the rule that could drift from
   * this one. Reporting the answer per role keeps one implementation: the web
   * filters its role checkboxes on this flag and knows nothing about the table.
   *
   * It is presentation support, not enforcement. `UsersService` applies the
   * same table to every write regardless of what any client renders.
   */
  @Get('roles')
  @RequirePermission('role.view')
  async list(@Req() req: { user: AuthzUser }) {
    const roles = await this.roles.list();
    return roles.map((role) => ({ ...role, assignable: mayAssign(req.user.roles, role.code) }));
  }

  @Get('roles/:id')
  @RequirePermission('role.view')
  async get(@Param('id') id: string) {
    return this.roles.get(UuidSchema.parse(id));
  }

  @Post('roles')
  @RequirePermission('role.create')
  async create(@Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.roles.create(CreateRoleSchema.parse(body), req.user.id);
  }

  @Patch('roles/:id')
  @RequirePermission('role.update')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.roles.update(
      UuidSchema.parse(id), UpdateRoleSchema.parse(body),
      req.user.id, req.user.roles.includes('SUPER_ADMIN'),
    );
  }

  @Post('roles/:id/clone')
  @RequirePermission('role.create')
  async clone(@Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.roles.clone(CloneRoleSchema.parse(body), req.user.id);
  }

  @Delete('roles/:id')
  @RequirePermission('role.delete')
  async deactivate(@Param('id') id: string, @Req() req: { user: AuthzUser }) {
    return this.roles.deactivate(UuidSchema.parse(id), req.user.id);
  }

  @Get('permissions')
  @RequirePermission('permission.view')
  async permissions() {
    return PERMISSIONS;
  }

  @Get('permissions/grouped')
  @RequirePermission('permission.view')
  async grouped() {
    const groups = new Map<string, typeof PERMISSIONS[number][]>();
    for (const p of PERMISSIONS) {
      const bucket = groups.get(p.module) ?? [];
      bucket.push(p);
      groups.set(p.module, bucket);
    }
    return [...groups.entries()].map(([module, permissions]) => ({ module, permissions }));
  }
}
