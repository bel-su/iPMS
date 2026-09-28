import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/media';
import type { MediaStatus } from '@ipms/contracts';
import { createLogger } from '@ipms/observability';
import type { MediaDiscarder } from '../media/discarder.js';
import { PRE_ATTACH } from '../media/status.js';

const log = createLogger('media');
const HOUR_MS = 3_600_000;
const BATCH = 100;

/** Removes cancelled work orders' leftovers once their grace period ends. Attached evidence is never selected. */
@Injectable()
export class DiscardSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaClient, private readonly discarder: MediaDiscarder) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.sweep().catch((err: unknown) => log.error({ err }, 'discard sweep failed')); }, HOUR_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<number> {
    const due = await this.prisma.mediaObject.findMany({
      where: { discardAfter: { lte: now }, status: { in: [...PRE_ATTACH] as MediaStatus[] } },
      take: BATCH,
    });
    let discarded = 0;
    for (const row of due) {
      try {
        if (await this.discarder.discard(row, null, 'media.discarded_after_cancel')) discarded++;
      } catch (err) {
        log.error({ err, mediaId: row.id }, 'discard failed, continuing sweep');
      }
    }
    return discarded;
  }
}
