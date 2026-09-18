import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import { PERMISSIONS } from '@ipms/authz';
import { CloneRoleSchema, CreateRoleSchema, UpdateRoleSchema, UuidSchema } from '@ipms/contracts';
import type { AuthzUser } from '@ipms/authz';
import { RolesService } from './roles.service.js';

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @RequirePermission('role.view')
  async list() {
    return this.roles.list();
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
