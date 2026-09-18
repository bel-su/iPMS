import { Injectable, NotFoundException } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package — see
// the `output` comment in prisma/schema.prisma.
import type { PrismaClient } from '.prisma-client-iam';
import { check, type AuthzOverride, type AuthzScope, type AuthzUser } from '@ipms/authz';
import type { AccessCheckDto, AccessCheckResult, EffectivePermission } from '@ipms/contracts';

interface LoadedUser {
  id: string;
  isActive: boolean;
  tokenVersion: number;
  roles: Array<{
    role: { code: string; isActive: boolean; permissions: Array<{ permission: { code: string } }> };
    validFrom: Date | null; validUntil: Date | null;
  }>;
  projectScopes: Array<{ projectId: string }>;
  siteScopes: Array<{ siteId: string }>;
  overrides: Array<{
    permission: { code: string }; effect: string;
    projectId: string | null; siteId: string | null;
    validFrom: Date | null; validUntil: Date | null; reason: string;
  }>;
}

function isLive(validFrom: Date | null, validUntil: Date | null, now: Date): boolean {
  if (validFrom && now < validFrom) return false;
  if (validUntil && now > validUntil) return false;
  return true;
}

@Injectable()
export class EffectiveService {
  constructor(private readonly prisma: PrismaClient) {}

  private async load(userId: string): Promise<LoadedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        projectScopes: true,
        siteScopes: true,
        overrides: { include: { permission: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user as unknown as LoadedUser;
  }

  private toAuthzUser(user: LoadedUser, now: Date): AuthzUser {
    const live = user.roles.filter((a) => a.role.isActive && isLive(a.validFrom, a.validUntil, now));
    return {
      id: user.id,
      isActive: user.isActive,
      tokenVersion: user.tokenVersion,
      roles: [...new Set(live.map((a) => a.role.code))],
      permissions: [...new Set(live.flatMap((a) => a.role.permissions.map((rp) => rp.permission.code)))],
    };
  }

  private toScope(user: LoadedUser): AuthzScope {
    return {
      global: false,
      projectIds: user.projectScopes.map((s) => s.projectId),
      siteIds: user.siteScopes.map((s) => s.siteId),
    };
  }

  private toOverrides(user: LoadedUser, now: Date): AuthzOverride[] {
    return user.overrides
      .filter((o) => isLive(o.validFrom, o.validUntil, now))
      .map((o) => ({
        permission: o.permission.code,
        effect: o.effect as 'ALLOW' | 'DENY',
        projectId: o.projectId,
        siteId: o.siteId,
        validFrom: o.validFrom,
        validUntil: o.validUntil,
      }));
  }

  /** Every effective permission with the source that produced it. */
  async forUser(userId: string): Promise<EffectivePermission[]> {
    const now = new Date();
    const user = await this.load(userId);
    const scope = this.toScope(user);
    const scopeLevel = scope.siteIds.length > 0 ? 'SITE' : scope.projectIds.length > 0 ? 'PROJECT' : 'GLOBAL';

    const result = new Map<string, EffectivePermission>();

    const liveRoles = user.roles.filter((a) => a.role.isActive && isLive(a.validFrom, a.validUntil, now));
    for (const assignment of liveRoles) {
      for (const rp of assignment.role.permissions) {
        result.set(rp.permission.code, {
          code: rp.permission.code, granted: true, source: 'ROLE',
          sourceDetail: assignment.role.code, scopeLevel,
        });
      }
    }

    for (const o of user.overrides) {
      if (!isLive(o.validFrom, o.validUntil, now)) continue;
      result.set(o.permission.code, {
        code: o.permission.code,
        granted: o.effect === 'ALLOW',
        source: o.effect === 'ALLOW' ? 'OVERRIDE_ALLOW' : 'OVERRIDE_DENY',
        sourceDetail: o.reason,
        scopeLevel: o.siteId ? 'SITE' : o.projectId ? 'PROJECT' : scopeLevel,
      });
    }

    return [...result.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Runs the real authorization path. This calls the same `check` used by every
   * guard, so the simulator cannot drift from actual enforcement.
   */
  async simulate(dto: AccessCheckDto): Promise<AccessCheckResult> {
    const now = new Date();
    const user = await this.load(dto.userId);

    const decision = check({
      user: this.toAuthzUser(user, now),
      permission: dto.permissionCode,
      scope: this.toScope(user),
      overrides: this.toOverrides(user, now),
      now,
    });

    return { allowed: decision.allowed, reason: decision.reason, checks: decision.checks };
  }
}
