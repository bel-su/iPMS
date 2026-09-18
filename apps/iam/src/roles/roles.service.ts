import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package — see
// the `output` comment in prisma/schema.prisma.
import type { PrismaClient } from '.prisma-client-iam';
import { PERMISSION_CODES, validatePermissionSet } from '@ipms/authz';
import { uuidv7, type CloneRoleDto, type CreateRoleDto, type UpdateRoleDto } from '@ipms/contracts';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaClient) {}

  private assertPermissionsValid(codes: string[]): void {
    const unknown = codes.filter((c) => !PERMISSION_CODES.has(c));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission codes: ${unknown.join(', ')}`);
    }
    const { valid, missing } = validatePermissionSet(codes);
    if (!valid) {
      throw new BadRequestException(`Permission set is incomplete; also required: ${missing.join(', ')}`);
    }
  }

  private async audit(
    tx: Tx, actorId: string, action: string, objectId: string,
    previousState: JsonObject, newState: JsonObject,
  ): Promise<void> {
    const record = buildOutboxRecord(
      SUBJECTS.AUDIT_EVENT,
      { actorId, action, objectType: 'Role', objectId, previousState, newState, details: {} },
      getCorrelationId() ?? 'unknown',
      actorId,
    );
    await tx.outboxEvent.create({ data: record });
  }

  private async setPermissions(tx: Tx, roleId: string, codes: string[]): Promise<void> {
    const permissions = await tx.permission.findMany({ where: { code: { in: codes } } });

    // `assertPermissionsValid` checks codes against the in-memory catalog; this
    // checks them against the rows actually in the database. The two can
    // disagree: a permission added to @ipms/authz and deployed before the seed
    // re-runs validates fine but resolves to no row. Writing only what resolved
    // would create the role a permission short while returning 201 and
    // recording the full requested set in the audit ledger — leaving the
    // record of fact wrong about what was granted. Fail instead.
    if (permissions.length !== new Set(codes).size) {
      const found = new Set(permissions.map((p) => p.code));
      const missing = [...new Set(codes)].filter((c) => !found.has(c));
      throw new BadRequestException(
        `Permission codes are not present in the database; re-run the permission seed: ${missing.join(', ')}`,
      );
    }

    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }

  async create(dto: CreateRoleDto, actorId: string) {
    this.assertPermissionsValid(dto.permissionCodes);

    return this.prisma.$transaction(async (tx) => {
      if (await tx.role.findUnique({ where: { code: dto.code } })) {
        throw new BadRequestException(`Role code ${dto.code} is already in use`);
      }

      const role = await tx.role.create({
        data: {
          id: uuidv7(), code: dto.code, name: dto.name,
          description: dto.description, isSystemRole: false, isActive: true,
        },
      });
      await this.setPermissions(tx, role.id, dto.permissionCodes);
      await this.audit(tx, actorId, 'role.created', role.id, {}, { code: dto.code, name: dto.name, permissionCodes: dto.permissionCodes });
      return role;
    });
  }

  async update(id: string, dto: UpdateRoleDto, actorId: string, actorIsSuperAdmin: boolean) {
    if (dto.permissionCodes) this.assertPermissionsValid(dto.permissionCodes);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } } } });
      if (!existing) throw new NotFoundException('Role not found');

      if (existing.isSystemRole && !actorIsSuperAdmin) {
        throw new ForbiddenException('System roles can only be modified by a super administrator');
      }

      const previousState = {
        name: existing.name,
        description: existing.description,
        permissionCodes: existing.permissions.map((rp) => rp.permission.code),
      };

      const role = await tx.role.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.description === undefined ? {} : { description: dto.description }),
        },
      });
      if (dto.permissionCodes) await this.setPermissions(tx, id, dto.permissionCodes);

      // Record only the fields the caller actually sent. Spreading `dto` wholesale
      // would carry absent optional fields through as `undefined`, and the audit
      // ledger's canonical JSON hashes `undefined` and `null` identically — so
      // "the caller did not touch description" and "the caller cleared
      // description" would produce the same ledger entry and the same hash.
      const changed: JsonObject = {};
      if (dto.name !== undefined) changed['name'] = dto.name;
      if (dto.description !== undefined) changed['description'] = dto.description;
      if (dto.permissionCodes !== undefined) changed['permissionCodes'] = dto.permissionCodes;

      await this.audit(tx, actorId, 'role.updated', id, previousState, changed);
      return role;
    });
  }

  async clone(dto: CloneRoleDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.role.findUnique({ where: { code: dto.code } })) {
        throw new BadRequestException(`Role code ${dto.code} is already in use`);
      }
      const source = await tx.role.findUnique({
        where: { id: dto.sourceRoleId }, include: { permissions: { include: { permission: true } } },
      });
      if (!source) throw new NotFoundException('Source role not found');

      // A clone of a system role is always a custom role.
      const role = await tx.role.create({
        data: {
          id: uuidv7(), code: dto.code, name: dto.name,
          description: `Cloned from ${source.code}`, isSystemRole: false, isActive: true,
        },
      });
      await this.setPermissions(tx, role.id, source.permissions.map((rp) => rp.permission.code));
      await this.audit(tx, actorId, 'role.cloned', role.id, {}, { code: dto.code, sourceRoleCode: source.code });
      return role;
    });
  }

  async deactivate(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id } });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isSystemRole) throw new ForbiddenException('System roles cannot be deleted');

      const assigned = await tx.userRole.count({ where: { roleId: id } });
      if (assigned > 0) {
        throw new BadRequestException(`Role is assigned to ${assigned} user(s); remove the assignments first`);
      }

      const updated = await tx.role.update({ where: { id }, data: { isActive: false } });
      await this.audit(tx, actorId, 'role.deactivated', id, { isActive: true }, { isActive: false });
      return updated;
    });
  }

  async list() {
    const roles = await this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } },
      orderBy: [{ isSystemRole: 'desc' }, { code: 'asc' }],
    });
    return roles.map((r) => ({
      id: r.id, name: r.name, code: r.code, description: r.description,
      isSystemRole: r.isSystemRole, isActive: r.isActive,
      permissionCodes: r.permissions.map((rp) => rp.permission.code),
      userCount: r._count.assignments,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async get(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return {
      id: role.id, name: role.name, code: role.code, description: role.description,
      isSystemRole: role.isSystemRole, isActive: role.isActive,
      permissionCodes: role.permissions.map((rp) => rp.permission.code),
      userCount: role._count.assignments,
      updatedAt: role.updatedAt.toISOString(),
    };
  }
}
