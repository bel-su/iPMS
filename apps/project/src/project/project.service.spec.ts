import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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

describe('archiveProject', () => {
  it('sets the status to CANCELLED without touching anything else', async () => {
    const prisma = makePrisma();
    prisma.project.update.mockResolvedValue({ id: 'p-1', status: 'CANCELLED' });
    await service(prisma).archiveProject('p-1');
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { status: 'CANCELLED' } });
  });
});

describe('deleteProject', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('deletes a project that has no tasks', async () => {
    prisma.task.count.mockResolvedValue(0);
    await service(prisma).deleteProject('p-1');
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
  });

  it('refuses while any task remains, because the cascade would take them all', async () => {
    prisma.task.count.mockResolvedValue(3);
    await expect(service(prisma).deleteProject('p-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('says how many tasks are in the way, so the message is actionable', async () => {
    prisma.task.count.mockResolvedValue(3);
    await expect(service(prisma).deleteProject('p-1')).rejects.toThrow(/3 task/);
  });

  it('refuses a project that does not exist', async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(service(prisma).deleteProject('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('deleteSite', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue({ id: 's-1', projectId: 'p-1' });
  });

  it('refuses while a task references the site', async () => {
    prisma.task.count.mockResolvedValue(1);
    await expect(service(prisma).deleteSite('s-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a site with no tasks', async () => {
    prisma.task.count.mockResolvedValue(0);
    await service(prisma).deleteSite('s-1');
    expect(prisma.site.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
  });
});

describe('deleteTaskType', () => {
  it('refuses while a task uses it, rather than letting Prisma raise a restrict error', async () => {
    const prisma = makePrisma();
    prisma.taskType.findUnique.mockResolvedValue({ id: 'tt-1', projectId: 'p-1' });
    prisma.task.count.mockResolvedValue(2);
    await expect(service(prisma).deleteTaskType('tt-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.taskType.delete).not.toHaveBeenCalled();
  });
});

describe('deleteMilestone', () => {
  it('deletes, letting the requirements cascade', async () => {
    const prisma = makePrisma();
    prisma.milestone.findUnique.mockResolvedValue({ id: 'm-1', projectId: 'p-1' });
    await service(prisma).deleteMilestone('m-1');
    expect(prisma.milestone.delete).toHaveBeenCalledWith({ where: { id: 'm-1' } });
  });
});

describe('deleteTask', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('refuses a task that carries QC evidence', async () => {
    prisma.task.findUnique.mockResolvedValue({ id: 't-1', currentSubmissionId: 'sub-1' });
    await expect(service(prisma).deleteTask('t-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a task with no submission', async () => {
    prisma.task.findUnique.mockResolvedValue({ id: 't-1', currentSubmissionId: null });
    await service(prisma).deleteTask('t-1');
    expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });
  });
});

describe('createSite geofence', () => {
  it('stores the mode and radius', async () => {
    const prisma = makePrisma();
    await service(prisma).createSite('p-1', {
      siteCode: 'S1', name: 'One', geofenceMode: 'CUSTOM', geofenceRadiusM: 250,
    } as never);
    expect(prisma.site.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 }),
    });
  });

  it('defaults an unspecified site to INHERIT with a null radius', async () => {
    const prisma = makePrisma();
    await service(prisma).createSite('p-1', { siteCode: 'S1', name: 'One', geofenceMode: 'INHERIT' } as never);
    expect(prisma.site.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ geofenceMode: 'INHERIT', geofenceRadiusM: null }),
    });
  });
});

describe('createProject geofence default', () => {
  it('defaults to 500 m', async () => {
    const prisma = makePrisma();
    await service(prisma).createProject({ code: 'P1', name: 'P' } as never);
    expect(prisma.project.create).toHaveBeenCalledWith({ data: expect.objectContaining({ defaultGeofenceRadiusM: 500 }) });
  });

  // An explicit null means "no checks on this project" and must survive.
  it('keeps an explicit null', async () => {
    const prisma = makePrisma();
    await service(prisma).createProject({ code: 'P1', name: 'P', defaultGeofenceRadiusM: null } as never);
    expect(prisma.project.create).toHaveBeenCalledWith({ data: expect.objectContaining({ defaultGeofenceRadiusM: null }) });
  });
});

describe('siteGeofence', () => {
  /** Coordinates arrive as Prisma Decimal, which serializes as a string. */
  const site = (over: Record<string, unknown> = {}) => ({
    id: 's-1', latitude: '27.7172000', longitude: '85.3240000',
    geofenceMode: 'INHERIT', geofenceRadiusM: null,
    project: { defaultGeofenceRadiusM: 500 }, ...over,
  });

  it('resolves an inheriting site to the project default', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(site());
    expect(await service(prisma).siteGeofence('s-1')).toEqual({
      latitude: 27.7172, longitude: 85.324, effectiveRadiusM: 500,
    });
  });

  it('resolves an OFF site to no radius', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(site({ geofenceMode: 'OFF' }));
    expect((await service(prisma).siteGeofence('s-1')).effectiveRadiusM).toBeNull();
  });

  it('resolves a CUSTOM site to its own radius', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(site({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 }));
    expect((await service(prisma).siteGeofence('s-1')).effectiveRadiusM).toBe(250);
  });

  it('returns null coordinates for a site that has none', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(site({ latitude: null, longitude: null }));
    const result = await service(prisma).siteGeofence('s-1');
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });

  it('404s an unknown site', async () => {
    const prisma = makePrisma();
    prisma.site.findUnique.mockResolvedValue(null);
    await expect(service(prisma).siteGeofence('s-1')).rejects.toThrow(NotFoundException);
  });
});
