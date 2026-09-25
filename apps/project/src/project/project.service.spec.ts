import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import type { WorkOrderUsageClient } from './work-order-usage.client.js';
import { ProjectService } from './project.service.js';

/** Every mutation is now attributed; these tests assert behaviour, not attribution. */
const ACTOR = '01a0d000-0000-7000-8000-00000000ac70';

const PROJECT = { id: 'p-1', code: 'ALPHA', name: 'Alpha' };

/**
 * These tests are about behaviour other than scoping, so they run as an
 * unrestricted caller. Scoping itself is covered in scope.integration.spec.ts
 * and by the per-model rules in scope/project-scope.spec.ts.
 */
const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };

/**
 * A hand-written Prisma double.
 *
 * Only the calls the service actually makes are stubbed, so a method that
 * reaches for a table this fixture does not describe fails loudly rather than
 * quietly returning undefined.
 */
function makePrisma() {
  const db = {
    project: {
      // findFirst, not findUnique: the scope filter is part of the lookup, so
      // the service can no longer address a row by primary key alone.
      findFirst: vi.fn().mockResolvedValue(PROJECT),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn(),
    },
    // findUnique as well as findFirst: siteGeofence is the service-to-service
    // read that is deliberately NOT scoped, so it still addresses a row by
    // primary key.
    site: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn() },
    taskType: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn() },
    milestone: { findFirst: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn() },
    milestoneRequirement: { deleteMany: vi.fn(), createMany: vi.fn() },
    task: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn(),
    },
    region: { upsert: vi.fn() },
    userScope: { findMany: vi.fn().mockResolvedValue([]) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  /**
   * Every mutation is now audited, which means every mutation runs inside
   * `$transaction`. Running the callback against this same double is what keeps
   * the assertions pointed at real spies -- a bare `vi.fn()` here swallows the
   * whole mutation and the test passes on a call that never happened.
   *
   * Assigned after construction because the callback needs the object itself.
   */
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  return db;
}

type Prisma = ReturnType<typeof makePrisma>;

/** How many work orders qc reports for whatever is being deleted. */
let workOrderCount = 0;
const usage = { count: vi.fn(async () => workOrderCount) };

function service(prisma: Prisma): ProjectService {
  return new ProjectService(prisma as unknown as PrismaClient, usage as unknown as WorkOrderUsageClient);
}

describe('listTasks', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it("lists a project's tasks newest first", async () => {
    await service(prisma).listTasks(GLOBAL, 'p-1', {});
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      // AND, not a spread: scopeWhere contributes an `OR` key, and a sibling
      // `OR` from a caller filter would collide and silently drop one of them.
      where: { AND: [{ projectId: 'p-1' }, {}] },
      orderBy: { id: 'desc' },
    });
  });

  it('narrows by site and status when asked', async () => {
    await service(prisma).listTasks(GLOBAL, 'p-1', { siteId: 's-1', status: 'ONGOING' });
    expect(prisma.task.findMany.mock.calls[0]![0].where)
      .toEqual({ AND: [{ projectId: 'p-1' }, {}, { siteId: 's-1' }, { status: 'ONGOING' }] });
  });

  it('refuses while qc still holds work orders for it, asking with the caller’s token', async () => {
    prisma.task.count.mockResolvedValue(0);
    workOrderCount = 4;
    await expect(service(prisma).deleteProject(GLOBAL, 'p-1', ACTOR, 'Bearer t')).rejects.toThrow(/4 work order/);
    expect(usage.count).toHaveBeenCalledWith({ projectId: 'p-1' }, 'Bearer t');
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('refuses a project that does not exist', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service(prisma).listTasks(GLOBAL, 'missing', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('updateSite', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.site.findFirst.mockResolvedValue({ id: 's-1', projectId: 'p-1', siteCode: 'S-1' });
  });

  it('writes only the fields given', async () => {
    prisma.site.update.mockResolvedValue({ id: 's-1' });
    await service(prisma).updateSite(GLOBAL, 's-1', { name: 'Renamed' }, ACTOR);
    expect(prisma.site.update).toHaveBeenCalledWith({ where: { id: 's-1' }, data: { name: 'Renamed' } });
  });

  it('upserts the region when one is named, and stores its id', async () => {
    prisma.region.upsert.mockResolvedValue({ id: 'r-9' });
    prisma.site.update.mockResolvedValue({ id: 's-1' });
    await service(prisma).updateSite(GLOBAL, 's-1', { regionName: 'North' }, ACTOR);
    expect(prisma.region.upsert).toHaveBeenCalledWith({
      where: { projectId_name: { projectId: 'p-1', name: 'North' } },
      update: {}, create: { id: expect.any(String), projectId: 'p-1', name: 'North' },
    });
    expect(prisma.site.update.mock.calls[0]![0].data).toEqual({ regionId: 'r-9' });
  });

  it('clears the region when regionName is explicitly null, and upserts nothing', async () => {
    prisma.site.update.mockResolvedValue({ id: 's-1' });
    await service(prisma).updateSite(GLOBAL, 's-1', { regionName: null }, ACTOR);
    expect(prisma.region.upsert).not.toHaveBeenCalled();
    expect(prisma.site.update.mock.calls[0]![0].data).toEqual({ regionId: null });
  });

  it('leaves the region alone when regionName is absent', async () => {
    prisma.site.update.mockResolvedValue({ id: 's-1' });
    await service(prisma).updateSite(GLOBAL, 's-1', { name: 'Renamed' }, ACTOR);
    expect(prisma.site.update.mock.calls[0]![0].data).toEqual({ name: 'Renamed' });
  });

  it('writes nulls straight through for the other clearable fields', async () => {
    prisma.site.update.mockResolvedValue({ id: 's-1' });
    await service(prisma).updateSite(GLOBAL, 's-1', { latitude: null, longitude: null, city: null }, ACTOR);
    expect(prisma.site.update.mock.calls[0]![0].data).toEqual({ latitude: null, longitude: null, city: null });
  });

  it('refuses a site that does not exist', async () => {
    prisma.site.findFirst.mockResolvedValue(null);
    await expect(service(prisma).updateSite(GLOBAL, 'missing', { name: 'x' }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('updateTask', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.task.findFirst.mockResolvedValue({ id: 't-1', projectId: 'p-1' });
    prisma.task.update.mockResolvedValue({ id: 't-1' });
  });

  it('unassigns when assigneeId is explicitly null', async () => {
    await service(prisma).updateTask(GLOBAL, 't-1', { assigneeId: null }, ACTOR);
    expect(prisma.task.update.mock.calls[0]![0].data).toEqual({ assigneeId: null });
  });

  it('leaves the assignee alone when the field is absent', async () => {
    await service(prisma).updateTask(GLOBAL, 't-1', { title: 'Renamed' }, ACTOR);
    expect(prisma.task.update.mock.calls[0]![0].data).toEqual({ title: 'Renamed' });
  });
});

describe('updateMilestone', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    prisma.milestone.findFirst.mockResolvedValue({ id: 'm-1', projectId: 'p-1' });
    prisma.milestone.update.mockResolvedValue({ id: 'm-1' });
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  });

  it('replaces the requirement set wholesale when taskTypeIds is given', async () => {
    prisma.taskType.count.mockResolvedValue(2);
    await service(prisma).updateMilestone(GLOBAL, 'm-1', { taskTypeIds: ['tt-1', 'tt-2'] }, ACTOR);
    expect(prisma.milestoneRequirement.deleteMany).toHaveBeenCalledWith({ where: { milestoneId: 'm-1' } });
    expect(prisma.milestoneRequirement.createMany).toHaveBeenCalledWith({
      data: [{ milestoneId: 'm-1', taskTypeId: 'tt-1' }, { milestoneId: 'm-1', taskTypeId: 'tt-2' }],
    });
  });

  it('leaves the requirement set alone when taskTypeIds is absent', async () => {
    await service(prisma).updateMilestone(GLOBAL, 'm-1', { name: 'Handover' }, ACTOR);
    expect(prisma.milestoneRequirement.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a task type from another project', async () => {
    prisma.taskType.count.mockResolvedValue(1);
    await expect(service(prisma).updateMilestone(GLOBAL, 'm-1', { taskTypeIds: ['tt-1', 'other'] }, ACTOR))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('archiveProject', () => {
  it('sets the status to CANCELLED without touching anything else', async () => {
    const prisma = makePrisma();
    prisma.project.update.mockResolvedValue({ id: 'p-1', status: 'CANCELLED' });
    await service(prisma).archiveProject(GLOBAL, 'p-1', ACTOR);
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { status: 'CANCELLED' } });
  });
});

describe('deleteProject', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); workOrderCount = 0; });

  it('deletes a project that has no tasks', async () => {
    prisma.task.count.mockResolvedValue(0);
    await service(prisma).deleteProject(GLOBAL, 'p-1', ACTOR, 'Bearer t');
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
  });

  it('refuses while any task remains, because the cascade would take them all', async () => {
    prisma.task.count.mockResolvedValue(3);
    await expect(service(prisma).deleteProject(GLOBAL, 'p-1', ACTOR, 'Bearer t')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('says how many tasks are in the way, so the message is actionable', async () => {
    prisma.task.count.mockResolvedValue(3);
    await expect(service(prisma).deleteProject(GLOBAL, 'p-1', ACTOR, 'Bearer t')).rejects.toThrow(/3 task/);
  });

  it('refuses while qc still holds work orders for it, asking with the caller’s token', async () => {
    prisma.task.count.mockResolvedValue(0);
    workOrderCount = 4;
    await expect(service(prisma).deleteProject(GLOBAL, 'p-1', ACTOR, 'Bearer t')).rejects.toThrow(/4 work order/);
    expect(usage.count).toHaveBeenCalledWith({ projectId: 'p-1' }, 'Bearer t');
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('refuses a project that does not exist', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service(prisma).deleteProject(GLOBAL, 'missing', ACTOR, 'Bearer t')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('deleteSite', () => {
  let prisma: Prisma;
  beforeEach(() => {
    prisma = makePrisma();
    workOrderCount = 0;
    prisma.site.findFirst.mockResolvedValue({ id: 's-1', projectId: 'p-1' });
  });

  it('refuses while qc still holds work orders for the site', async () => {
    prisma.task.count.mockResolvedValue(0);
    workOrderCount = 1;
    await expect(service(prisma).deleteSite(GLOBAL, 's-1', ACTOR, 'Bearer t')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.site.delete).not.toHaveBeenCalled();
  });

  it('refuses while a task references the site', async () => {
    prisma.task.count.mockResolvedValue(1);
    await expect(service(prisma).deleteSite(GLOBAL, 's-1', ACTOR, 'Bearer t')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a site with no tasks', async () => {
    prisma.task.count.mockResolvedValue(0);
    await service(prisma).deleteSite(GLOBAL, 's-1', ACTOR, 'Bearer t');
    expect(prisma.site.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
  });
});

describe('deleteTaskType', () => {
  it('refuses while a task uses it, rather than letting Prisma raise a restrict error', async () => {
    const prisma = makePrisma();
    prisma.taskType.findFirst.mockResolvedValue({ id: 'tt-1', projectId: 'p-1' });
    prisma.task.count.mockResolvedValue(2);
    await expect(service(prisma).deleteTaskType(GLOBAL, 'tt-1', ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.taskType.delete).not.toHaveBeenCalled();
  });
});

describe('deleteMilestone', () => {
  it('deletes, letting the requirements cascade', async () => {
    const prisma = makePrisma();
    prisma.milestone.findFirst.mockResolvedValue({ id: 'm-1', projectId: 'p-1' });
    await service(prisma).deleteMilestone(GLOBAL, 'm-1', ACTOR);
    expect(prisma.milestone.delete).toHaveBeenCalledWith({ where: { id: 'm-1' } });
  });
});

describe('deleteTask', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('deletes a task', async () => {
    prisma.task.findFirst.mockResolvedValue({ id: 't-1' });
    await service(prisma).deleteTask(GLOBAL, 't-1', ACTOR);
    expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });
  });
});

describe('createSite geofence', () => {
  it('stores the mode and radius', async () => {
    const prisma = makePrisma();
    await service(prisma).createSite(GLOBAL, 'p-1', {
      siteCode: 'S1', name: 'One', geofenceMode: 'CUSTOM', geofenceRadiusM: 250,
    } as never, ACTOR);
    expect(prisma.site.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 }),
    });
  });

  it('defaults an unspecified site to INHERIT with a null radius', async () => {
    const prisma = makePrisma();
    await service(prisma).createSite(GLOBAL, 'p-1', { siteCode: 'S1', name: 'One', geofenceMode: 'INHERIT' } as never, ACTOR);
    expect(prisma.site.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ geofenceMode: 'INHERIT', geofenceRadiusM: null }),
    });
  });
});

describe('createProject geofence default', () => {
  it('defaults to 500 m', async () => {
    const prisma = makePrisma();
    await service(prisma).createProject({ code: 'P1', name: 'P' } as never, ACTOR);
    expect(prisma.project.create).toHaveBeenCalledWith({ data: expect.objectContaining({ defaultGeofenceRadiusM: 500 }) });
  });

  // An explicit null means "no checks on this project" and must survive.
  it('keeps an explicit null', async () => {
    const prisma = makePrisma();
    await service(prisma).createProject({ code: 'P1', name: 'P', defaultGeofenceRadiusM: null } as never, ACTOR);
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

describe('siteRefs', () => {
  it('returns only the requested sites the caller can see, with the project', async () => {
    const prisma = makePrisma();
    prisma.site.findMany.mockResolvedValue([{ id: 's-1', siteCode: 'K1', name: 'K', city: null, area: null }]);
    const scope: AuthzScope = { global: false, projectIds: [], siteIds: ['s-1'] };
    const refs = await service(prisma).siteRefs(scope, 'p-1', ['s-1', 's-2']);
    expect(refs).toMatchObject({ project: PROJECT, sites: [{ id: 's-1' }] });
    const where = JSON.stringify(prisma.site.findMany.mock.calls[0]![0].where);
    expect(where).toContain('"projectId":"p-1"');
    // The caller's own site grant narrows the lookup, not just the ids asked for.
    expect(where).toContain('"id":{"in":["s-1"]}');
  });
});

describe('assignable', () => {
  it('groups replicated grants per user, whole project or by site', async () => {
    const prisma = makePrisma();
    prisma.site.findMany.mockResolvedValue([{ id: 's-1' }]);
    prisma.userScope.findMany.mockResolvedValue([
      { userId: 'u-1', level: 'PROJECT', siteId: null }, { userId: 'u-2', level: 'SITE', siteId: 's-1' },
    ]);
    await expect(service(prisma).assignable(GLOBAL, 'p-1')).resolves.toEqual([
      { userId: 'u-1', wholeProject: true, siteIds: [] }, { userId: 'u-2', wholeProject: false, siteIds: ['s-1'] },
    ]);
  });
});
