import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@ipms/contracts';
import { UsersService } from './users.service.js';

const ACTOR = uuidv7();
const TARGET = uuidv7();

const ADMIN = ['SUPER_ADMIN'];
const MANAGER = ['PROJECT_MANAGER'];

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET, username: 'field.one', email: 'field.one@ipms.local',
    fullName: 'Field One', employeeCode: null, isActive: true,
    mustChangePassword: false, lastLoginAt: null, createdAt: new Date('2026-01-01T00:00:00Z'),
    roles: [{ role: { code: 'FIELD_ENGINEER', name: 'Field Engineer' } }],
    ...overrides,
  };
}

/**
 * One fake for the whole service. `$transaction` runs its callback against the
 * same `tx` the assertions read, which is what lets a test say "the audit event
 * was written in the same transaction as the update".
 */
function build(target: Record<string, unknown> | null = row(), extra: Record<string, unknown> = {}) {
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue(target),
      findUniqueOrThrow: vi.fn().mockResolvedValue(target ?? row()),
      findMany: vi.fn().mockResolvedValue([row()]),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...row(), ...data, tokenVersion: 4 })),
    },
    role: {
      findMany: vi.fn().mockImplementation(({ where }) => Promise.resolve(
        (where.code.in as string[]).map((code) => ({ id: uuidv7(), code, name: code })),
      )),
    },
    userRole: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(1),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    ...extra,
  };
  const prisma = {
    $transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    user: tx.user,
  };
  const passwords = { hash: vi.fn().mockResolvedValue('$argon2id$fake'), verify: vi.fn().mockResolvedValue(true) };
  const versions = { publish: vi.fn().mockResolvedValue(undefined) };
  const tokens = { refreshTtlSeconds: 2_592_000 };
  const service = new UsersService(prisma as never, passwords as never, versions as never, tokens as never);
  return { service, tx, prisma, passwords, versions };
}

describe('UsersService.list', () => {
  it('filters in the query, never after the fetch', async () => {
    const { service, prisma } = build();
    await service.list({ page: 1, limit: 20, status: 'ACTIVE', search: 'ann', role: 'FIELD_ENGINEER' });
    const where = prisma.user.findMany.mock.calls[0]![0].where;
    expect(where.isActive).toBe(true);
    expect(where.roles).toEqual({ some: { role: { code: 'FIELD_ENGINEER' } } });
    expect(where.OR).toHaveLength(3);
  });

  it('leaves isActive unconstrained for the ALL status', async () => {
    const { service, prisma } = build();
    await service.list({ page: 1, limit: 20, status: 'ALL' });
    expect(prisma.user.findMany.mock.calls[0]![0].where).not.toHaveProperty('isActive');
  });

  it('pages from one, not from zero', async () => {
    const { service, prisma } = build();
    await service.list({ page: 3, limit: 20, status: 'ALL' });
    expect(prisma.user.findMany.mock.calls[0]![0].skip).toBe(40);
    expect(prisma.user.findMany.mock.calls[0]![0].take).toBe(20);
  });

  it('never selects the password hash', async () => {
    const { service, prisma } = build();
    await service.list({ page: 1, limit: 20, status: 'ALL' });
    expect(prisma.user.findMany.mock.calls[0]![0].select).not.toHaveProperty('passwordHash');
  });

  it('returns the pagination envelope', async () => {
    const { service } = build();
    const result = await service.list({ page: 1, limit: 20, status: 'ALL' });
    expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(result.items[0]!.roles).toEqual([{ code: 'FIELD_ENGINEER', name: 'Field Engineer' }]);
  });
});

describe('UsersService.get', () => {
  it('reports a missing user as not found', async () => {
    const { service } = build(null);
    await expect(service.get(TARGET)).rejects.toBeInstanceOf(NotFoundException);
  });

  // Reading is not object-gated: `user.view` grants the directory, and a
  // project manager needs an administrator's name to know who to ask.
  it('returns an administrator to a project manager', async () => {
    const { service } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    await expect(service.get(TARGET)).resolves.toMatchObject({ id: TARGET });
  });
});

describe('UsersService.create', () => {
  const dto = {
    username: 'new.one', email: 'new.one@ipms.local', fullName: 'New One',
    password: 'a-long-enough-password', roleCodes: ['FIELD_ENGINEER'],
  };

  it('creates a user owing a password change', async () => {
    const { service, tx } = build(null);
    await service.create(dto, ACTOR, ADMIN);
    expect(tx.user.create.mock.calls[0]![0].data.mustChangePassword).toBe(true);
  });

  it('stores a hash, never the password', async () => {
    const { service, tx, passwords } = build(null);
    await service.create(dto, ACTOR, ADMIN);
    expect(passwords.hash).toHaveBeenCalledWith('a-long-enough-password');
    expect(tx.user.create.mock.calls[0]![0].data.passwordHash).toBe('$argon2id$fake');
    expect(tx.user.create.mock.calls[0]![0].data).not.toHaveProperty('password');
  });

  it('lets a project manager create a field engineer', async () => {
    const { service, tx } = build(null);
    await service.create(dto, ACTOR, MANAGER);
    expect(tx.user.create).toHaveBeenCalled();
  });

  it('refuses a project manager creating an administrator', async () => {
    const { service } = build(null);
    await expect(service.create({ ...dto, roleCodes: ['SUPER_ADMIN'] }, ACTOR, MANAGER))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a duplicate username, naming the field', async () => {
    const { service, tx } = build(null);
    tx.user.findUnique.mockResolvedValueOnce(row());
    await expect(service.create(dto, ACTOR, ADMIN)).rejects.toThrow(/username/i);
  });

  it('refuses a duplicate email, naming the field', async () => {
    const { service, tx } = build(null);
    tx.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
    await expect(service.create(dto, ACTOR, ADMIN)).rejects.toThrow(/email/i);
  });

  it('refuses a role code with no row behind it rather than creating a user a role short', async () => {
    const { service, tx } = build(null);
    tx.role.findMany.mockResolvedValueOnce([]);
    await expect(service.create(dto, ACTOR, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * `UserRole` carries no composite `@@unique` — the three partial indexes live
   * in the migration and Prisma cannot express them as a `where` key — so an
   * upsert has no conflict target to use. See the `UserRole` model comment.
   */
  it('writes the role assignment with create, never upsert', async () => {
    const { service, tx } = build(null);
    await service.create(dto, ACTOR, ADMIN);
    expect(tx.userRole.create).toHaveBeenCalledTimes(1);
    expect(tx.userRole).not.toHaveProperty('upsert');
    const data = tx.userRole.create.mock.calls[0]![0].data;
    expect(data.projectId).toBeUndefined();
    expect(data.createdBy).toBe(ACTOR);
  });

  it('writes an audit event carrying no password material', async () => {
    const { service, tx } = build(null);
    await service.create(dto, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls
      .map((call) => call[0].data)
      .find((data: { subject: string }) => data.subject === 'audit.event.recorded');
    expect(audit.payload.action).toBe('user.created');
    expect(JSON.stringify(audit.payload)).not.toContain('a-long-enough-password');
    expect(JSON.stringify(audit.payload)).not.toContain('argon2');
  });
});

describe('UsersService.update', () => {
  it('writes the fields the caller sent', async () => {
    const { service, tx } = build();
    await service.update(TARGET, { fullName: 'Field One Renamed' }, ACTOR, ADMIN);
    expect(tx.user.update.mock.calls[0]![0].data).toEqual({ fullName: 'Field One Renamed' });
  });

  it('clears employeeCode when the caller sends null', async () => {
    const { service, tx } = build();
    await service.update(TARGET, { employeeCode: null }, ACTOR, ADMIN);
    expect(tx.user.update.mock.calls[0]![0].data.employeeCode).toBeNull();
  });

  // A profile edit changes no authority, so signing the user out would be
  // gratuitous — and would teach administrators that editing is dangerous.
  it('does not revoke the targets sessions', async () => {
    const { service, versions } = build();
    await service.update(TARGET, { fullName: 'Renamed' }, ACTOR, ADMIN);
    expect(versions.publish).not.toHaveBeenCalled();
  });

  it('lets a project manager edit a field engineer', async () => {
    const { service, tx } = build();
    await service.update(TARGET, { fullName: 'Renamed' }, ACTOR, MANAGER);
    expect(tx.user.update).toHaveBeenCalled();
  });

  it('refuses a project manager editing an administrator', async () => {
    const { service } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    await expect(service.update(TARGET, { fullName: 'Renamed' }, ACTOR, MANAGER))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  /**
   * The ledger's canonical JSON hashes `undefined` and `null` identically, so
   * spreading the DTO would make "did not touch fullName" and "cleared
   * fullName" produce the same entry and the same hash.
   */
  it('records only the fields the caller actually sent', async () => {
    const { service, tx } = build();
    await service.update(TARGET, { fullName: 'Renamed' }, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls[0]![0].data;
    expect(Object.keys(audit.payload.newState)).toEqual(['fullName']);
  });
});

describe('UsersService.deactivate', () => {
  it('sets isActive false and revokes every outstanding token', async () => {
    const { service, tx, versions } = build();
    await service.deactivate(TARGET, ACTOR, ADMIN);
    expect(tx.user.update.mock.calls.some((call) => call[0].data.isActive === false)).toBe(true);
    expect(versions.publish).toHaveBeenCalledWith(TARGET, 4, 2_592_000);
  });

  it('announces the deactivation on the IAM stream', async () => {
    const { service, tx } = build();
    await service.deactivate(TARGET, ACTOR, ADMIN);
    const subjects = tx.outboxEvent.create.mock.calls.map((call) => call[0].data.subject);
    expect(subjects).toContain('iam.user.deactivated');
  });

  // Locking yourself out is never the intent, and reversing it needs a second
  // administrator.
  it('refuses an actor deactivating themselves', async () => {
    const { service } = build(row({ id: ACTOR }));
    await expect(service.deactivate(ACTOR, ACTOR, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to deactivate the last active administrator', async () => {
    const { service, tx } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    tx.userRole.count.mockResolvedValueOnce(0);
    await expect(service.deactivate(TARGET, ACTOR, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows deactivating an administrator while another active one remains', async () => {
    const { service, tx } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    tx.userRole.count.mockResolvedValueOnce(1);
    await expect(service.deactivate(TARGET, ACTOR, ADMIN)).resolves.toBeDefined();
  });

  it('counts only other, still-active administrators', async () => {
    const { service, tx } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    tx.userRole.count.mockResolvedValueOnce(1);
    await service.deactivate(TARGET, ACTOR, ADMIN);
    expect(tx.userRole.count.mock.calls[0]![0].where).toEqual({
      role: { code: 'SUPER_ADMIN' },
      userId: { not: TARGET },
      user: { isActive: true },
    });
  });
});

describe('UsersService.reactivate', () => {
  it('sets isActive true without touching the password', async () => {
    const { service, tx } = build(row({ isActive: false }));
    await service.reactivate(TARGET, ACTOR, ADMIN);
    expect(tx.user.update.mock.calls[0]![0].data).toEqual({ isActive: true });
  });
});

describe('UsersService.setRoles', () => {
  // Without this, role.assign is equivalent to SUPER_ADMIN.
  it('refuses an actor changing their own roles', async () => {
    const { service } = build(row({ id: ACTOR }));
    await expect(service.setRoles(ACTOR, { roleCodes: ['SUPER_ADMIN'] }, ACTOR, ADMIN))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a project manager granting a role outside their set', async () => {
    const { service } = build();
    await expect(service.setRoles(TARGET, { roleCodes: ['PROJECT_MANAGER'] }, ACTOR, MANAGER))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('replaces the global assignments with the set it was given', async () => {
    const { service, tx } = build();
    await service.setRoles(TARGET, { roleCodes: ['QC_MANAGER'] }, ACTOR, ADMIN);
    expect(tx.userRole.deleteMany.mock.calls[0]![0].where)
      .toEqual({ userId: TARGET, projectId: null, siteId: null });
    expect(tx.userRole.create).toHaveBeenCalledTimes(1);
  });

  it('accepts the empty set, leaving a user with no roles', async () => {
    const { service, tx } = build();
    await service.setRoles(TARGET, { roleCodes: [] }, ACTOR, ADMIN);
    expect(tx.userRole.deleteMany).toHaveBeenCalled();
    expect(tx.userRole.create).not.toHaveBeenCalled();
  });

  it('refuses to remove the last active administrators role', async () => {
    const { service, tx } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    tx.userRole.count.mockResolvedValueOnce(0);
    await expect(service.setRoles(TARGET, { roleCodes: ['VIEWER'] }, ACTOR, ADMIN))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // The permission claim is resolved at issuance, so a role change that does
  // not revoke leaves the old authority live for the access token's full TTL.
  it('revokes the targets tokens', async () => {
    const { service, versions } = build();
    await service.setRoles(TARGET, { roleCodes: ['QC_MANAGER'] }, ACTOR, ADMIN);
    expect(versions.publish).toHaveBeenCalledWith(TARGET, 4, 2_592_000);
  });

  it('records the previous and the next set', async () => {
    const { service, tx } = build();
    await service.setRoles(TARGET, { roleCodes: ['QC_MANAGER'] }, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls
      .map((call) => call[0].data)
      .find((data: { subject: string }) => data.subject === 'audit.event.recorded');
    expect(audit.payload.action).toBe('user.roles_changed');
    expect(audit.payload.previousState).toEqual({ roleCodes: ['FIELD_ENGINEER'] });
    expect(audit.payload.newState).toEqual({ roleCodes: ['QC_MANAGER'] });
  });
});

describe('UsersService.resetPassword', () => {
  it('stores a new hash, sets the change flag, and revokes tokens', async () => {
    const { service, tx, passwords, versions } = build();
    await service.resetPassword(TARGET, { password: 'another-long-password' }, ACTOR, ADMIN);
    expect(passwords.hash).toHaveBeenCalledWith('another-long-password');
    const data = tx.user.update.mock.calls.find((call) => call[0].data.passwordHash)![0].data;
    expect(data.passwordHash).toBe('$argon2id$fake');
    expect(data.mustChangePassword).toBe(true);
    expect(versions.publish).toHaveBeenCalled();
  });

  it('refuses a project manager resetting an administrators password', async () => {
    const { service } = build(row({ roles: [{ role: { code: 'SUPER_ADMIN', name: 'Super Administrator' } }] }));
    await expect(service.resetPassword(TARGET, { password: 'another-long-password' }, ACTOR, MANAGER))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes no password material into the audit entry', async () => {
    const { service, tx } = build();
    await service.resetPassword(TARGET, { password: 'another-long-password' }, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls
      .map((call) => call[0].data)
      .find((data: { subject: string }) => data.subject === 'audit.event.recorded');
    expect(audit.payload.action).toBe('user.password_reset');
    expect(JSON.stringify(audit.payload)).not.toContain('another-long-password');
    expect(JSON.stringify(audit.payload)).not.toContain('argon2');
  });
});
