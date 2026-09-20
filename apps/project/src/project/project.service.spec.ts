import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

describe('updateSite', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue({ id: 's-1', projectId: 'p-1', siteCode: 'S-1' });
  });

  it('writes only the fields given', async () => {
    prisma.site.update.mockResolvedValue({ id: 's-1' });
    await service(prisma).updateSite('s-1', { name: 'Renamed' });
    expect(prisma.site.update).toHaveBeenCalledWith({ where: { id: 's-1' }, data: { name: 'Renamed' } });
  });

  it('upserts the region when one is named, and stores its id', async () => {
    prisma.region.upsert.mockResolvedValue({ id: 'r-9' });
    prisma.site.update.mockResolvedValue({ id: 's-1' });
    await service(prisma).updateSite('s-1', { regionName: 'North' });
    expect(prisma.region.upsert).toHaveBeenCalledWith({
      where: { projectId_name: { projectId: 'p-1', name: 'North' } },
      update: {}, create: { id: expect.any(String), projectId: 'p-1', name: 'North' },
    });
    expect(prisma.site.update.mock.calls[0]![0].data).toEqual({ regionId: 'r-9' });
  });

  it('refuses a site that does not exist', async () => {
    prisma.site.findUnique.mockResolvedValue(null);
    await expect(service(prisma).updateSite('missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('updateTask', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.task.findUnique.mockResolvedValue({ id: 't-1', projectId: 'p-1' });
    prisma.task.update.mockResolvedValue({ id: 't-1' });
  });

  it('unassigns when assigneeId is explicitly null', async () => {
    await service(prisma).updateTask('t-1', { assigneeId: null });
    expect(prisma.task.update.mock.calls[0]![0].data).toEqual({ assigneeId: null });
  });

  it('leaves the assignee alone when the field is absent', async () => {
    await service(prisma).updateTask('t-1', { title: 'Renamed' });
    expect(prisma.task.update.mock.calls[0]![0].data).toEqual({ title: 'Renamed' });
  });
});

describe('updateMilestone', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.milestone.findUnique.mockResolvedValue({ id: 'm-1', projectId: 'p-1' });
    prisma.milestone.update.mockResolvedValue({ id: 'm-1' });
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  });

  it('replaces the requirement set wholesale when taskTypeIds is given', async () => {
    prisma.taskType.count.mockResolvedValue(2);
    await service(prisma).updateMilestone('m-1', { taskTypeIds: ['tt-1', 'tt-2'] });
    expect(prisma.milestoneRequirement.deleteMany).toHaveBeenCalledWith({ where: { milestoneId: 'm-1' } });
    expect(prisma.milestoneRequirement.createMany).toHaveBeenCalledWith({
      data: [{ milestoneId: 'm-1', taskTypeId: 'tt-1' }, { milestoneId: 'm-1', taskTypeId: 'tt-2' }],
    });
  });

  it('leaves the requirement set alone when taskTypeIds is absent', async () => {
    await service(prisma).updateMilestone('m-1', { name: 'Handover' });
    expect(prisma.milestoneRequirement.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a task type from another project', async () => {
    prisma.taskType.count.mockResolvedValue(1);
    await expect(service(prisma).updateMilestone('m-1', { taskTypeIds: ['tt-1', 'other'] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
