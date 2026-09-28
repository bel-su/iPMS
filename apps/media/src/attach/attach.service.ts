import { ConflictException } from '@nestjs/common';
import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import type { AttachRequestDto, AttachedMedia, MediaKind } from '@ipms/contracts';

const num = (value: { toString(): string } | null): number | null => (value === null ? null : Number(value.toString()));

/**
 * qc's submit-time check: every referenced file exists, is verified, belongs
 * to the submission's site, and is not already evidence in another
 * submission. All or nothing, and repeat-safe for the same submission.
 */
export class AttachService {
  constructor(private readonly prisma: PrismaClient) {}

  async attach(dto: AttachRequestDto): Promise<AttachedMedia[]> {
    // A submission may reference the same file twice; dedupe for locking,
    // reading and counting so `updateMany`'s distinct-row count (below) can
    // be compared like-for-like. The response still has one entry per
    // requested id, in the caller's order.
    const ids = [...new Set(dto.mediaIds)];
    return this.prisma.$transaction(async (tx) => {
      // Lock the requested rows before validating: at READ COMMITTED (Postgres'
      // default), two concurrent attaches of the same READY file would both
      // read it as READY and both pass validation, so the loser's later
      // `updateMany` would silently match zero rows. FOR UPDATE makes the
      // second transaction block here until the first commits, so it then
      // reads the post-commit state and correctly refuses. Locked in a
      // stable order (by id) so two overlapping multi-file attaches can
      // never deadlock on each other.
      await tx.$queryRaw`SELECT id FROM media_object WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
      const rows = await tx.mediaObject.findMany({ where: { id: { in: ids } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const usable = (row: MediaObject | undefined): row is MediaObject =>
        !!row && row.siteId === dto.siteId &&
        (row.status === 'READY' || (row.status === 'ATTACHED' && row.attachedToSubmissionId === dto.submissionId));
      const refused = ids.filter((id) => !usable(byId.get(id)));
      if (refused.length) throw new ConflictException(`These files cannot be attached: ${refused.join(', ')}`);

      const readyCount = ids.filter((id) => byId.get(id)!.status === 'READY').length;
      const updated = await tx.mediaObject.updateMany({
        where: { id: { in: ids }, status: 'READY' },
        data: { status: 'ATTACHED', attachedToSubmissionId: dto.submissionId, attachedAt: new Date() },
      });
      // Defensive, not reachable under the lock above: the rows are held for
      // the whole transaction, so nothing else can move them between the
      // validation read and this write. If it ever does happen, refuse rather
      // than report success for an update that didn't fully land.
      if (updated.count !== readyCount) throw new ConflictException('These files changed while attaching; try again');

      return dto.mediaIds.map((id) => {
        const row = byId.get(id)!;
        return {
          id, kind: row.kind as MediaKind, contentHash: row.contentHash, capturedAt: row.capturedAt?.toISOString() ?? null,
          latitude: num(row.latitude), longitude: num(row.longitude), distanceFromSiteM: row.distanceFromSiteM,
        };
      });
    });
  }
}
