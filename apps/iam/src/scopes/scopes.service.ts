import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package — see
// the `output` comment in prisma/schema.prisma.
import type { PrismaClient } from '.prisma-client-iam';
import { uuidv7, type CreateOverrideDto } from '@ipms/contracts';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

@Injectable()
export class ScopesService {
  constructor(private readonly prisma: PrismaClient) {}

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
      await tx.userSiteScope.deleteMany({ where: { userId, projectId } });
      await this.emit(tx, SUBJECTS.IAM_SCOPE_REVOKED, { userId, level: 'PROJECT', projectId, siteId: null }, actorId);
      await this.audit(tx, actorId, 'scope.project_revoked', 'User', userId, { projectId }, {});
    });
  }

  async grantSite(userId: string, siteId: string, projectId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      const existing = await tx.userSiteScope.findUnique({ where: { userId_siteId: { userId, siteId } } });
      if (existing) return;

      await tx.userSiteScope.create({ data: { id: uuidv7(), userId, siteId, projectId, createdBy: actorId } });
      await this.emit(tx, SUBJECTS.IAM_SCOPE_GRANTED, { userId, level: 'SITE', projectId, siteId }, actorId);
      await this.audit(tx, actorId, 'scope.site_granted', 'User', userId, {}, { siteId, projectId });
    });
  }

  async revokeSite(userId: string, siteId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.userSiteScope.deleteMany({ where: { userId, siteId } });
      if (count === 0) return;
      await this.emit(tx, SUBJECTS.IAM_SCOPE_REVOKED, { userId, level: 'SITE', projectId: null, siteId }, actorId);
      await this.audit(tx, actorId, 'scope.site_revoked', 'User', userId, { siteId }, {});
    });
  }

  async createOverride(userId: string, dto: CreateOverrideDto, actorId: string): Promise<void> {
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
      await this.audit(tx, actorId, 'override.created', 'User', userId, {}, {
        permissionCode: dto.permissionCode, effect: dto.effect, validUntil: dto.validUntil ?? null, reason: dto.reason,
      });
    });
  }

  async revokeOverride(overrideId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.userPermissionOverride.findUnique({ where: { id: overrideId } });
      if (!existing) throw new NotFoundException('Override not found');
      await tx.userPermissionOverride.delete({ where: { id: overrideId } });
      await this.audit(tx, actorId, 'override.revoked', 'User', existing.userId, { overrideId }, {});
    });
  }

  async listForUser(userId: string) {
    const [projects, sites, overrides] = await Promise.all([
      this.prisma.userProjectScope.findMany({ where: { userId } }),
      this.prisma.userSiteScope.findMany({ where: { userId } }),
      this.prisma.userPermissionOverride.findMany({ where: { userId }, include: { permission: true } }),
    ]);
    return {
      projectIds: projects.map((p) => p.projectId),
      siteIds: sites.map((s) => s.siteId),
      overrides: overrides.map((o) => ({
        id: o.id, permissionCode: o.permission.code, effect: o.effect,
        projectId: o.projectId, siteId: o.siteId,
        validFrom: o.validFrom?.toISOString() ?? null,
        validUntil: o.validUntil?.toISOString() ?? null,
        reason: o.reason,
      })),
    };
  }
}
