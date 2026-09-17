import { describe, expect, it, vi } from 'vitest';
import { AuditController } from './audit.controller.js';

const rows = [{
  sequence: 1, actorId: 'u-1', action: 'role.created', objectType: 'Role', objectId: 'r-1',
  previousState: {}, newState: {}, details: {}, timestamp: new Date('2026-09-15T12:00:00Z'),
  previousHash: '0'.repeat(64), chainHash: 'a'.repeat(64), correlationId: 'c-1', id: 'x', eventId: 'e-1',
}];

function controller(overrides: Record<string, unknown> = {}) {
  const prisma = {
    auditEvent: {
      findMany: vi.fn().mockResolvedValue(rows),
      count: vi.fn().mockResolvedValue(1),
    },
  };
  const chain = { verify: vi.fn().mockResolvedValue({ valid: true, brokenAtSequence: null }) };
  return { ctrl: new AuditController(prisma as never, chain as never), prisma, chain, ...overrides };
}

describe('AuditController.list', () => {
  it('returns a paginated envelope', async () => {
    const { ctrl } = controller();
    const result = await ctrl.list({ page: 1, limit: 20 });
    expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(result.items).toHaveLength(1);
  });

  it('orders newest first', async () => {
    const { ctrl, prisma } = controller();
    await ctrl.list({ page: 1, limit: 20 });
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { sequence: 'desc' } }),
    );
  });

  it('applies the actor filter', async () => {
    const { ctrl, prisma } = controller();
    await ctrl.list({ page: 1, limit: 20, actorId: 'u-9' });
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ actorId: 'u-9' }) }),
    );
  });

  it('applies the object filter as a pair', async () => {
    const { ctrl, prisma } = controller();
    await ctrl.list({ page: 1, limit: 20, objectType: 'Role', objectId: 'r-1' });
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ objectType: 'Role', objectId: 'r-1' }) }),
    );
  });

  it('paginates with the right skip', async () => {
    const { ctrl, prisma } = controller();
    await ctrl.list({ page: 3, limit: 20 });
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20 }),
    );
  });
});

describe('AuditController.verify', () => {
  it('returns the chain verification result', async () => {
    const { ctrl } = controller();
    expect(await ctrl.verify({})).toEqual({ valid: true, brokenAtSequence: null });
  });

  it('passes an explicit range through', async () => {
    const { ctrl, chain } = controller();
    await ctrl.verify({ from: 10, to: 20 });
    expect(chain.verify).toHaveBeenCalledWith(10, 20);
  });
});
