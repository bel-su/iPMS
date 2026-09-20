import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import { ProjectService } from './project.service.js';

const PROJECT = { id: 'p-1', code: 'ALPHA', name: 'Alpha' };

/**
 * A hand-written Prisma double.
 *
 * Only the calls the service actually makes are stubbed, so a method that
 * reaches for a table this fixture does not describe fails loudly rather than
 * quietly returning undefined.
 */
function makePrisma() {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue(PROJECT),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    site: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    taskType: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    milestone: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    milestoneRequirement: { deleteMany: vi.fn(), createMany: vi.fn() },
    task: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    region: { upsert: vi.fn() },
    $transaction: vi.fn(),
  };
}

type Prisma = ReturnType<typeof makePrisma>;

function service(prisma: Prisma): ProjectService {
  return new ProjectService(prisma as unknown as PrismaClient);
}

describe('listTasks', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it("lists a project's tasks newest first", async () => {
    await service(prisma).listTasks('p-1', {});
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p-1' },
      orderBy: { id: 'desc' },
    });
  });

  it('narrows by site and status when asked', async () => {
    await service(prisma).listTasks('p-1', { siteId: 's-1', status: 'ONGOING' });
    expect(prisma.task.findMany.mock.calls[0]![0].where)
      .toEqual({ projectId: 'p-1', siteId: 's-1', status: 'ONGOING' });
  });

  it('refuses a project that does not exist', async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(service(prisma).listTasks('missing', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
