import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package — see
// the `output` comment in prisma/schema.prisma.
import type { PrismaClient } from '@prisma-clients/iam';
import { mayAssign, mayManage } from '@ipms/authz';
import {
  uuidv7,
  type CreateUserDto, type UserListQuery, type UserResponse,
} from '@ipms/contracts';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import type { PasswordService } from '../auth/password.service.js';
import type { TokenVersionStore } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Every field a user response carries, and nothing else.
 *
 * Written as an explicit `select` rather than an `include` so `passwordHash`
 * cannot reach a client: an `include` returns every scalar column, and a
 * response built by spreading that row would start leaking the hash the first
 * time someone added a field to the response shape.
 */
const USER_SELECT = {
  id: true, username: true, email: true, fullName: true, employeeCode: true,
  isActive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true,
  roles: { select: { role: { select: { code: true, name: true } } } },
} as const;

interface UserRow {
  id: string;
  username: string;
  email: string;
  fullName: string;
  employeeCode: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: Array<{ role: { code: string; name: string } }>;
}

/**
 * Deduplicated, because a user can hold the same role globally and again scoped
 * to a project — two `UserRole` rows, one authority. The object gate must see
 * each code once or a project-scoped duplicate would read as a different role.
 */
function roleCodesOf(row: UserRow): string[] {
  return [...new Set(row.roles.map((assignment) => assignment.role.code))];
}

function toResponse(row: UserRow): UserResponse {
  const seen = new Map<string, string>();
  for (const assignment of row.roles) seen.set(assignment.role.code, assignment.role.name);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.fullName,
    employeeCode: row.employeeCode,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    roles: [...seen].map(([code, name]) => ({ code, name })),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly passwords: PasswordService,
    private readonly versions: TokenVersionStore,
    private readonly tokens: TokenService,
  ) {}

  private async emit(tx: Tx, subject: string, payload: JsonObject, actorId: string): Promise<void> {
    await tx.outboxEvent.create({
      data: buildOutboxRecord(subject, payload, getCorrelationId() ?? 'unknown', actorId),
    });
  }

  private async audit(
    tx: Tx, actorId: string, action: string, objectId: string,
    previousState: JsonObject, newState: JsonObject,
  ): Promise<void> {
    await this.emit(tx, SUBJECTS.AUDIT_EVENT, {
      actorId, action, objectType: 'User', objectId, previousState, newState, details: {},
    }, actorId);
  }

  /**
   * Kills every outstanding token for a user, immediately. Same shape and same
   * ordering as `ScopesService.revokeTokens`, deliberately: the row update runs
   * inside the caller's transaction and the publish inside the same callback,
   * before commit, so a rollback leaves Redis holding a *higher* version and
   * every outstanding token refused. Publishing after commit would invert that
   * and leave a revoked token working for its full TTL.
   */
  private async revokeTokens(tx: Tx, userId: string): Promise<void> {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.versions.publish(userId, updated.tokenVersion, this.tokens.refreshTtlSeconds);
  }

  /** Resolves the role rows for a set of codes, refusing any code with no row behind it. */
  private async resolveRoles(tx: Tx, codes: string[]): Promise<Array<{ id: string; code: string; name: string }>> {
    const unique = [...new Set(codes)];
    if (unique.length === 0) return [];
    const roles = await tx.role.findMany({ where: { code: { in: unique } } });
    if (roles.length !== unique.length) {
      const found = new Set(roles.map((role) => role.code));
      const missing = unique.filter((code) => !found.has(code));
      throw new BadRequestException(`Unknown role codes: ${missing.join(', ')}`);
    }
    return roles;
  }

  private assertMayAssign(actorRoleCodes: string[], codes: string[]): void {
    for (const code of codes) {
      if (!mayAssign(actorRoleCodes, code)) {
        throw new ForbiddenException(`You may not assign the role ${code}`);
      }
    }
  }

  /**
   * Loads a user and refuses the caller if the object gate says they may not
   * touch them. Used by every write; reads deliberately do not call it.
   */
  protected async loadManageable(tx: Tx, userId: string, actorRoleCodes: string[]): Promise<UserRow> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    if (!mayManage(actorRoleCodes, roleCodesOf(user as UserRow))) {
      // 403 rather than 404: `user.view` already grants the directory, so the
      // user's existence is not a secret from this caller.
      throw new ForbiddenException('You may not manage this user');
    }
    return user as UserRow;
  }

  async list(query: UserListQuery): Promise<{ items: UserResponse[]; total: number; page: number; limit: number }> {
    // Filtering happens in the query, never after the fetch — the architecture
    // spec calls query-level enforcement mandatory, and it is what keeps this
    // endpoint from becoming an enumeration oracle.
    const where = {
      ...(query.status === 'ALL' ? {} : { isActive: query.status === 'ACTIVE' }),
      ...(query.search === undefined ? {} : {
        OR: [
          { username: { contains: query.search, mode: 'insensitive' as const } },
          { email: { contains: query.search, mode: 'insensitive' as const } },
          { fullName: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
      ...(query.role === undefined ? {} : { roles: { some: { role: { code: query.role } } } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { fullName: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: (rows as UserRow[]).map(toResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return toResponse(user as UserRow);
  }

  async create(dto: CreateUserDto, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    this.assertMayAssign(actorRoleCodes, dto.roleCodes);

    // Hashed before the transaction opens: argon2 is deliberately slow, and
    // holding a database transaction open across it would pin a connection for
    // the duration of every user creation.
    const passwordHash = await this.passwords.hash(dto.password);

    return this.prisma.$transaction(async (tx) => {
      // Checked explicitly rather than left to the unique constraint, so a
      // collision is a 400 naming the field rather than a Prisma error
      // surfacing as a 500.
      if (await tx.user.findUnique({ where: { username: dto.username } })) {
        throw new BadRequestException(`Username ${dto.username} is already in use`);
      }
      if (await tx.user.findUnique({ where: { email: dto.email } })) {
        throw new BadRequestException(`Email ${dto.email} is already in use`);
      }

      const roles = await this.resolveRoles(tx, dto.roleCodes);

      const id = uuidv7();
      await tx.user.create({
        data: {
          id,
          username: dto.username,
          email: dto.email,
          fullName: dto.fullName,
          ...(dto.employeeCode === undefined ? {} : { employeeCode: dto.employeeCode }),
          passwordHash,
          isActive: true,
          // The creator knows this password, so the account carries no
          // authority until its holder replaces it. See AuthService.login.
          mustChangePassword: true,
        },
      });

      for (const role of roles) {
        await tx.userRole.create({
          data: { id: uuidv7(), userId: id, roleId: role.id, createdBy: actorId },
        });
        await this.emit(tx, SUBJECTS.IAM_ROLE_ASSIGNED, {
          userId: id, roleCode: role.code, projectId: null, siteId: null,
        }, actorId);
      }

      await this.audit(tx, actorId, 'user.created', id, {}, {
        username: dto.username, email: dto.email, fullName: dto.fullName,
        roleCodes: roles.map((role) => role.code),
      });

      // Re-read rather than assembling the response from the write inputs: one
      // query, and it cannot drift from what the next GET will return.
      const created = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(created as UserRow);
    });
  }
}
