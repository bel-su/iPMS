import { createHash } from 'node:crypto';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import { MEDIA_LIMITS, MIB, type MediaKind, type RejectReason } from '@ipms/contracts';
import { createLogger } from '@ipms/observability';
import { recordAudit } from '../media/audit.js';
import { mediaRejected, verifyDuration, verifyQueueDepth, verifyStuck } from '../metrics.js';
import type { StorageClient } from '../storage/storage.client.js';
import { sniffMatches } from './sniff.js';

// Exported (only) so the retry test can silence its expected NoSuchKey
// warn/error lines without changing what production logs.
export const log = createLogger('media');
export const MAX_VERIFY_ATTEMPTS = 5;
export const LEASE_SECONDS = 300;
export const POSTER_MAX_BYTES = 1 * MIB;
const BATCH = 2;
const POLL_MS = 1000;

export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** (attempt - 1), 3600);
}

type Outcome = { status: 'READY' } | { status: 'REJECTED'; reason: RejectReason };

/**
 * Re-reads every completed upload from storage and checks it against what the
 * phone declared at capture. Claims work with a lease (nextAttemptAt pushed
 * forward under SKIP LOCKED), so a worker that dies mid-object simply lets the
 * lease expire and the object is picked up again.
 */
@Injectable()
export class VerifyWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaClient, private readonly storage: StorageClient) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.runOnce().catch((err: unknown) => log.error({ err }, 'verification pass failed')).finally(() => { this.running = false; });
    }, POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<number> {
    // A row whose *previous* claim already used up its last attempt (its
    // process died mid-verify — OOM, kill -9 — so it never reached retry())
    // would otherwise be re-leased forever: nothing but retry() ever set
    // nextAttemptAt to null, and a crash never runs retry(). Park those rows
    // first, unconditionally, before claiming anything new.
    const stuck = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE media_object SET "nextAttemptAt" = NULL
      WHERE status = 'VERIFYING' AND "nextAttemptAt" <= now() AND "verifyAttempts" >= ${MAX_VERIFY_ATTEMPTS}::int
      RETURNING id`;
    for (const { id } of stuck) {
      log.error({ mediaId: id, attempts: MAX_VERIFY_ATTEMPTS }, 'verification retries exhausted; needs an operator');
      verifyStuck.inc();
    }

    // ${LEASE_SECONDS}/${BATCH}/${MAX_VERIFY_ATTEMPTS} are cast explicitly:
    // Prisma's tagged-template parameterization can't infer that a numeric
    // literal here means "int", and `* interval '1 second'` / `LIMIT $n` /
    // a bare integer comparison all need one.
    //
    // verifyAttempts is bumped as part of the claim itself, not only on a
    // caught failure: a process that dies mid-verify never reaches retry(),
    // so counting the attempt here is what lets the park step above
    // eventually catch a row that keeps crashing the worker. The subquery
    // excludes rows already at the cap so this claim never hands out a 6th
    // attempt on a row the park step above was meant to catch.
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE media_object SET
        "nextAttemptAt" = now() + (${LEASE_SECONDS}::int * interval '1 second'),
        "verifyAttempts" = "verifyAttempts" + 1
      WHERE id IN (
        SELECT id FROM media_object
        WHERE status = 'VERIFYING' AND "nextAttemptAt" <= now() AND "verifyAttempts" < ${MAX_VERIFY_ATTEMPTS}::int
        ORDER BY "nextAttemptAt" LIMIT ${BATCH}::int
        FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    verifyQueueDepth.set(await this.prisma.mediaObject.count({ where: { status: 'VERIFYING', nextAttemptAt: { not: null } } }));
    for (const { id } of claimed) {
      const row = await this.prisma.mediaObject.findUniqueOrThrow({ where: { id } });
      const stop = verifyDuration.startTimer();
      try {
        await this.settle(row, await this.verify(row));
      } catch (err) {
        await this.retry(row, err);
      } finally {
        stop();
      }
    }
    return claimed.length;
  }

  private async verify(row: MediaObject): Promise<Outcome> {
    const hash = createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    const keep: Buffer[] = [];
    const limit = MEDIA_LIMITS[row.kind as MediaKind].maxBytes;
    for await (const chunk of await this.storage.getStream(row.storageKey)) {
      const buf = chunk as Buffer;
      hash.update(buf);
      size += buf.length;
      if (head.length < 16) head = Buffer.concat([head, buf.subarray(0, 16 - head.length)]);
      if (row.kind === 'PHOTO' && size <= limit) keep.push(buf);
    }
    if (hash.digest('hex') !== row.contentHash) return { status: 'REJECTED', reason: 'HASH_MISMATCH' };
    if (size > limit) return { status: 'REJECTED', reason: 'SIZE_EXCEEDED' };
    if (!sniffMatches(row.contentType, head)) return { status: 'REJECTED', reason: 'TYPE_MISMATCH' };

    if (row.kind === 'PHOTO') {
      let thumbnail: Buffer;
      try {
        thumbnail = await sharp(Buffer.concat(keep), { limitInputPixels: 50_000_000 })
          .rotate().resize(400, 400, { fit: 'inside' }).webp({ quality: 70 }).toBuffer();
      } catch {
        return { status: 'REJECTED', reason: 'TYPE_MISMATCH' }; // a JPEG header over undecodable bytes
      }
      await this.storage.put(row.thumbnailKey!, thumbnail, 'image/webp');
    } else {
      const poster = await this.storage.head(row.thumbnailKey!);
      if (!poster || poster.sizeBytes > POSTER_MAX_BYTES) return { status: 'REJECTED', reason: 'POSTER_MISSING' };
    }
    return { status: 'READY' };
  }

  /**
   * The row's uploader can discard it (MediaDiscarder) at any moment while a
   * verify pass is in flight, so every write here is conditioned on the row
   * still being VERIFYING — an unconditional update would resurrect a
   * discarded row as READY/REJECTED, and a REJECTED write would file a
   * `media.rejected` audit entry for a row nobody rejected via this pass.
   */
  private async settle(row: MediaObject, outcome: Outcome): Promise<void> {
    if (outcome.status === 'READY') {
      const { count } = await this.prisma.mediaObject.updateMany({
        where: { id: row.id, status: 'VERIFYING' },
        data: { status: 'READY', hashVerified: true, nextAttemptAt: null },
      });
      if (count === 0 && row.kind === 'PHOTO') {
        // The row left VERIFYING after we had already written its thumbnail.
        // That is not always a discard: another worker's lease may simply
        // have expired and a second pass already settled it READY first, in
        // which case the thumbnail is live and must not be touched. Re-read
        // the row and only clean up when it actually ended up discarded —
        // best effort, since an orphaned thumbnail is a storage leak, not
        // data corruption, and a failure here is logged rather than retried.
        const current = await this.prisma.mediaObject.findUnique({ where: { id: row.id }, select: { status: true } });
        if (current && (current.status === 'DISCARDED' || current.status === 'PURGED')) {
          try {
            await this.storage.delete([row.thumbnailKey!]);
          } catch (err) {
            log.error({ err, mediaId: row.id }, 'failed to remove an orphaned thumbnail after the row left VERIFYING mid-verify');
          }
        }
      }
      return;
    }

    const matched = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.mediaObject.updateMany({
        where: { id: row.id, status: 'VERIFYING' },
        data: { status: 'REJECTED', rejectReason: outcome.reason, nextAttemptAt: null },
      });
      if (count > 0) {
        await recordAudit(tx, { actorId: null, action: 'media.rejected', objectId: row.id, previousState: { status: row.status }, newState: { status: 'REJECTED', reason: outcome.reason } });
      }
      return count;
    });
    if (matched > 0) mediaRejected.inc({ reason: outcome.reason });
  }

  private async retry(row: MediaObject, err: unknown): Promise<void> {
    // The claim UPDATE already incremented verifyAttempts, so row.verifyAttempts
    // is this attempt's count — do not increment it again here.
    const attempts = row.verifyAttempts;
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      log.error({ err, mediaId: row.id, attempts }, 'verification retries exhausted; needs an operator');
      verifyStuck.inc();
      await this.prisma.mediaObject.updateMany({ where: { id: row.id, status: 'VERIFYING' }, data: { nextAttemptAt: null } });
      return;
    }
    log.warn({ err, mediaId: row.id, attempts }, 'verification failed, will retry');
    await this.prisma.mediaObject.updateMany({
      where: { id: row.id, status: 'VERIFYING' },
      data: { nextAttemptAt: new Date(Date.now() + backoffSeconds(attempts) * 1000) },
    });
  }
}
