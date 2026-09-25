import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import type { CreateWorkOrdersDto } from '@ipms/contracts';
import { WorkOrderService } from './work-order.service.js';
import type { TemplateLookup, TemplateLookupClient } from './template-lookup.client.js';
import type { UserScopeRepository } from '../scope/user-scope.repository.js';

const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const TEMPLATE = { id: 'tpl-1', code: 'Q6683', name: 'Antenna + RRU', category: 'QUALITY', disabled: false, publishedVersion: 2 };
const SITES = [{ id: 's-1', siteCode: 'L4KOS342', name: 'SAKUWA GACHHI' }, { id: 's-2', siteCode: 'KOS102X', name: 'KOS102X' }];
const DTO: CreateWorkOrdersDto = {
  workOrderType: 'QUALITY_SELF_CHECK', templateId: 'tpl-1', siteIds: ['s-2', 's-1'], assigneeId: 'u-2',
  plannedCompletionAt: new Date('2026-09-30T23:59:59Z'), note: 'sector A',
};

function makePrisma() {
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue({ id: 'p-1' }) },
    site: { findMany: vi.fn().mockResolvedValue(SITES) },
    task: {
      createMany: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]),
    },
    workOrderEvent: { create: vi.fn(), createMany: vi.fn() },
    userScope: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  // findMany after createMany returns what was created.
  prisma.task.createMany.mockImplementation(({ data }: { data: { id: string }[] }) => {
    prisma.task.findMany.mockResolvedValueOnce(data);
    return Promise.resolve({ count: data.length });
  });
  return prisma;
}
type Prisma = ReturnType<typeof makePrisma>;

function service(prisma: Prisma, opts: { lookup?: TemplateLookup; reach?: AuthzScope } = {}) {
  const templates = { fetch: vi.fn().mockResolvedValue(opts.lookup ?? { state: 'found', template: TEMPLATE }) };
  const scopes = { scopeFor: vi.fn().mockResolvedValue(opts.reach ?? { global: false, projectIds: ['p-1'], siteIds: [] }) };
  return {
    templates, scopes,
    service: new WorkOrderService(prisma as unknown as PrismaClient, templates as unknown as TemplateLookupClient, scopes as unknown as UserScopeRepository),
  };
}

describe('WorkOrderService.create', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('creates one assigned, not-started work order per site, named after the site, in the order given', async () => {
    const { service: s, templates } = service(prisma);
    const { created } = await s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t');
    expect(templates.fetch).toHaveBeenCalledWith('tpl-1', 'Bearer t');
    expect(created.map((row) => (row as unknown as { title: string }).title)).toEqual([
      '[Quality Self-check]KOS102X sector A', '[Quality Self-check]SAKUWA GACHHI sector A',
    ]);
    expect(prisma.task.createMany.mock.calls[0]?.[0].data[0]).toMatchObject({
      projectId: 'p-1', siteId: 's-2', taskTypeId: null, templateId: 'tpl-1', templateName: 'Antenna + RRU',
      workOrderType: 'QUALITY_SELF_CHECK', status: 'NOT_STARTED', origin: 'AD_HOC', assigneeId: 'u-2', createdBy: 'u-1',
    });
  });

  it('records a CREATED timeline entry for each', async () => {
    const { service: s } = service(prisma);
    await s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t');
    const events = prisma.workOrderEvent.createMany.mock.calls[0]?.[0].data;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'CREATED', actorId: 'u-1', detail: { assigneeId: 'u-2', templateVersion: 2 } });
  });

  it('answers 404 for a project outside the caller’s scope, before asking qc', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    const { service: s, templates } = service(prisma);
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toBeInstanceOf(NotFoundException);
    expect(templates.fetch).not.toHaveBeenCalled();
  });

  it('refuses the whole batch when any site is not in the project', async () => {
    prisma.site.findMany.mockResolvedValue([SITES[0]]);
    const { service: s } = service(prisma);
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.task.createMany).not.toHaveBeenCalled();
  });

  it.each([
    [{ state: 'not_found' }, BadRequestException],
    [{ state: 'forbidden' }, ForbiddenException],
    [{ state: 'unavailable' }, ServiceUnavailableException],
    [{ state: 'found', template: { ...TEMPLATE, disabled: true } }, ConflictException],
    [{ state: 'found', template: { ...TEMPLATE, publishedVersion: null } }, ConflictException],
  ] as [TemplateLookup, new (...args: never[]) => Error][])('refuses %j', async (lookup, error) => {
    const { service: s } = service(prisma, { lookup });
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toBeInstanceOf(error);
    expect(prisma.task.createMany).not.toHaveBeenCalled();
  });

  it('refuses a template whose category does not match the type', async () => {
    const { service: s } = service(prisma, { lookup: { state: 'found', template: { ...TEMPLATE, category: 'EHS' } } });
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toThrow(/needs a Quality checklist/);
  });

  it('refuses a responsible person who cannot see every site, naming the sites', async () => {
    const { service: s } = service(prisma, { reach: { global: false, projectIds: [], siteIds: ['s-1'] } });
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toThrow(/no access to site KOS102X/);
    expect(prisma.task.createMany).not.toHaveBeenCalled();
  });

  it('names unreachable sites in the order they were chosen', async () => {
    const { service: s } = service(prisma, { reach: { global: false, projectIds: [], siteIds: [] } });
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toThrow(/sites KOS102X, L4KOS342/);
  });

  it.each([
    ['global', { global: true, projectIds: [], siteIds: [] }],
    ['project', { global: false, projectIds: ['p-1'], siteIds: [] }],
    ['every site', { global: false, projectIds: [], siteIds: ['s-1', 's-2'] }],
  ])('accepts a responsible person with %s scope', async (_label, reach) => {
    const { service: s } = service(prisma, { reach });
    await s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t');
    expect(prisma.task.createMany).toHaveBeenCalled();
  });
});

describe('WorkOrderService.list', () => {
  let prisma: Prisma;
  const NOW = new Date('2026-09-25T00:00:00Z');
  beforeEach(() => { prisma = makePrisma(); });
  const where = (call: { mock: { calls: unknown[][] } }) => JSON.stringify((call.mock.calls[0]?.[0] as { where: unknown }).where);

  it('lists across projects, restricted to work orders and scope, with project and site', async () => {
    const scoped: AuthzScope = { global: false, projectIds: [], siteIds: ['s-9'] };
    const { service: s } = service(prisma);
    await s.list(scoped, { page: 2, limit: 20 }, NOW);
    const args = prisma.task.findMany.mock.calls[0]?.[0];
    expect(args).toMatchObject({ skip: 20, take: 20, orderBy: [{ id: 'desc' }] });
    expect(args.include.project.select).toMatchObject({ code: true });
    expect(where(prisma.task.findMany)).toContain('"workOrderType":{"not":null}');
    for (const call of [prisma.task.findMany, prisma.task.count, prisma.task.groupBy]) expect(where(call)).toContain('s-9');
  });

  it('filters by project when asked', async () => {
    const { service: s } = service(prisma);
    await s.list(GLOBAL, { page: 1, limit: 20, projectId: 'p-7' }, NOW);
    expect(where(prisma.task.findMany)).toContain('"projectId":"p-7"');
  });

  it('orders open work by due date and closed work by completion', async () => {
    const { service: s } = service(prisma);
    await s.list(GLOBAL, { page: 1, limit: 20, view: 'open' }, NOW);
    expect(prisma.task.findMany.mock.calls[0]?.[0].orderBy[0]).toEqual({ plannedCompletionAt: { sort: 'asc', nulls: 'last' } });
    await s.list(GLOBAL, { page: 1, limit: 20, view: 'closed' }, NOW);
    expect(prisma.task.findMany.mock.calls[1]?.[0].orderBy[0]).toEqual({ actualCompletionAt: { sort: 'desc', nulls: 'last' } });
  });

  it('treats overdue as open work past its date', async () => {
    const { service: s } = service(prisma);
    await s.list(GLOBAL, { page: 1, limit: 20, view: 'overdue' }, NOW);
    const text = where(prisma.task.findMany);
    expect(text).toContain('"plannedCompletionAt":{"lt":"2026-09-25T00:00:00.000Z"}');
    expect(text).toContain('RECTIFYING');
    expect(text).not.toContain('COMPLETED');
  });

  it('applies status and view to the page but not to the counts', async () => {
    const { service: s } = service(prisma);
    await s.list(GLOBAL, { page: 1, limit: 20, status: 'COMPLETED' }, NOW);
    expect(where(prisma.task.findMany)).toContain('"status":"COMPLETED"');
    expect(where(prisma.task.groupBy)).not.toContain('COMPLETED');
  });

  it('searches title, template, site and project code', async () => {
    const { service: s } = service(prisma);
    await s.list(GLOBAL, { page: 1, limit: 20, q: 'kos' }, NOW);
    const text = where(prisma.task.findMany);
    for (const field of ['"title"', '"templateName"', '"siteCode"', '"project":{"code"']) expect(text).toContain(field);
  });

  it('fills every count, zero included, with the overdue view', async () => {
    prisma.task.groupBy.mockResolvedValue([{ status: 'COMPLETED', _count: { _all: 5 } }, { status: 'ONGOING', _count: { _all: 2 } }]);
    prisma.task.count.mockResolvedValueOnce(7).mockResolvedValueOnce(1);
    const { service: s } = service(prisma);
    const page = await s.list(GLOBAL, { page: 1, limit: 20 }, NOW);
    expect(page.counts).toEqual({ ALL: 7, OVERDUE: 1, NOT_STARTED: 0, ONGOING: 2, REVIEWING: 0, RECTIFYING: 0, COMPLETED: 5, CANCELLED: 0 });
  });
});

describe('WorkOrderService.update and cancel', () => {
  let prisma: Prisma;
  const OPEN_ORDER = {
    id: 'w-1', projectId: 'p-1', status: 'NOT_STARTED', assigneeId: 'u-2',
    plannedCompletionAt: new Date('2026-09-30T00:00:00Z'), site: { id: 's-1', siteCode: 'L4KOS342' },
  };
  beforeEach(() => {
    prisma = makePrisma();
    prisma.task.findFirst.mockResolvedValue(OPEN_ORDER);
  });

  it('reassigns and reschedules, recording both on the timeline', async () => {
    const { service: s } = service(prisma);
    await s.update(GLOBAL, 'w-1', { assigneeId: 'u-3', plannedCompletionAt: new Date('2026-10-05T00:00:00Z') }, 'u-1');
    expect(prisma.task.update).toHaveBeenCalledWith({ where: { id: 'w-1' }, data: { assigneeId: 'u-3', plannedCompletionAt: new Date('2026-10-05T00:00:00Z') } });
    expect(prisma.workOrderEvent.create.mock.calls.map((call) => call[0].data.kind)).toEqual(['REASSIGNED', 'RESCHEDULED']);
  });

  it('writes nothing when nothing changes', async () => {
    const { service: s } = service(prisma);
    await s.update(GLOBAL, 'w-1', { assigneeId: 'u-2' }, 'u-1');
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('refuses to reassign to someone who cannot see the site', async () => {
    const { service: s } = service(prisma, { reach: { global: false, projectIds: [], siteIds: [] } });
    await expect(s.update(GLOBAL, 'w-1', { assigneeId: 'u-3' }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['COMPLETED', 'CANCELLED'])('refuses to change a %s work order', async (status) => {
    prisma.task.findFirst.mockResolvedValue({ ...OPEN_ORDER, status });
    const { service: s } = service(prisma);
    await expect(s.update(GLOBAL, 'w-1', { assigneeId: 'u-3' }, 'u-1')).rejects.toBeInstanceOf(ConflictException);
    await expect(s.cancel(GLOBAL, 'w-1', { reason: 'no longer needed' }, 'u-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels conditionally, with the reason on the task and the timeline', async () => {
    const { service: s } = service(prisma);
    await s.cancel(GLOBAL, 'w-1', { reason: 'Site handed back' }, 'u-1');
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { id: 'w-1', status: { in: ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'] } },
      data: { status: 'CANCELLED', cancelReason: 'Site handed back' },
    });
    expect(prisma.workOrderEvent.create.mock.calls[0]?.[0].data).toMatchObject({ kind: 'CANCELLED', detail: { reason: 'Site handed back' } });
  });

  it('refuses a cancel that loses a race with a review', async () => {
    prisma.task.updateMany.mockResolvedValue({ count: 0 });
    const { service: s } = service(prisma);
    await expect(s.cancel(GLOBAL, 'w-1', { reason: 'Site handed back' }, 'u-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.workOrderEvent.create).not.toHaveBeenCalled();
  });

  it('answers 404 for a work order out of scope', async () => {
    prisma.task.findFirst.mockResolvedValue(null);
    const { service: s } = service(prisma);
    await expect(s.get(GLOBAL, 'w-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkOrderService.assignable', () => {
  it('groups scope rows per user: whole project, or the sites they hold', async () => {
    const prisma = makePrisma();
    prisma.site.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]);
    prisma.userScope.findMany.mockResolvedValue([
      { userId: 'u-g', level: 'GLOBAL', siteId: null },
      { userId: 'u-s', level: 'SITE', siteId: 's-1' },
      { userId: 'u-s', level: 'SITE', siteId: 's-2' },
    ]);
    const { service: s } = service(prisma);
    expect(await s.assignable(GLOBAL, 'p-1')).toEqual([
      { userId: 'u-g', wholeProject: true, siteIds: [] },
      { userId: 'u-s', wholeProject: false, siteIds: ['s-1', 's-2'] },
    ]);
  });
});
