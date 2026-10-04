import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/media';
import { DurableConsumer, InMemoryDedupeStore, SUBJECTS, type EventBus, type QcWorkOrderCancelled } from '@ipms/events';
import type { MediaStatus } from '@ipms/contracts';
import { PRE_ATTACH } from '../media/status.js';

export const CANCEL_GRACE_DAYS = 30;

/**
 * A cancelled work order's unsubmitted evidence is kept 30 days, then
 * discarded by the sweeper. Idempotent on its own (only rows with no
 * discardAfter yet are touched), so an in-memory dedupe store is enough.
 */
@Injectable()
export class WorkOrderCancelledConsumer implements OnModuleInit {
  constructor(private readonly prisma: PrismaClient, private readonly bus: EventBus) {}

  async onModuleInit(): Promise<void> {
    const consumer = new DurableConsumer(this.bus, new InMemoryDedupeStore());
    await consumer.subscribe<QcWorkOrderCancelled>(SUBJECTS.QC_WORK_ORDER_CANCELLED, 'media-work-order-cancelled', async (envelope) => {
      await this.handle(envelope.payload);
    });
  }

  async handle(p: QcWorkOrderCancelled): Promise<number> {
    const discardAfter = new Date(Date.parse(p.cancelledAt) + CANCEL_GRACE_DAYS * 86_400_000);
    const result = await this.prisma.mediaObject.updateMany({
      where: { workOrderId: p.workOrderId, status: { in: [...PRE_ATTACH] as MediaStatus[] }, discardAfter: null },
      data: { discardAfter },
    });
    return result.count;
  }
}
