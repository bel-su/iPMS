import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import type { CreateWorkOrderDto } from '@ipms/contracts';
import { WorkOrderService } from './work-order.service.js';
import type { TemplateLookup, TemplateLookupClient } from './template-lookup.client.js';

const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const TEMPLATE = { id: 'tpl-1', code: 'Q6683', name: 'Antenna + RRU', category: 'QUALITY', disabled: false, publishedVersion: 2 };
const DTO: CreateWorkOrderDto = {
  workOrderType: 'QUALITY_SELF_CHECK', templateId: 'tpl-1', siteId: 's-1', assigneeId: 'u-2',
  plannedCompletionAt: new Date('2026-09-30T23:59:59Z'), title: '[Quality Self-check]SAKUWA GACHHI',
};

function makePrisma() {
  return {
    project: { findFirst: vi.fn().mockResolvedValue({ id: 'p-1' }) },
    site: { findFirst: vi.fn().mockResolvedValue({ id: 's-1' }) },
    task: {
      create: vi.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve(data)),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
}
type Prisma = ReturnType<typeof makePrisma>;

function service(prisma: Prisma, lookup: TemplateLookup = { state: 'found', template: TEMPLATE }) {
  const templates = { fetch: vi.fn().mockResolvedValue(lookup) };
  return { templates, service: new WorkOrderService(prisma as unknown as PrismaClient, templates as unknown as TemplateLookupClient) };
}

describe('WorkOrderService.create', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('creates an assigned, not-started task carrying the template and a snapshot of its name', async () => {
    const { service: s, templates } = service(prisma);
    await s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t');
    expect(templates.fetch).toHaveBeenCalledWith('tpl-1', 'Bearer t');
    expect(prisma.task.create.mock.calls[0]?.[0].data).toMatchObject({
      projectId: 'p-1', siteId: 's-1', taskTypeId: null, templateId: 'tpl-1', templateName: 'Antenna + RRU',
      workOrderType: 'QUALITY_SELF_CHECK', status: 'NOT_STARTED', origin: 'AD_HOC',
      assigneeId: 'u-2', createdBy: 'u-1', title: '[Quality Self-check]SAKUWA GACHHI',
    });
  });

  it('answers 404 for a project outside the caller’s scope, before asking qc', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    const { service: s, templates } = service(prisma);
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toBeInstanceOf(NotFoundException);
    expect(templates.fetch).not.toHaveBeenCalled();
  });

  it('refuses a site from another project', async () => {
    prisma.site.findFirst.mockResolvedValue(null);
    const { service: s } = service(prisma);
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('scopes the site lookup to the project', async () => {
    const { service: s } = service(prisma);
    await s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t');
    expect(JSON.stringify(prisma.site.findFirst.mock.calls[0]?.[0])).toContain('"projectId":"p-1"');
  });

  it.each([
    [{ state: 'not_found' }, BadRequestException],
    [{ state: 'forbidden' }, ForbiddenException],
    [{ state: 'unavailable' }, ServiceUnavailableException],
    [{ state: 'found', template: { ...TEMPLATE, disabled: true } }, ConflictException],
    [{ state: 'found', template: { ...TEMPLATE, publishedVersion: null } }, ConflictException],
  ] as [TemplateLookup, new (...args: never[]) => Error][])('refuses %j', async (lookup, error) => {
    const { service: s } = service(prisma, lookup);
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toBeInstanceOf(error);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('refuses a template whose category does not match the work order type', async () => {
    const { service: s } = service(prisma, { state: 'found', template: { ...TEMPLATE, category: 'EHS' } });
    await expect(s.create(GLOBAL, 'p-1', DTO, 'u-1', 'Bearer t')).rejects.toThrow(/needs a Quality checklist/);
  });

  it('accepts an EHS template for an EHS spot check', async () => {
    const { service: s } = service(prisma, { state: 'found', template: { ...TEMPLATE, category: 'EHS' } });
    await s.create(GLOBAL, 'p-1', { ...DTO, workOrderType: 'EHS_SPOT_CHECK' }, 'u-1', 'Bearer t');
    expect(prisma.task.create).toHaveBeenCalled();
  });
});

describe('WorkOrderService.list', () => {
  let prisma: Prisma;
  beforeEach(() => { prisma = makePrisma(); });

  it('pages newest first and restricts to work orders', async () => {
    const { service: s } = service(prisma);
    await s.list(GLOBAL, 'p-1', { page: 3, limit: 20 });
    const args = prisma.task.findMany.mock.calls[0]?.[0];
    expect(args).toMatchObject({ orderBy: { id: 'desc' }, skip: 40, take: 20 });
    expect(JSON.stringify(args.where)).toContain('"workOrderType":{"not":null}');
  });

  it('applies the status filter to the page but not to the tab counts', async () => {
    const { service: s } = service(prisma);
    await s.list(GLOBAL, 'p-1', { page: 1, limit: 20, status: 'COMPLETED' });
    expect(JSON.stringify(prisma.task.findMany.mock.calls[0]?.[0].where)).toContain('"status":"COMPLETED"');
    expect(JSON.stringify(prisma.task.groupBy.mock.calls[0]?.[0].where)).not.toContain('COMPLETED');
  });

  it('searches title, template name, site code and site name', async () => {
    const { service: s } = service(prisma);
    await s.list(GLOBAL, 'p-1', { page: 1, limit: 20, q: 'kos' });
    const where = JSON.stringify(prisma.task.findMany.mock.calls[0]?.[0].where);
    for (const field of ['"title"', '"templateName"', '"siteCode"', '"name"']) expect(where).toContain(field);
  });

  it('constrains every query by the caller’s scope', async () => {
    const scoped: AuthzScope = { global: false, projectIds: [], siteIds: ['s-9'] };
    const { service: s } = service(prisma);
    await s.list(scoped, 'p-1', { page: 1, limit: 20 });
    for (const call of [prisma.task.findMany, prisma.task.count, prisma.task.groupBy]) {
      expect(JSON.stringify(call.mock.calls[0]?.[0].where)).toContain('s-9');
    }
  });

  it('fills every status count, zero included, and totals them', async () => {
    prisma.task.groupBy.mockResolvedValue([
      { status: 'COMPLETED', _count: { _all: 5 } }, { status: 'ONGOING', _count: { _all: 2 } },
    ]);
    prisma.task.count.mockResolvedValue(7);
    const { service: s } = service(prisma);
    const page = await s.list(GLOBAL, 'p-1', { page: 1, limit: 20 });
    expect(page.counts).toEqual({ ALL: 7, NOT_STARTED: 0, ONGOING: 2, REVIEWING: 0, RECTIFYING: 0, COMPLETED: 5, CANCELLED: 0 });
    expect(page).toMatchObject({ total: 7, page: 1, limit: 20 });
  });
});
