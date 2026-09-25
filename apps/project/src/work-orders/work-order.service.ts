import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma-clients/project';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import {
  TaskStatusSchema, WORK_ORDER_TEMPLATE_CATEGORY, WORK_ORDER_TYPE_LABEL, uuidv7, workOrderTitle,
  type CancelWorkOrderDto, type CreateWorkOrdersDto, type ListWorkOrdersQueryDto, type UpdateWorkOrderDto,
  type WorkOrderEventKind, type WorkOrderStatusCounts,
} from '@ipms/contracts';
import type { UserScopeRepository } from '../scope/user-scope.repository.js';
import { siteScope, visibleProject } from '../scope/project-scope.js';
import type { TemplateLookup, TemplateLookupClient, TemplateRef } from './template-lookup.client.js';

const CATEGORY_LABEL: Record<string, string> = { QUALITY: 'Quality', EHS: 'EHS', OTHER: 'Other' };
const OPEN = ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'];
const CLOSED = ['COMPLETED', 'CANCELLED'];

/** What every list row and detail carries besides the task itself. */
const RELATIONS = {
  site: { select: { id: true, siteCode: true, name: true, city: true, area: true } },
  // The project code is the work order's Project ID (the DU): the same site
  // code exists in several projects, and only the project tells them apart.
  project: { select: { id: true, code: true, name: true } },
} as const;

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

/** Whether a user's replicated scope reaches this site: globally, through its project, or directly. */
function reaches(scope: AuthzScope, projectId: string, siteId: string): boolean {
  return scope.global || scope.projectIds.includes(projectId) || scope.siteIds.includes(siteId);
}

type Tx = Prisma.TransactionClient;

/**
 * Work orders: tasks raised against a QC checklist template.
 *
 * A work order is a `Task` with `workOrderType` set, so everything that reads
 * tasks — the field engineer's list, qc's checklist lookup, the dashboard's
 * counts — sees it without knowing the word. What this service adds is the
 * template and assignee checks at write time, and the timeline.
 */
@Injectable()
export class WorkOrderService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly templates: TemplateLookupClient,
    private readonly scopes: UserScopeRepository,
  ) {}

  /** One work order per site, all or none. */
  async create(scope: AuthzScope, projectId: string, dto: CreateWorkOrdersDto, actorId: string, bearer: string) {
    await this.requireProject(scope, projectId);
    const sites = await this.prisma.site.findMany({
      where: { AND: [{ id: { in: dto.siteIds }, projectId }, siteScope(scope)] },
      select: { id: true, siteCode: true, name: true },
    });
    if (sites.length !== dto.siteIds.length) throw new BadRequestException('Every site must belong to this project');

    const template = requireTemplate(await this.templates.fetch(dto.templateId, bearer));
    if (template.disabled) throw new ConflictException(`The checklist "${template.name}" has been disabled`);
    if (template.publishedVersion === null) throw new ConflictException(`The checklist "${template.name}" has not been published yet`);
    const needed = WORK_ORDER_TEMPLATE_CATEGORY[dto.workOrderType];
    if (template.category !== needed) {
      throw new BadRequestException(
        `A ${WORK_ORDER_TYPE_LABEL[dto.workOrderType]} needs a ${CATEGORY_LABEL[needed]} checklist; "${template.name}" is ${CATEGORY_LABEL[template.category] ?? template.category}`,
      );
    }
    // Ordered as the caller listed the sites, so refusals and the response read back in that order.
    const bySite = new Map(sites.map((site) => [site.id, site]));
    await this.requireReach(dto.assigneeId, projectId, dto.siteIds.map((id) => bySite.get(id)!));

    const now = new Date();
    const rows = dto.siteIds.map((siteId) => ({
      id: uuidv7(), projectId, siteId, taskTypeId: null,
      templateId: template.id, templateName: template.name, workOrderType: dto.workOrderType,
      title: workOrderTitle(dto.workOrderType, bySite.get(siteId)!.name, dto.note),
      status: 'NOT_STARTED', origin: 'AD_HOC', assigneeId: dto.assigneeId,
      plannedCompletionAt: dto.plannedCompletionAt, createdBy: actorId, createdAt: now,
    }));
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.task.createMany({ data: rows });
      await tx.workOrderEvent.createMany({
        data: rows.map((row) => ({
          id: uuidv7(), taskId: row.id, kind: 'CREATED', at: now, actorId,
          detail: { assigneeId: dto.assigneeId, plannedCompletionAt: dto.plannedCompletionAt.toISOString(), templateVersion: template.publishedVersion },
        })),
      });
      return tx.task.findMany({ where: { id: { in: rows.map((row) => row.id) } }, include: RELATIONS });
    });
    const order = new Map(rows.map((row, index) => [row.id, index]));
    return { created: created.sort((a, b) => order.get(a.id)! - order.get(b.id)!) };
  }

  /**
   * One page of work orders across every project the caller can see, with the
   * counts the filter pills show. The counts ignore the status and view
   * filters — every pill shows its own number whichever one is selected — but
   * honour the project, type, assignee and search, so they always describe
   * what those found.
   */
  async list(scope: AuthzScope, query: ListWorkOrdersQueryDto, now = new Date()) {
    const q = query.q || undefined;
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    // ANDed rather than spread: scopeWhere and the search both use an `OR` key.
    const base: Prisma.TaskWhereInput = {
      AND: [
        scopeWhere(scope),
        { workOrderType: query.workOrderType ?? { not: null } },
        ...(query.projectId ? [{ projectId: query.projectId }] : []),
        ...(query.assigneeId ? [{ assigneeId: query.assigneeId }] : []),
        ...(q ? [{ OR: [
          { title: contains(q) }, { templateName: contains(q) },
          { site: { siteCode: contains(q) } }, { site: { name: contains(q) } },
          { project: { code: contains(q) } },
        ] }] : []),
      ],
    };
    const overdue: Prisma.TaskWhereInput = { status: { in: OPEN }, plannedCompletionAt: { lt: now } };
    const view: Prisma.TaskWhereInput | null =
      query.view === 'open' ? { status: { in: OPEN } }
        : query.view === 'overdue' ? overdue
          : query.view === 'closed' ? { status: { in: CLOSED } }
            : null;
    const where: Prisma.TaskWhereInput = { AND: [base, ...(query.status ? [{ status: query.status }] : []), ...(view ? [view] : [])] };

    // Open work is read by what is due next; closed work by what finished last.
    const closedOnly = query.view === 'closed' || (query.status !== undefined && CLOSED.includes(query.status));
    const openOnly = query.view === 'open' || query.view === 'overdue' || (query.status !== undefined && OPEN.includes(query.status));
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = closedOnly
      ? [{ actualCompletionAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
      : openOnly ? [{ plannedCompletionAt: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }]
        : [{ id: 'desc' }];

    const [items, total, grouped, overdueCount] = await Promise.all([
      this.prisma.task.findMany({ where, include: RELATIONS, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.task.count({ where }),
      this.prisma.task.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.task.count({ where: { AND: [base, overdue] } }),
    ]);
    const counts = Object.fromEntries([['ALL', 0], ['OVERDUE', overdueCount], ...TaskStatusSchema.options.map((status) => [status, 0])]) as WorkOrderStatusCounts;
    for (const row of grouped) {
      const status = row.status as keyof WorkOrderStatusCounts;
      if (status in counts) counts[status] = row._count._all;
      counts.ALL += row._count._all;
    }
    return { items, total, page: query.page, limit: query.limit, counts };
  }

  async get(scope: AuthzScope, id: string) {
    const found = await this.prisma.task.findFirst({
      where: { AND: [{ id, workOrderType: { not: null } }, scopeWhere(scope)] },
      include: { ...RELATIONS, events: { orderBy: [{ at: 'asc' }, { id: 'asc' }] } },
    });
    if (!found) throw new NotFoundException('Work order not found');
    return found;
  }

  /** Reassign and/or reschedule. Closed work orders are history and stay as they were. */
  async update(scope: AuthzScope, id: string, dto: UpdateWorkOrderDto, actorId: string) {
    const current = await this.requireOpen(scope, id);
    const reassign = dto.assigneeId !== undefined && dto.assigneeId !== current.assigneeId;
    const reschedule = dto.plannedCompletionAt !== undefined && dto.plannedCompletionAt.getTime() !== current.plannedCompletionAt?.getTime();
    if (!reassign && !reschedule) return this.get(scope, id);
    if (reassign) await this.requireReach(dto.assigneeId!, current.projectId, [current.site]);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: { ...(reassign ? { assigneeId: dto.assigneeId! } : {}), ...(reschedule ? { plannedCompletionAt: dto.plannedCompletionAt! } : {}) },
      });
      if (reassign) await event(tx, id, 'REASSIGNED', now, actorId, { from: current.assigneeId, to: dto.assigneeId! });
      if (reschedule) {
        await event(tx, id, 'RESCHEDULED', now, actorId, { from: current.plannedCompletionAt?.toISOString() ?? null, to: dto.plannedCompletionAt!.toISOString() });
      }
    });
    return this.get(scope, id);
  }

  async cancel(scope: AuthzScope, id: string, dto: CancelWorkOrderDto, actorId: string) {
    await this.requireOpen(scope, id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Conditional, so a review landing between the check and the write is not overwritten.
      const changed = await tx.task.updateMany({ where: { id, status: { in: OPEN } }, data: { status: 'CANCELLED', cancelReason: dto.reason } });
      if (changed.count === 0) throw new ConflictException('This work order has just been closed');
      await event(tx, id, 'CANCELLED', now, actorId, { reason: dto.reason });
    });
    return this.get(scope, id);
  }

  /**
   * Who could be made responsible for work in this project: every user whose
   * replicated scope reaches it, with how far. The web intersects this with the
   * name directory, and narrows by site for site-scoped people.
   */
  async assignable(scope: AuthzScope, projectId: string) {
    await this.requireProject(scope, projectId);
    const siteIds = (await this.prisma.site.findMany({ where: { projectId }, select: { id: true } })).map((site) => site.id);
    const rows = await this.prisma.userScope.findMany({
      where: { OR: [{ level: 'GLOBAL' }, { level: 'PROJECT', projectId }, { level: 'SITE', siteId: { in: siteIds } }] },
      select: { userId: true, level: true, siteId: true },
    });
    const byUser = new Map<string, { userId: string; wholeProject: boolean; siteIds: string[] }>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? { userId: row.userId, wholeProject: false, siteIds: [] };
      if (row.level === 'SITE' && row.siteId) entry.siteIds.push(row.siteId);
      else entry.wholeProject = true;
      byUser.set(row.userId, entry);
    }
    return [...byUser.values()];
  }

  /**
   * The responsible person must be able to see every site they are given:
   * otherwise the work order lands on a list they cannot open. Checked against
   * the same replicated projection that decides what they can see.
   */
  private async requireReach(userId: string, projectId: string, sites: { id: string; siteCode: string }[]): Promise<void> {
    const reach = await this.scopes.scopeFor(userId);
    const missing = sites.filter((site) => !reaches(reach, projectId, site.id));
    if (missing.length > 0) {
      const codes = missing.slice(0, 5).map((site) => site.siteCode).join(', ');
      throw new BadRequestException(
        `The responsible person has no access to ${missing.length === 1 ? 'site' : 'sites'} ${codes}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}. Grant them access to the project or those sites first.`,
      );
    }
  }

  private async requireOpen(scope: AuthzScope, id: string) {
    const found = await this.prisma.task.findFirst({
      where: { AND: [{ id, workOrderType: { not: null } }, scopeWhere(scope)] },
      include: { site: { select: { id: true, siteCode: true } } },
    });
    if (!found) throw new NotFoundException('Work order not found');
    if (CLOSED.includes(found.status)) throw new ConflictException(`This work order is ${found.status === 'COMPLETED' ? 'completed' : 'cancelled'} and can no longer be changed`);
    return found;
  }

  /** NotFound, never Forbidden — see the note on ProjectService's guards. */
  private async requireProject(scope: AuthzScope, id: string): Promise<void> {
    if (!await this.prisma.project.findFirst({ where: visibleProject(scope, id), select: { id: true } })) {
      throw new NotFoundException('Project not found');
    }
  }
}

async function event(tx: Tx, taskId: string, kind: WorkOrderEventKind, at: Date, actorId: string | null, detail: Prisma.InputJsonObject): Promise<void> {
  await tx.workOrderEvent.create({ data: { id: uuidv7(), taskId, kind, at, actorId, detail } });
}
