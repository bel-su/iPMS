import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScopesService } from './scopes.service.js';
import { uuidv7 } from '@ipms/contracts';

const ACTOR = uuidv7();
const USER = uuidv7();
const PROJECT = uuidv7();
const SITE = uuidv7();

function build(opts: { user?: unknown; existingScope?: unknown; permission?: unknown } = {}) {
  const tx = {
    user: { findUnique: vi.fn().mockResolvedValue(opts.user === undefined ? { id: USER, isActive: true } : opts.user) },
    permission: { findUnique: vi.fn().mockResolvedValue(opts.permission === undefined ? { id: uuidv7(), code: 'qc_review.approve' } : opts.permission) },
    userProjectScope: {
      findUnique: vi.fn().mockResolvedValue(opts.existingScope ?? null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userSiteScope: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userPermissionOverride: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      findUnique: vi.fn().mockResolvedValue({ id: uuidv7(), userId: USER }),
      delete: vi.fn().mockResolvedValue({}),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: vi.fn().mockImplementation((fn) => fn(tx)) };
  return { service: new ScopesService(prisma as never), tx };
}

describe('ScopesService.grantProject', () => {
  it('creates the scope row', async () => {
    const { service, tx } = build();
    await service.grantProject(USER, PROJECT, ACTOR);
    expect(tx.userProjectScope.create).toHaveBeenCalled();
  });

  it('emits iam.scope.granted in the same transaction', async () => {
    const { service, tx } = build();
    await service.grantProject(USER, PROJECT, ACTOR);
    const subjects = tx.outboxEvent.create.mock.calls.map((c) => c[0].data.subject);
    expect(subjects).toContain('iam.scope.granted');
  });

  it('also emits an audit event', async () => {
    const { service, tx } = build();
    await service.grantProject(USER, PROJECT, ACTOR);
    const subjects = tx.outboxEvent.create.mock.calls.map((c) => c[0].data.subject);
    expect(subjects).toContain('audit.event.recorded');
  });

  it('is idempotent when the scope already exists', async () => {
    const { service, tx } = build({ existingScope: { id: uuidv7() } });
    await service.grantProject(USER, PROJECT, ACTOR);
    expect(tx.userProjectScope.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a grant to an unknown user', async () => {
    const { service } = build({ user: null });
    await expect(service.grantProject(USER, PROJECT, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ScopesService.revokeProject', () => {
  it('emits iam.scope.revoked so caches drop the project immediately', async () => {
    const { service, tx } = build();
    await service.revokeProject(USER, PROJECT, ACTOR);
    const subjects = tx.outboxEvent.create.mock.calls.map((c) => c[0].data.subject);
    expect(subjects).toContain('iam.scope.revoked');
  });

  it('emits nothing when there was no scope to revoke', async () => {
    const { service, tx } = build();
    tx.userProjectScope.deleteMany.mockResolvedValue({ count: 0 });
    await service.revokeProject(USER, PROJECT, ACTOR);
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});

describe('ScopesService.createOverride', () => {
  const dto = {
    permissionCode: 'qc_review.approve', effect: 'ALLOW' as const,
    validUntil: '2026-09-30T00:00:00.000Z', reason: 'Temporary QC cover',
  };

  it('persists the override with its reason', async () => {
    const { service, tx } = build();
    await service.createOverride(USER, dto, ACTOR);
    expect(tx.userPermissionOverride.create.mock.calls[0]![0].data.reason).toBe('Temporary QC cover');
  });

  it('audits the override', async () => {
    const { service, tx } = build();
    await service.createOverride(USER, dto, ACTOR);
    const subjects = tx.outboxEvent.create.mock.calls.map((c) => c[0].data.subject);
    expect(subjects).toContain('audit.event.recorded');
  });

  it('rejects an unknown permission code', async () => {
    const { service } = build({ permission: null });
    await expect(service.createOverride(USER, dto, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a validUntil earlier than validFrom', async () => {
    const { service } = build();
    await expect(service.createOverride(USER, {
      ...dto, validFrom: '2026-10-01T00:00:00.000Z', validUntil: '2026-09-01T00:00:00.000Z',
    }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });
});
