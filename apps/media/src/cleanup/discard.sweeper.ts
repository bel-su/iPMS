import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/media';
import type { MediaStatus } from '@ipms/contracts';
import { createLogger } from '@ipms/observability';
import type { MediaDiscarder } from '../media/discarder.js';
import { PRE_ATTACH } from '../media/status.js';

// Exported (only) so tests can silence its expected error line for per-row
// discard failures without changing what production logs.
export const log = createLogger('media');
const HOUR_MS = 3_600_000;
/** Shortly after boot, rather than waiting a full hour for the first pass. */
const FIRST_SWEEP_DELAY_MS = 60_000;
const BATCH = 100;

/** Removes cancelled work orders' leftovers once their grace period ends. Attached evidence is never selected. */
@Injectable()
export class DiscardSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private initialTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly discarder: MediaDiscarder,
    private readonly batchSize = BATCH,
  ) {}

  onModuleInit(): void {
    this.initialTimer = setTimeout(() => {
      void this.sweep().catch((err: unknown) => log.error({ err }, 'discard sweep failed'));
    }, FIRST_SWEEP_DELAY_MS);
    this.timer = setInterval(() => { void this.sweep().catch((err: unknown) => log.error({ err }, 'discard sweep failed')); }, HOUR_MS);
  }

  onModuleDestroy(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Sweeps batches of `batchSize` in one pass, so a backlog past one batch
   * doesn't have to wait for the next hourly tick. Keeps going only while a
   * batch both came back full (more may be waiting) and actually discarded
   * something; a batch that discards nothing — every row in it failing —
   * stops the pass rather than spinning on the same failing rows forever.
   */
  async sweep(now = new Date()): Promise<number> {
    let total = 0;
    for (;;) {
      const due = await this.prisma.mediaObject.findMany({
        where: { discardAfter: { lte: now }, status: { in: [...PRE_ATTACH] as MediaStatus[] } },
        take: this.batchSize,
      });
      let discarded = 0;
      for (const row of due) {
        try {
          if (await this.discarder.discard(row, null, 'media.discarded_after_cancel')) discarded++;
        } catch (err) {
          log.error({ err, mediaId: row.id }, 'discard failed, continuing sweep');
        }
      }
      total += discarded;
      if (due.length < this.batchSize || discarded === 0) break;
    }
    return total;
  }
}
