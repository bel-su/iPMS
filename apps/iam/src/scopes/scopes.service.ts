import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package — see
// the `output` comment in prisma/schema.prisma.
import type { PrismaClient } from '@prisma-clients/iam';
import { uuidv7, type CreateOverrideDto } from '@ipms/contracts';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import type { TokenVersionStore } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface OverrideView {
  id: string;
  permissionCode: string;
  effect: string;
  projectId: string | null;
  siteId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  reason: string;
}

@Injectable()
export class ScopesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly versions: TokenVersionStore,
    private readonly tokens: TokenService,
  ) {}

  private async emit(tx: Tx, subject: string, payload: JsonObject, actorId: string): Promise<void> {
    await tx.outboxEvent.create({
      data: buildOutboxRecord(subject, payload, getCorrelationId() ?? 'unknown', actorId),
    });
  }

  private async audit(
    tx: Tx, actorId: string, action: string, objectType: string, objectId: string,
    previousState: JsonObject, newState: JsonObject,
  ): Promise<void> {
    await this.emit(tx, SUBJECTS.AUDIT_EVENT, {
      actorId, action, objectType, objectId, previousState, newState, details: {},
    }, actorId);
  }

  /**
   * Kills every outstanding token for a user, immediately.
   *
   * Global overrides are resolved into the JWT `permissions` claim at issuance
   * (`resolvePermissions`), which is where the architecture puts permission
   * codes. That makes a token stale the moment an override changes, and without
   * this the change would not be enforced until the access token expired — up
   * to 15 minutes. A suspension that starts a quarter of an hour late is not a
   * suspension.
   *
   * This reuses `AuthService`'s `TokenVersionStore` port rather than opening a
   * second path to Redis, so there is exactly one place that knows how a
   * revocation is published.
   *
   * The row update runs inside the caller's transaction and the publish runs
   * inside the same callback, before commit. That ordering is deliberate: if
   * the transaction then rolls back, Redis holds a *higher* version than the
   * database and every outstanding token for the user is refused until they log
   * in again (which republishes the database's value). That is the fail-closed
   * direction. Publishing after commit would invert it — a failed publish would
   * leave a revoked token working for its full TTL.
   */
  private async revokeTokens(tx: Tx, userId: string): Promise<void> {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.versions.publish(userId, updated.tokenVersion, this.tokens.refreshTtlSeconds);
  }

  async grantProject(userId: string, projectId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      const existing = await tx.userProjectScope.findUnique({ where: { userId_projectId: { userId, projectId } } });
      if (existing) return;   // idempotent: no duplicate row, no duplicate event

      await tx.userProjectScope.create({ data: { id: uuidv7(), userId, projectId, createdBy: actorId } });
      await this.emit(tx, SUBJECTS.IAM_SCOPE_GRANTED, { userId, level: 'PROJECT', projectId, siteId: null }, actorId);
      await this.audit(tx, actorId, 'scope.project_granted', 'User', userId, {}, { projectId });
    });
  }

  async revokeProject(userId: string, projectId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.userProjectScope.deleteMany({ where: { userId, projectId } });
      if (count === 0) return;

      // Sites under a revoked project must go too, or the user keeps orphaned site access.
      // Read them before deleting: after the delete there is nothing left to name.
      const cascaded = await tx.userSiteScope.findMany({ where: { userId, projectId } });
      await tx.userSiteScope.deleteMany({ where: { userId, projectId } });

      await this.emit(tx, SUBJECTS.IAM_SCOPE_REVOKED, { userId, level: 'PROJECT', projectId, siteId: null }, actorId);

      /**
       * One SITE-level event per cascaded row, rather than a list of site ids
       * inside the PROJECT payload. Consumers cache scope keyed by site and
       * already handle `{level: 'SITE', siteId}` from `revokeSite`, so this
       * needs no new payload shape and no consumer change — whereas an id array
       * would only be honoured by a consumer that had been taught to look for
       * it, and a consumer that had not would keep the orphaned sites. Duplicate
       * delivery is harmless: every consumer deduplicates on `eventId`.
       */
      for (const site of cascaded) {
        await this.emit(
          tx, SUBJECTS.IAM_SCOPE_REVOKED,
          { userId, level: 'SITE', projectId: site.projectId, siteId: site.siteId },
          actorId,
        );
      }

      await this.audit(tx, actorId, 'scope.project_revoked', 'User', userId, { projectId }, {});
    });
  }

  async grantSite(userId: string, siteId: string, projectId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      /**
       * `projectId` arrives in the request body and was previously trusted. A
       * grant naming a project the user holds no scope for was accepted, and
       * `revokeProject`'s cascade filters on `projectId` — so that row could
       * never be reached by the revoke meant to clean it up, leaving site
       * access that no project revoke can remove.
       *
       * Whether the *site* actually belongs to the project cannot be checked
       * here: sites are owned by the `project` service and iam holds no copy.
       * Requiring the user to already hold the project scope is the strongest
       * check available locally, and it is the one that keeps the cascade
       * whole. Sub-project 2 should add the site↔project check against the
       * replicated projection.
       */
      const projectScope = await tx.userProjectScope.findUnique({
        where: { userId_projectId: { userId, projectId } },
      });
      if (!projectScope) {
        throw new BadRequestException('User does not hold project scope for the given projectId');
      }

      const existing = await tx.userSiteScope.findUnique({ where: { userId_siteId: { userId, siteId } } });
      if (existing) return;

      await tx.userSiteScope.create({ data: { id: uuidv7(), userId, siteId, projectId, createdBy: actorId } });
      await this.emit(tx, SUBJECTS.IAM_SCOPE_GRANTED, { userId, level: 'SITE', projectId, siteId }, actorId);
      await this.audit(tx, actorId, 'scope.site_granted', 'User', userId, {}, { siteId, projectId });
    });
  }

  async revokeSite(userId: string, siteId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Read first: the payload needs the row's `projectId`, which is
      // non-nullable on the row and was previously hardcoded to `null` — leaving
      // consumers unable to tell which project's site had gone.
      const existing = await tx.userSiteScope.findUnique({ where: { userId_siteId: { userId, siteId } } });
      if (!existing) return;

      await tx.userSiteScope.delete({ where: { id: existing.id } });
      await this.emit(
        tx, SUBJECTS.IAM_SCOPE_REVOKED,
        { userId, level: 'SITE', projectId: existing.projectId, siteId },
        actorId,
      );
      await this.audit(tx, actorId, 'scope.site_revoked', 'User', userId, { siteId, projectId: existing.projectId }, {});
    });
  }

  /**
   * `actorPermissions` is the actor's own *resolved* permission set — the JWT
   * claim, which already has global overrides applied. It is passed in rather
   * than re-derived from the request so that the check runs against the same
   * set enforcement uses.
   */
  async createOverride(
    userId: string,
    dto: CreateOverrideDto,
    actorId: string,
    actorPermissions: string[],
  ): Promise<void> {
    /**
     * Two escalation rules, checked before anything is written.
     *
     * The dependency closure of `override.create` is `override.view` +
     * `permission.view`. While overrides were inert that was harmless; enforcing
     * them turns the endpoint into a self-escalation primitive, where its holder
     * posts an ALLOW for `role.delete` against their own id and then grants
     * themselves the whole catalogue.
     */
    if (userId === actorId) {
      // DENY included. A self-DENY is not an escalation, but it is still an
      // actor editing their own authorization, which the audit story must be
      // able to exclude.
      throw new ForbiddenException('An override may not target the actor who creates it');
    }
    if (dto.effect === 'ALLOW' && !actorPermissions.includes(dto.permissionCode)) {
      // No such rule for DENY: removing a permission grants nothing, and an
      // administrator suspending a permission they do not hold themselves is a
      // legitimate and common case.
      throw new ForbiddenException('Cannot grant a permission the actor does not hold');
    }

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if (validFrom && validUntil && validUntil < validFrom) {
      throw new BadRequestException('validUntil must be after validFrom');
    }

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      const permission = await tx.permission.findUnique({ where: { code: dto.permissionCode } });
      if (!permission) throw new BadRequestException(`Unknown permission code: ${dto.permissionCode}`);

      await tx.userPermissionOverride.create({
        data: {
          id: uuidv7(), userId, permissionId: permission.id, effect: dto.effect,
          projectId: dto.projectId ?? null, siteId: dto.siteId ?? null,
          validFrom, validUntil, reason: dto.reason, createdBy: actorId,
        },
      });
      await this.revokeTokens(tx, userId);
      await this.audit(tx, actorId, 'override.created', 'User', userId, {}, {
        permissionCode: dto.permissionCode, effect: dto.effect, validUntil: dto.validUntil ?? null, reason: dto.reason,
      });
    });
  }

  /**
   * `userId` comes from the route's `:id` and is not decorative. The lookup used
   * to be by override id alone, so a stale or guessed id mutated a third party
   * while every URL-based access log attributed the change to the user in the
   * path. `NotFoundException`, not `Forbidden`: the override's existence must
   * not be disclosed to someone who guessed its id.
   */
  async revokeOverride(userId: string, overrideId: string, actorId: string): Promise<void> {
    // The same self-service escalation `createOverride` refuses, reached through
    // a cheaper permission. `override.revoke`'s dependency closure is only
    // `override.view`, so a suspended user holding it could delete the DENY
    // override suspending them; the revoke bumps their own `tokenVersion`, so
    // their next token is minted with the permission restored. An actor must
    // never edit their own authorization, in either direction.
    if (userId === actorId) {
      throw new ForbiddenException('An actor cannot revoke an override on their own account');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.userPermissionOverride.findUnique({ where: { id: overrideId } });
      if (!existing || existing.userId !== userId) throw new NotFoundException('Override not found');

      await tx.userPermissionOverride.delete({ where: { id: overrideId } });
      await this.revokeTokens(tx, userId);
      await this.audit(tx, actorId, 'override.revoked', 'User', userId, { overrideId }, {});
    });
  }

  /** Project and site scope only — see `listOverridesForUser` for the rest. */
  async listForUser(userId: string): Promise<{ global: boolean; projectIds: string[]; siteIds: string[] }> {
    const [globalScope, projects, sites] = await Promise.all([
      this.prisma.userGlobalScope.findUnique({ where: { userId } }),
      this.prisma.userProjectScope.findMany({ where: { userId } }),
      this.prisma.userSiteScope.findMany({ where: { userId } }),
    ]);
    return {
      // Reported alongside the lists rather than inferred from them being
      // empty. Empty lists mean "granted nothing", which is the opposite of
      // global reach, and conflating the two is how a scope screen ends up
      // telling an operator the reverse of the truth.
      global: globalScope !== null,
      projectIds: projects.map((p) => p.projectId),
      siteIds: sites.map((s) => s.siteId),
    };
  }

  /**
   * Global reach for one user: they see every project and every site.
   *
   * `revokeTokens` runs on both paths, unlike the project and site grants.
   * Those only change replicated scope, which each service re-reads from its
   * own projection on the next request. Global scope changes the answer to
   * *every* authorization question at once, so leaving outstanding tokens alive
   * for up to their full TTL after a revocation is not acceptable -- the same
   * reasoning `createOverride` uses.
   */
  async grantGlobal(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      // The same self-escalation rule createOverride enforces, applied to the
      // largest grant the system can make.
      throw new ForbiddenException('An actor cannot grant global scope to their own account');
    }
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      const existing = await tx.userGlobalScope.findUnique({ where: { userId } });
      if (existing) return;   // idempotent: no duplicate row, no duplicate event

      await tx.userGlobalScope.create({ data: { id: uuidv7(), userId, createdBy: actorId } });
      await this.revokeTokens(tx, userId);
      await this.emit(tx, SUBJECTS.IAM_SCOPE_GRANTED, { userId, level: 'GLOBAL', projectId: null, siteId: null }, actorId);
      await this.audit(tx, actorId, 'scope.global_granted', 'User', userId, {}, { level: 'GLOBAL' });
    });
  }

  async revokeGlobal(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      // Symmetrical with grantGlobal, and with revokeOverride: an actor must
      // never edit their own authorization in either direction.
      throw new ForbiddenException('An actor cannot revoke global scope from their own account');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.userGlobalScope.deleteMany({ where: { userId } });
      if (count === 0) return;

      await this.revokeTokens(tx, userId);
      await this.emit(tx, SUBJECTS.IAM_SCOPE_REVOKED, { userId, level: 'GLOBAL', projectId: null, siteId: null }, actorId);
      await this.audit(tx, actorId, 'scope.global_revoked', 'User', userId, { level: 'GLOBAL' }, {});
    });
  }

  /**
   * Separate from `listForUser` because it is separately guarded.
   *
   * Overrides carry a free-text `reason` — the most sensitive field in the
   * model, holding text like "suspended pending HR investigation". Returning
   * them from the scopes endpoint exposed that to any holder of `scope.view`,
   * whose dependency closure does not include `override.view`, so
   * `override.view` was enforced nowhere at all. This method backs
   * `GET /users/:id/permission-overrides`, which requires it.
   */
  async listOverridesForUser(userId: string): Promise<OverrideView[]> {
    const overrides = await this.prisma.userPermissionOverride.findMany({
      where: { userId }, include: { permission: true },
    });
    return overrides.map((o) => ({
      id: o.id, permissionCode: o.permission.code, effect: o.effect,
      projectId: o.projectId, siteId: o.siteId,
      validFrom: o.validFrom?.toISOString() ?? null,
      validUntil: o.validUntil?.toISOString() ?? null,
      reason: o.reason,
    }));
  }
}
