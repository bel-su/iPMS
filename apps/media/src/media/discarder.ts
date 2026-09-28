import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import type { StorageClient } from '../storage/storage.client.js';
import { recordAudit } from './audit.js';
import { PRE_ATTACH } from './status.js';

/**
 * Removes a file that never became evidence of record: a retake the engineer
 * threw away, or the unsubmitted leftovers of a cancelled work order.
 *
 * The row is claimed first — moved to DISCARDED only if it is still in a
 * PRE_ATTACH state — and only a successful claim proceeds to delete storage.
 * This closes a race with attach: without the claim, a discard that read the
 * row as READY could delete the bytes (and overwrite the row) of a file an
 * attach had, in the meantime, already turned into evidence of record.
 *
 * The trade-off: a crash between the claim and the storage delete leaves the
 * objects orphaned in storage (wasted bytes, cheap to sweep later) rather
 * than risking the deletion of evidence of record. That is the acceptable
 * direction for this failure to lean.
 */
export class MediaDiscarder {
  constructor(private readonly prisma: PrismaClient, private readonly storage: StorageClient) {}

  /** Whether this call discarded the row — false if it lost the race (e.g. to an attach). */
  async discard(row: MediaObject, actorId: string | null, action: 'media.discarded' | 'media.discarded_after_cancel'): Promise<boolean> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.mediaObject.updateMany({
        where: { id: row.id, status: { in: [...PRE_ATTACH] } },
        data: { status: 'DISCARDED', discardedAt: new Date(), multipartUploadId: null, nextAttemptAt: null },
      });
      if (updated.count !== 1) return false;
      await recordAudit(tx, { actorId, action, objectId: row.id, previousState: { status: row.status }, newState: { status: 'DISCARDED' } });
      return true;
    });
    if (!claimed) return false;

    if (row.multipartUploadId) await this.storage.abortMultipart(row.storageKey, row.multipartUploadId);
    await this.storage.delete([row.storageKey, ...(row.thumbnailKey ? [row.thumbnailKey] : [])]);
    return true;
  }
}
