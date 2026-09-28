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
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.mediaObject.findMany({ where: { id: { in: dto.mediaIds } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const usable = (row: MediaObject | undefined): row is MediaObject =>
        !!row && row.siteId === dto.siteId &&
        (row.status === 'READY' || (row.status === 'ATTACHED' && row.attachedToSubmissionId === dto.submissionId));
      const refused = dto.mediaIds.filter((id) => !usable(byId.get(id)));
      if (refused.length) throw new ConflictException(`These files cannot be attached: ${refused.join(', ')}`);

      await tx.mediaObject.updateMany({
        where: { id: { in: dto.mediaIds }, status: 'READY' },
        data: { status: 'ATTACHED', attachedToSubmissionId: dto.submissionId, attachedAt: new Date() },
      });
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
