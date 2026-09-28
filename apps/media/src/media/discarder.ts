import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import type { StorageClient } from '../storage/storage.client.js';
import { recordAudit } from './audit.js';

/**
 * Removes a file that never became evidence of record: a retake the engineer
 * threw away, or the unsubmitted leftovers of a cancelled work order. Storage
 * goes first, so a crash between the two leaves a row that is retried, never
 * an orphaned object nobody tracks.
 */
export class MediaDiscarder {
  constructor(private readonly prisma: PrismaClient, private readonly storage: StorageClient) {}

  async discard(row: MediaObject, actorId: string | null, action: 'media.discarded' | 'media.discarded_after_cancel'): Promise<void> {
    if (row.multipartUploadId) await this.storage.abortMultipart(row.storageKey, row.multipartUploadId);
    await this.storage.delete([row.storageKey, ...(row.thumbnailKey ? [row.thumbnailKey] : [])]);
    await this.prisma.$transaction(async (tx) => {
      await tx.mediaObject.update({ where: { id: row.id }, data: { status: 'DISCARDED', discardedAt: new Date(), multipartUploadId: null, nextAttemptAt: null } });
      await recordAudit(tx, { actorId, action, objectId: row.id, previousState: { status: row.status }, newState: { status: 'DISCARDED' } });
    });
  }
}
