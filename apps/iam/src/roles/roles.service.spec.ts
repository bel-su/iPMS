import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service.js';
import { uuidv7 } from '@ipms/contracts';

const ACTOR = uuidv7();

function build(roleOverrides: Record<string, unknown> | null = {}) {
  const role = roleOverrides === null ? null : {
    id: uuidv7(), code: 'QC_INSPECTOR', name: 'QC Inspector', description: '',
    isSystemRole: false, isActive: true,
    permissions: [{ permission: { code: 'qc_review.view' } }],
    ...roleOverrides,
  };
  const tx = {
    role: {
      findUnique: vi.fn().mockResolvedValue(role),
      findUniqueOrThrow: vi.fn().mockResolvedValue(role),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, permissions: [] })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...role, ...data })),
    },
    permission: {
      findMany: vi.fn().mockImplementation(({ where }) =>
        Promise.resolve((where.code.in as string[]).map((code) => ({ id: uuidv7(), code })))),
    },
    rolePermission: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
    userRole: { count: vi.fn().mockResolvedValue(0) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: vi.fn().mockImplementation((fn) => fn(tx)) };
  return { service: new RolesService(prisma as never), tx, role };
}

describe('RolesService.create', () => {
  it('creates a role with a dependency-complete permission set', async () => {
    const { service, tx } = build(null);
    await service.create({ name: 'QC Inspector', code: 'QC_INSPECTOR', description: '', permissionCodes: ['qc_review.view', 'qc_submission.view'] }, ACTOR);
    expect(tx.role.create).toHaveBeenCalled();
  });

  it('rejects a permission set missing a dependency', async () => {
    const { service } = build(null);
    await expect(service.create(
      { name: 'Bad', code: 'BAD_ROLE', description: '', permissionCodes: ['qc_review.approve'] }, ACTOR,
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown permission code', async () => {
    const { service } = build(null);
    await expect(service.create(
      { name: 'Bad', code: 'BAD_ROLE', description: '', permissionCodes: ['not.a.permission'] }, ACTOR,
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate role code', async () => {
    const { service } = build();
    await expect(service.create(
      { name: 'Dup', code: 'QC_INSPECTOR', description: '', permissionCodes: [] }, ACTOR,
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never marks a newly created role as a system role', async () => {
    const { service, tx } = build(null);
    await service.create({ name: 'X', code: 'X_ROLE', description: '', permissionCodes: [] }, ACTOR);
    expect(tx.role.create.mock.calls[0]![0].data.isSystemRole).toBe(false);
  });

  it('writes an audit event in the same transaction', async () => {
    const { service, tx } = build(null);
    await service.create({ name: 'X', code: 'X_ROLE', description: '', permissionCodes: [] }, ACTOR);
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subject: 'audit.event.recorded' }) }),
    );
  });
});

describe('RolesService.update', () => {
  it('updates a custom role', async () => {
    const { service, tx } = build();
    await service.update(uuidv7(), { name: 'Renamed' }, ACTOR, true);
    expect(tx.role.update).toHaveBeenCalled();
  });

  it('refuses to change a system role unless the actor is a super admin', async () => {
    const { service } = build({ isSystemRole: true });
    await expect(service.update(uuidv7(), { name: 'Hacked' }, ACTOR, false))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a super admin to adjust a system role', async () => {
    const { service, tx } = build({ isSystemRole: true });
    await service.update(uuidv7(), { name: 'Adjusted' }, ACTOR, true);
    expect(tx.role.update).toHaveBeenCalled();
  });

  it('throws 404 for an unknown role', async () => {
    const { service } = build(null);
    await expect(service.update(uuidv7(), { name: 'X' }, ACTOR, true)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RolesService.deactivate', () => {
  it('refuses to delete a system role outright', async () => {
    const { service } = build({ isSystemRole: true });
    await expect(service.deactivate(uuidv7(), ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to deactivate a role that still has users assigned', async () => {
    const { service, tx } = build();
    tx.userRole.count.mockResolvedValue(3);
    await expect(service.deactivate(uuidv7(), ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivates rather than deletes an unused custom role', async () => {
    const { service, tx } = build();
    await service.deactivate(uuidv7(), ACTOR);
    expect(tx.role.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
  });
});

describe('RolesService.clone', () => {
  it('copies the source role permission set under a new code', async () => {
    const { service, tx } = build();
    tx.role.findUnique.mockResolvedValueOnce(null);   // target code is free
    await service.clone({ name: 'QC Inspector Copy', code: 'QC_INSPECTOR_2', sourceRoleId: uuidv7() }, ACTOR);
    expect(tx.rolePermission.createMany).toHaveBeenCalled();
  });

  /**
   * The only bypass of system-role protection this service could have.
   * `deactivate` refuses `isSystemRole` outright with no super-admin escape,
   * so a clone that came out marked as a system role would be permanently
   * undeletable — and cloning SUPER_ADMIN copies the entire permission
   * catalog. A caller holding nothing but `role.create` could then mint an
   * un-removable all-permissions role. Until this test existed, flipping the
   * single `false` in `clone` to `true` left all 14 tests in this file green.
   */
  it('never marks a clone as a system role, whatever the source was', async () => {
    const { service, tx } = build({ code: 'SUPER_ADMIN', isSystemRole: true });
    tx.role.findUnique.mockResolvedValueOnce(null);   // target code is free
    await service.clone({ name: 'Not Really Admin', code: 'SNEAKY', sourceRoleId: uuidv7() }, ACTOR);
    expect(tx.role.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isSystemRole: false }) }),
    );
  });

  it('copies exactly the source role codes, not a superset', async () => {
    const { service, tx } = build({
      permissions: [{ permission: { code: 'qc_review.view' } }, { permission: { code: 'qc_submission.view' } }],
    });
    tx.role.findUnique.mockResolvedValueOnce(null);
    await service.clone({ name: 'Copy', code: 'COPY', sourceRoleId: uuidv7() }, ACTOR);
    expect(tx.permission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: { in: ['qc_review.view', 'qc_submission.view'] } } }),
    );
  });

  it('404s when the source role does not exist', async () => {
    const { service, tx } = build();
    tx.role.findUnique.mockResolvedValueOnce(null);   // target code free
    tx.role.findUnique.mockResolvedValueOnce(null);   // source missing
    await expect(service.clone({ name: 'Copy', code: 'COPY', sourceRoleId: uuidv7() }, ACTOR))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a code already in use', async () => {
    const { service } = build();   // findUnique resolves an existing role for the target code
    await expect(service.clone({ name: 'Copy', code: 'QC_INSPECTOR', sourceRoleId: uuidv7() }, ACTOR))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RolesService — catalog/database drift', () => {
  it('refuses to create a role when a requested permission has no database row', async () => {
    const { service, tx } = build(null);
    // The catalog knows both codes, but the seed has only landed one of them.
    tx.permission.findMany.mockResolvedValue([{ id: uuidv7(), code: 'qc_review.view' }]);
    await expect(service.create(
      { name: 'QC Inspector', code: 'QC_INSPECTOR', description: '', permissionCodes: ['qc_review.view', 'qc_submission.view'] },
      ACTOR,
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('names the missing code so an operator knows to re-run the seed', async () => {
    const { service, tx } = build(null);
    tx.permission.findMany.mockResolvedValue([{ id: uuidv7(), code: 'qc_review.view' }]);
    await expect(service.create(
      { name: 'QC Inspector', code: 'QC_INSPECTOR', description: '', permissionCodes: ['qc_review.view', 'qc_submission.view'] },
      ACTOR,
    )).rejects.toThrow(/qc_submission\.view/);
  });

  it('writes no role-permission rows when the set cannot be fully resolved', async () => {
    const { service, tx } = build(null);
    tx.permission.findMany.mockResolvedValue([{ id: uuidv7(), code: 'qc_review.view' }]);
    await service.create(
      { name: 'QC Inspector', code: 'QC_INSPECTOR', description: '', permissionCodes: ['qc_review.view', 'qc_submission.view'] },
      ACTOR,
    ).catch(() => undefined);
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
  });
});

describe('RolesService.update — code immutability', () => {
  /**
   * `code` is the identity every role assignment and permission catalog entry
   * is keyed by, so it must never change. Today that rests on
   * `UpdateRoleSchema` omitting the field and on `update` listing its writable
   * columns explicitly rather than spreading the DTO. This pins the second
   * half: a `code` smuggled past the schema still must not reach the database.
   */
  it('ignores a code field even if one reaches the service past the schema', async () => {
    const { service, tx } = build();
    await service.update(
      uuidv7(),
      { name: 'Renamed', code: 'HIJACKED' } as never,
      ACTOR,
      false,
    );
    expect(tx.role.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Renamed' } }),
    );
  });
});
