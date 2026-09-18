import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '@ipms/authz';
import { CreateOverrideSchema, GrantScopeSchema, UuidSchema } from '@ipms/contracts';
import type { AuthzUser } from '@ipms/authz';
import { ScopesService, type OverrideView } from './scopes.service.js';

/**
 * Both site routes need a `projectId`, but `GrantScopeSchema` only requires one
 * for `level: 'PROJECT'` — its `SITE` branch leaves it optional. That
 * cross-field rule belongs in the schema in `@ipms/contracts` alongside the two
 * refinements already there; it is asserted here because that library is
 * outside this change. Until it moves, a `SITE` body without a `projectId` is a
 * 400 from this function rather than a `TypeError` deeper in the service.
 *
 * The previous shape — `@Body() body: { projectId: string }` plus a bare
 * `UuidSchema.parse(body.projectId)` — violated the constraint that every HTTP
 * boundary validates with a Zod schema from `@ipms/contracts`, and threw a
 * `TypeError` on a missing body, which without an exception filter is a 500
 * where a 400 belongs.
 */
function parseScope(body: unknown, level: 'PROJECT' | 'SITE'): { projectId: string; siteId: string | undefined } {
  const parsed = GrantScopeSchema.parse(body);
  if (parsed.level !== level) {
    throw new BadRequestException(`This endpoint takes ${level} scope; the body declares ${parsed.level}`);
  }
  // `GrantScopeSchema` guarantees `siteId` for SITE and `projectId` for
  // PROJECT; the missing half of each pair is asserted here.
  if (parsed.projectId === undefined) throw new BadRequestException('projectId is required');
  if (level === 'SITE' && parsed.siteId === undefined) throw new BadRequestException('siteId is required');
  return { projectId: parsed.projectId, siteId: parsed.siteId };
}

function parseSiteScope(body: unknown): { projectId: string; siteId: string } {
  const { projectId, siteId } = parseScope(body, 'SITE');
  return { projectId, siteId: siteId as string };
}

@Controller()
export class ScopesController {
  constructor(private readonly scopes: ScopesService) {}

  @Get('users/:id/scopes')
  @RequirePermission('scope.view')
  async listForUser(@Param('id') id: string) {
    return this.scopes.listForUser(UuidSchema.parse(id));
  }

  /**
   * Split out of `GET /users/:id/scopes` and guarded with `override.view`.
   * Overrides carry a free-text `reason` ("suspended pending HR
   * investigation"), and `scope.view`'s dependency closure does not include
   * `override.view` — so serving them from the scopes endpoint both leaked the
   * reason to scope viewers and left `override.view` enforced nowhere.
   */
  @Get('users/:id/permission-overrides')
  @RequirePermission('override.view')
  async listOverrides(@Param('id') id: string): Promise<OverrideView[]> {
    return this.scopes.listOverridesForUser(UuidSchema.parse(id));
  }

  @Post('users/:id/projects')
  @RequirePermission('scope.grant')
  async grantProject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: { user: AuthzUser },
  ) {
    const scope = parseScope(body, 'PROJECT');
    await this.scopes.grantProject(UuidSchema.parse(id), scope.projectId, req.user.id);
    return { status: 'ok' };
  }

  @Delete('users/:id/projects')
  @RequirePermission('scope.revoke')
  async revokeProject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: { user: AuthzUser },
  ) {
    const scope = parseScope(body, 'PROJECT');
    await this.scopes.revokeProject(UuidSchema.parse(id), scope.projectId, req.user.id);
    return { status: 'ok' };
  }

  @Post('users/:id/sites')
  @RequirePermission('scope.grant')
  async grantSite(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: { user: AuthzUser },
  ) {
    const scope = parseSiteScope(body);
    await this.scopes.grantSite(UuidSchema.parse(id), scope.siteId, scope.projectId, req.user.id);
    return { status: 'ok' };
  }

  @Delete('users/:id/sites')
  @RequirePermission('scope.revoke')
  async revokeSite(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: { user: AuthzUser },
  ) {
    const scope = parseSiteScope(body);
    await this.scopes.revokeSite(UuidSchema.parse(id), scope.siteId, req.user.id);
    return { status: 'ok' };
  }

  @Post('users/:id/permission-overrides')
  @RequirePermission('override.create')
  async createOverride(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: { user: AuthzUser },
  ) {
    // `req.user.permissions` is the actor's resolved claim — role grants with
    // global overrides already applied — so the escalation check runs against
    // the same set enforcement uses. Deriving it a second way here would let
    // the two disagree.
    await this.scopes.createOverride(
      UuidSchema.parse(id), CreateOverrideSchema.parse(body), req.user.id, req.user.permissions,
    );
    return { status: 'ok' };
  }

  @Delete('users/:id/permission-overrides/:overrideId')
  @RequirePermission('override.revoke')
  async revokeOverride(
    @Param('id') id: string,
    @Param('overrideId') overrideId: string,
    @Req() req: { user: AuthzUser },
  ) {
    // `:id` is passed through, not ignored: the service refuses an override that
    // belongs to a different user.
    await this.scopes.revokeOverride(UuidSchema.parse(id), UuidSchema.parse(overrideId), req.user.id);
    return { status: 'ok' };
  }
}
