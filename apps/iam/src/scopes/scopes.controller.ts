import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import { CreateOverrideSchema, UuidSchema } from '@ipms/contracts';
import type { AuthzUser } from '@ipms/authz';
import { ScopesService } from './scopes.service.js';

@Controller()
export class ScopesController {
  constructor(private readonly scopes: ScopesService) {}

  @Get('users/:id/scopes')
  @RequirePermission('scope.view')
  async listForUser(@Param('id') id: string) {
    return this.scopes.listForUser(UuidSchema.parse(id));
  }

  @Post('users/:id/projects')
  @RequirePermission('scope.grant')
  async grantProject(
    @Param('id') id: string,
    @Body() body: { projectId: string },
    @Req() req: { user: AuthzUser },
  ) {
    await this.scopes.grantProject(UuidSchema.parse(id), UuidSchema.parse(body.projectId), req.user.id);
    return { status: 'ok' };
  }

  @Delete('users/:id/projects')
  @RequirePermission('scope.revoke')
  async revokeProject(
    @Param('id') id: string,
    @Body() body: { projectId: string },
    @Req() req: { user: AuthzUser },
  ) {
    await this.scopes.revokeProject(UuidSchema.parse(id), UuidSchema.parse(body.projectId), req.user.id);
    return { status: 'ok' };
  }

  @Post('users/:id/sites')
  @RequirePermission('scope.grant')
  async grantSite(
    @Param('id') id: string,
    @Body() body: { siteId: string; projectId: string },
    @Req() req: { user: AuthzUser },
  ) {
    await this.scopes.grantSite(UuidSchema.parse(id), UuidSchema.parse(body.siteId), UuidSchema.parse(body.projectId), req.user.id);
    return { status: 'ok' };
  }

  @Delete('users/:id/sites')
  @RequirePermission('scope.revoke')
  async revokeSite(
    @Param('id') id: string,
    @Body() body: { siteId: string },
    @Req() req: { user: AuthzUser },
  ) {
    await this.scopes.revokeSite(UuidSchema.parse(id), UuidSchema.parse(body.siteId), req.user.id);
    return { status: 'ok' };
  }

  @Post('users/:id/permission-overrides')
  @RequirePermission('override.create')
  async createOverride(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: { user: AuthzUser },
  ) {
    await this.scopes.createOverride(UuidSchema.parse(id), CreateOverrideSchema.parse(body), req.user.id);
    return { status: 'ok' };
  }

  @Delete('users/:id/permission-overrides/:overrideId')
  @RequirePermission('override.revoke')
  async revokeOverride(
    @Param('overrideId') overrideId: string,
    @Req() req: { user: AuthzUser },
  ) {
    await this.scopes.revokeOverride(UuidSchema.parse(overrideId), req.user.id);
    return { status: 'ok' };
  }
}
