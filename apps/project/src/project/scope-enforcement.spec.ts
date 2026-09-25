import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import { ProjectService } from './project.service.js';

/** Every mutation is now attributed; these tests assert behaviour, not attribution. */
const ACTOR = '01a0d000-0000-7000-8000-00000000ac70';

/**
 * These assert the boundary itself: that every read and write carries the
 * caller's scope into the query rather than checking it afterwards.
 *
 * Asserting on the `where` Prisma was handed is the point. A fetch-then-check
 * implementation would satisfy a test that only inspected the return value,
 * while having already read the row it was meant to protect -- and would leak
 * through any path that forgot the check. Constraining the query cannot leak
 * that way.
 */
const PROJECT_A = 'p-a';
const SITE_IN_C = 's-c';

const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const NOTHING: AuthzScope = { global: false, projectIds: [], siteIds: [] };
const ONLY_A: AuthzScope = { global: false, projectIds: [PROJECT_A], siteIds: [] };
const ONLY_SITE: AuthzScope = { global: false, projectIds: [], siteIds: [SITE_IN_C] };

function makePrisma() {
  const db = {
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: PROJECT_A, defaultGeofenceRadiusM: 500 }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn(),
    },
    site: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn() },
    taskType: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn() },
    milestone: { findFirst: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn() },
    milestoneRequirement: { deleteMany: vi.fn(), createMany: vi.fn() },
    task: {
      findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'created-1' }), update: vi.fn().mockResolvedValue({ id: 'created-1' }), delete: vi.fn(),
    },
    region: { upsert: vi.fn() },
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
const svc = (p: Prisma) => new ProjectService(p as unknown as PrismaClient);

let prisma: Prisma;
beforeEach(() => { prisma = makePrisma(); });

/** The visibility rule the service must apply to a project, in full. */
const visibleTo = (scope: AuthzScope) => scope.global
  ? {}
  : { OR: [{ id: { in: scope.projectIds } }, { sites: { some: { id: { in: scope.siteIds } } } }] };

describe('list reads carry scope into the query', () => {
  it('constrains listProjects', async () => {
    await svc(prisma).listProjects(ONLY_A);
    expect(prisma.project.findMany.mock.calls[0]![0].where).toEqual(visibleTo(ONLY_A));
  });

  it('constrains listProjects to match nothing for an unscoped caller', async () => {
    // The fail-closed case, and the one an empty scope projection produces. It
    // must read as "no access", never as "no filter".
    await svc(prisma).listProjects(NOTHING);
    expect(prisma.project.findMany.mock.calls[0]![0].where).toEqual({
      OR: [{ id: { in: [] } }, { sites: { some: { id: { in: [] } } } }],
    });
  });

  it('leaves a global caller unconstrained', async () => {
    await svc(prisma).listProjects(GLOBAL);
    expect(prisma.project.findMany.mock.calls[0]![0].where).toEqual({});
  });

  it('reaches a project through a site grant alone', async () => {
    // Project and site grants are alternatives. Without this a PM scoped to one
    // site cannot see the project that site belongs to, and the site becomes
    // unreachable from every list that starts at a project.
    await svc(prisma).listProjects(ONLY_SITE);
    expect(prisma.project.findMany.mock.calls[0]![0].where).toEqual({
      OR: [{ id: { in: [] } }, { sites: { some: { id: { in: [SITE_IN_C] } } } }],
    });
  });
});

describe('read-by-id is a scoped lookup, not a fetch-then-check', () => {
  it('folds scope into getProject\'s where', async () => {
    await svc(prisma).getProject(ONLY_A, PROJECT_A);
    expect(prisma.project.findFirst.mock.calls[0]![0].where)
      .toEqual({ AND: [{ id: PROJECT_A }, visibleTo(ONLY_A)] });
  });

  it('scopes the nested site list as well as the project', async () => {
    // Reaching a project through a single site grant must not hand back every
    // other site in it.
    await svc(prisma).getProject(ONLY_SITE, PROJECT_A);
    expect(prisma.project.findFirst.mock.calls[0]![0].include.sites.where)
      .toEqual({ OR: [{ projectId: { in: [] } }, { id: { in: [SITE_IN_C] } }] });
  });

  it('reports 404, not 403, for a project outside scope', async () => {
    // A 403 would confirm the id names something real, which is what an
    // enumeration attack is looking for.
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(svc(prisma).getProject(ONLY_A, 'p-other')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('writes scope-check their parent before touching anything', () => {
  it.each([
    ['createSite', (s: AuthzScope) => svc(prisma).createSite(s, 'p-other', { siteCode: 'X', name: 'X', geofenceMode: 'INHERIT' } as never, ACTOR)],
    ['createTaskType', (s: AuthzScope) => svc(prisma).createTaskType(s, 'p-other', { code: 'X', name: 'X', category: 'QUALITY' } as never, ACTOR)],
    ['createMilestone', (s: AuthzScope) => svc(prisma).createMilestone(s, 'p-other', { code: 'X', name: 'X', kind: 'PROJECT', sequence: 1, taskTypeIds: [] } as never, ACTOR)],
    ['updateProject', (s: AuthzScope) => svc(prisma).updateProject(s, 'p-other', { name: 'X' } as never, ACTOR)],
    ['archiveProject', (s: AuthzScope) => svc(prisma).archiveProject(s, 'p-other', ACTOR)],
    ['deleteProject', (s: AuthzScope) => svc(prisma).deleteProject(s, 'p-other', ACTOR)],
    ['listTasks', (s: AuthzScope) => svc(prisma).listTasks(s, 'p-other', {} as never)],
  ])('%s refuses a project outside scope', async (_label, call) => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(call(ONLY_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.project.delete).not.toHaveBeenCalled();
    expect(prisma.site.create).not.toHaveBeenCalled();
    expect(prisma.taskType.create).not.toHaveBeenCalled();
  });

  it.each([
    ['updateSite', (s: AuthzScope) => svc(prisma).updateSite(s, 's-other', { name: 'X' } as never, ACTOR)],
    ['deleteSite', (s: AuthzScope) => svc(prisma).deleteSite(s, 's-other', ACTOR)],
  ])('%s refuses a site outside scope', async (_label, call) => {
    prisma.site.findFirst.mockResolvedValue(null);
    await expect(call(ONLY_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.site.update).not.toHaveBeenCalled();
    expect(prisma.site.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['updateTask', (s: AuthzScope) => svc(prisma).updateTask(s, 't-other', { title: 'X' } as never, ACTOR)],
    ['assignTask', (s: AuthzScope) => svc(prisma).assignTask(s, 't-other', { assigneeId: 'u-1' } as never, ACTOR)],
    ['deleteTask', (s: AuthzScope) => svc(prisma).deleteTask(s, 't-other', ACTOR)],
  ])('%s refuses a task outside scope', async (_label, call) => {
    prisma.task.findFirst.mockResolvedValue(null);
    await expect(call(ONLY_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.task.delete).not.toHaveBeenCalled();
  });

  it('cannot reach another project by naming its site in a scoped create', async () => {
    // The parent project passes, but the site belongs elsewhere. Scoping only
    // the parent would let the site id smuggle the write across the boundary.
    prisma.site.findFirst.mockResolvedValue(null);
    prisma.taskType.findFirst.mockResolvedValue({ id: 'tt-1', templateId: null });
    await expect(
      svc(prisma).createTask(ONLY_A, PROJECT_A, { siteId: SITE_IN_C, taskTypeId: 'tt-1', title: 'X', origin: 'AD_HOC' } as never, 'actor'),
    ).rejects.toThrow();
    expect(prisma.task.create).not.toHaveBeenCalled();
  });
});

describe('aggregate reads do not leak the platform\'s shape', () => {
  it('scopes every dashboard count', async () => {
    await svc(prisma).dashboard(ONLY_A);
    expect(prisma.project.findMany.mock.calls[0]![0].where)
      .toEqual({ AND: [{ status: 'ACTIVE' }, visibleTo(ONLY_A)] });
    for (const call of prisma.task.count.mock.calls) {
      // An unscoped tally reveals how much work exists outside the caller's
      // reach even though it names none of it.
      expect(JSON.stringify(call[0])).toContain('projectId');
    }
  });
});

describe('service-to-service reads stay unscoped, deliberately', () => {
  it.each(['siteGeofence', 'internalTask'] as const)('%s addresses its row by primary key', async (method) => {
    // qc calls these with the submitting user's token but needs the row
    // regardless of that user's project scope, and the gateway refuses every
    // /internal/ path so they are unreachable from outside the cluster.
    if (method === 'siteGeofence') {
      prisma.site.findUnique.mockResolvedValue({
        id: 's-1', latitude: null, longitude: null, geofenceMode: 'OFF',
        geofenceRadiusM: null, project: { defaultGeofenceRadiusM: 500 },
      });
      await svc(prisma).siteGeofence('s-1');
      expect(prisma.site.findUnique).toHaveBeenCalled();
    } else {
      prisma.task.findUnique.mockResolvedValue({
        id: 't-1', projectId: 'p-1', siteId: 's-1', assigneeId: null, templateId: null, status: 'ONGOING',
      });
      await svc(prisma).internalTask('t-1');
      expect(prisma.task.findUnique).toHaveBeenCalled();
    }
  });
});
