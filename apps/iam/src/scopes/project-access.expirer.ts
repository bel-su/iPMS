import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createLogger } from '@ipms/observability';
import type { ScopesService } from './scopes.service.js';

const log = createLogger('iam');
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Revokes project access whose year has run out. Hourly is fine: reads already
 * ignore a lapsed grant (`listForUser`, `toScope`), so the sweep only has to
 * bring the replicas in step.
 */
@Injectable()
export class ProjectAccessExpirer implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly scopes: ScopesService) {}

  onModuleInit(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      const removed = await this.scopes.expireDue();
      if (removed > 0) log.info({ removed }, 'expired project access revoked');
    } catch (err) {
      log.error({ err }, 'project access expiry sweep failed');
    }
  }
}
