import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import {
  TaskStatusSchema, WORK_ORDER_TEMPLATE_CATEGORY, uuidv7,
  type CreateWorkOrderDto, type ListWorkOrdersQueryDto, type WorkOrderStatusCounts,
} from '@ipms/contracts';
import { siteScope, visibleProject } from '../scope/project-scope.js';
import type { TemplateLookup, TemplateLookupClient, TemplateRef } from './template-lookup.client.js';

const TYPE_LABEL: Record<CreateWorkOrderDto['workOrderType'], string> = {
  QUALITY_SELF_CHECK: 'Quality self-check', QUALITY_SPOT_CHECK: 'Quality spot check',
  EHS_SELF_CHECK: 'EHS self-check', EHS_SPOT_CHECK: 'EHS spot check',
};
const CATEGORY_LABEL: Record<string, string> = { QUALITY: 'Quality', EHS: 'EHS', OTHER: 'Other' };

/** The site columns the work order list shows beside each row. */
const SITE_SELECT = { select: { siteCode: true, name: true, city: true, area: true } } as const;

function requireTemplate(lookup: TemplateLookup): TemplateRef {
  switch (lookup.state) {
    case 'found': return lookup.template;
    // 400 rather than 404: the work order is what was requested, and its
    // template reference is a bad field in that request.
    case 'not_found': throw new BadRequestException('The selected checklist template does not exist');
    case 'forbidden': throw new ForbiddenException('You cannot use checklist templates');
    case 'unavailable': throw new ServiceUnavailableException('The QC service could not be reached. Try again shortly.');
  }
}

/**
 * Work orders: tasks raised against a QC checklist template.
 *
 * A work order is a `Task` with `workOrderType` set, so everything that reads
 * tasks — the field engineer's list, qc's checklist lookup, the dashboard's
 * counts — sees it without knowing the word. What this service adds is the
 * template check at write time, which `createTask` has never done.
 */
@Injectable()
export class WorkOrderService {
  constructor(private readonly prisma: PrismaClient, private readonly templates: TemplateLookupClient) {}

  async create(scope: AuthzScope, projectId: string, dto: CreateWorkOrderDto, actorId: string, bearer: string) {
    await this.requireProject(scope, projectId);
    const site = await this.prisma.site.findFirst({ where: { AND: [{ id: dto.siteId, projectId }, siteScope(scope)] }, select: { id: true } });
    if (!site) throw new BadRequestException('The site must belong to this project');

    const template = requireTemplate(await this.templates.fetch(dto.templateId, bearer));
    if (template.disabled) throw new ConflictException(`The checklist "${template.name}" has been disabled`);
    if (template.publishedVersion === null) throw new ConflictException(`The checklist "${template.name}" has not been published yet`);
    const needed = WORK_ORDER_TEMPLATE_CATEGORY[dto.workOrderType];
    if (template.category !== needed) {
      throw new BadRequestException(
        `A ${TYPE_LABEL[dto.workOrderType]} needs a ${CATEGORY_LABEL[needed]} checklist; "${template.name}" is ${CATEGORY_LABEL[template.category] ?? template.category}`,
      );
    }

    return this.prisma.task.create({
      data: {
        id: uuidv7(), projectId, siteId: dto.siteId, taskTypeId: null,
        templateId: template.id, templateName: template.name, workOrderType: dto.workOrderType,
        title: dto.title, status: 'NOT_STARTED', origin: 'AD_HOC',
        assigneeId: dto.assigneeId, plannedCompletionAt: dto.plannedCompletionAt, createdBy: actorId,
      },
      include: { site: SITE_SELECT },
    });
  }

  /**
   * One page of a project's work orders, newest first, with the per-status
   * counts the tabs show. The counts ignore the status filter — every tab
   * shows its own number whichever tab is open — but honour the search, so
   * the numbers always describe what the search found.
   */
  async list(scope: AuthzScope, projectId: string, query: ListWorkOrdersQueryDto) {
    await this.requireProject(scope, projectId);
    const q = query.q || undefined;
    // ANDed rather than spread: scopeWhere and the search both use an `OR` key.
    const base = {
      AND: [
        { projectId },
        scopeWhere(scope),
        { workOrderType: query.workOrderType ?? { not: null } },
        ...(q ? [{ OR: [
          { title: { contains: q, mode: 'insensitive' as const } },
          { templateName: { contains: q, mode: 'insensitive' as const } },
          { site: { siteCode: { contains: q, mode: 'insensitive' as const } } },
          { site: { name: { contains: q, mode: 'insensitive' as const } } },
        ] }] : []),
      ],
    };
    const where = query.status ? { AND: [base, { status: query.status }] } : base;
    const [items, total, grouped] = await Promise.all([
      this.prisma.task.findMany({
        where, include: { site: SITE_SELECT },
        // id is a uuidv7, so this is creation order — Task has no createdAt.
        orderBy: { id: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit,
      }),
      this.prisma.task.count({ where }),
      this.prisma.task.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries([['ALL', 0], ...TaskStatusSchema.options.map((status) => [status, 0])]) as WorkOrderStatusCounts;
    for (const row of grouped) {
      const status = row.status as keyof WorkOrderStatusCounts;
      if (status in counts) counts[status] = row._count._all;
      counts.ALL += row._count._all;
    }
    return { items, total, page: query.page, limit: query.limit, counts };
  }

  /** NotFound, never Forbidden — see the note on ProjectService's guards. */
  private async requireProject(scope: AuthzScope, id: string): Promise<void> {
    if (!await this.prisma.project.findFirst({ where: visibleProject(scope, id), select: { id: true } })) {
      throw new NotFoundException('Project not found');
    }
  }
}
