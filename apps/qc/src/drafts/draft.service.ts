import { ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { Prisma, PrismaClient, WorkOrderDraft } from '@prisma-clients/qc';
import {
  DRAFT_MAX_BYTES, DRAFTABLE_STATUSES,
  type DraftItemResponse, type SaveDraftDto, type TakeoverDraftDto, type WorkOrderDraftView,
} from '@ipms/contracts';
import { recordAudit } from '../templates/audit.js';
import { draftHeldElsewhere, draftStale, workOrderClosed } from '../submissions/refusals.js';
import { event } from '../work-orders/work-order.service.js';

type Db = PrismaClient | Prisma.TransactionClient;

const view = (draft: WorkOrderDraft): WorkOrderDraftView => ({
  workOrderId: draft.workOrderId, version: draft.version, deviceId: draft.deviceId, deviceLabel: draft.deviceLabel,
  updatedAt: draft.updatedAt.toISOString(), responses: draft.responses as unknown as DraftItemResponse[],
});

/**
 * The assignee's in-progress checklist, kept so they can move to another device.
 *
 * One device holds it at a time. Another device must take it over explicitly;
 * after that, a save from the old device is refused, so a forgotten phone can
 * never overwrite newer work. Each save names the version it was based on.
 *
 * Every write locks the work order row first: that serialises the first save
 * (when there is no draft row to lock yet) as well as later ones.
 */
@Injectable()
export class DraftService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(workOrderId: string, actorId: string): Promise<WorkOrderDraftView> {
    const order = await this.requireWorkable(this.prisma, workOrderId, actorId);
    const draft = await this.prisma.workOrderDraft.findUnique({ where: { workOrderId } });
    if (draft) return view(draft);
    if (order.status === 'RECTIFYING' && order.currentSubmissionId) return this.prefill(workOrderId, order.currentSubmissionId);
    throw new NotFoundException('There is no draft for this work order');
  }

  async save(workOrderId: string, dto: SaveDraftDto, actorId: string): Promise<WorkOrderDraftView> {
    if (Buffer.byteLength(JSON.stringify(dto.responses)) > DRAFT_MAX_BYTES) throw new PayloadTooLargeException('This draft is too large to save');
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireWorkable(tx, workOrderId, actorId, true);
      const draft = await tx.workOrderDraft.findUnique({ where: { workOrderId } });
      const responses = dto.responses as unknown as Prisma.InputJsonArray;
      if (!draft) {
        if (dto.baseVersion !== 0) throw draftStale(0);
        const created = await tx.workOrderDraft.create({ data: { workOrderId, holderId: actorId, deviceId: dto.deviceId, deviceLabel: dto.deviceLabel, version: 1, responses } });
        if (order.status === 'NOT_STARTED') await this.start(tx, workOrderId, actorId);
        return view(created);
      }
      if (draft.deviceId !== dto.deviceId) throw draftHeldElsewhere(draft);
      if (draft.version !== dto.baseVersion) throw draftStale(draft.version);
      return view(await tx.workOrderDraft.update({ where: { workOrderId }, data: { deviceLabel: dto.deviceLabel, version: draft.version + 1, responses } }));
    });
  }

  async takeover(workOrderId: string, dto: TakeoverDraftDto, actorId: string): Promise<WorkOrderDraftView> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireWorkable(tx, workOrderId, actorId, true);
      const draft = await tx.workOrderDraft.findUnique({ where: { workOrderId } });
      if (!draft) throw new NotFoundException('There is no draft for this work order');
      return view(await tx.workOrderDraft.update({ where: { workOrderId }, data: { deviceId: dto.deviceId, deviceLabel: dto.deviceLabel, version: draft.version + 1 } }));
    });
  }

  private async requireWorkable(db: Db, workOrderId: string, actorId: string, lock = false) {
    if (lock) await db.$queryRaw`SELECT id FROM work_order WHERE id = ${workOrderId}::uuid FOR UPDATE`;
    const order = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { status: true, assigneeId: true, currentSubmissionId: true } });
    if (!order) throw new NotFoundException('Work order not found');
    if (order.assigneeId !== actorId) throw new ForbiddenException('This work order is not assigned to you');
    if (!(DRAFTABLE_STATUSES as readonly string[]).includes(order.status)) throw workOrderClosed();
    return order;
  }

  /** The first save: managers see that work has begun. */
  private async start(tx: Prisma.TransactionClient, workOrderId: string, actorId: string): Promise<void> {
    await tx.workOrder.update({ where: { id: workOrderId }, data: { status: 'ONGOING' } });
    await recordAudit(tx, {
      actorId, action: 'work_order.status_changed', objectType: 'WorkOrder', objectId: workOrderId,
      previousState: { status: 'NOT_STARTED' }, newState: { status: 'ONGOING' },
    });
    await event(tx, workOrderId, 'STARTED', new Date(), actorId, {});
  }

  /** Rework starts from the last attempt: same answers, same files. Not saved until the phone saves it. */
  private async prefill(workOrderId: string, submissionId: string): Promise<WorkOrderDraftView> {
    const responses = await this.prisma.itemResponse.findMany({
      where: { submissionId }, include: { media: { orderBy: { sequence: 'asc' } } }, orderBy: { id: 'asc' },
    });
    return {
      workOrderId, version: 0, deviceId: null, deviceLabel: null, updatedAt: null,
      responses: responses.map((r) => ({
        itemId: r.itemId,
        selfCheckResult: r.selfCheckResult as DraftItemResponse['selfCheckResult'],
        ...(r.selfCheckDescription !== null ? { selfCheckDescription: r.selfCheckDescription } : {}),
        ...(r.textValue !== null ? { textValue: r.textValue } : {}),
        ...(r.numberValue !== null ? { numberValue: Number(r.numberValue.toString()) } : {}),
        ...(r.booleanValue !== null ? { booleanValue: r.booleanValue } : {}),
        ...(r.selectValue !== null ? { selectValue: r.selectValue } : {}),
        mediaIds: r.media.map((m) => m.mediaId),
      })),
    };
  }
}
