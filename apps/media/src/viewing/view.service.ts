import { ConflictException, NotFoundException } from '@nestjs/common';
import type { MediaObject, PrismaClient } from '@prisma-clients/media';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { MediaKind, MediaStatus, MediaView, SignedGet } from '@ipms/contracts';
import { readableName } from '../media/filename.js';
import { VIEWABLE } from '../media/status.js';
import type { StorageClient } from '../storage/storage.client.js';

export const VIEW_URL_TTL_SECONDS = 300;

const inScope = (scope: AuthzScope, row: MediaObject): boolean =>
  scope.global || (row.projectId !== null && scope.projectIds.includes(row.projectId)) || (row.siteId !== null && scope.siteIds.includes(row.siteId));

const num = (value: { toString(): string } | null): number | null => (value === null ? null : Number(value.toString()));

/**
 * Anyone whose scope reaches a site sees all of its media (spec M12). Scope is
 * evaluated on every call, so a revoked user's last link dies within 5 minutes.
 */
export class ViewService {
  constructor(private readonly prisma: PrismaClient, private readonly storage: StorageClient) {}

  async url(id: string, variant: 'original' | 'thumbnail', scope: AuthzScope): Promise<SignedGet> {
    const row = await this.prisma.mediaObject.findUnique({ where: { id } });
    // Out of scope reads as absent: a 403 would confirm the id exists.
    if (!row || !inScope(scope, row)) throw new NotFoundException('Media not found');
    if (!VIEWABLE.includes(row.status as MediaStatus)) throw new ConflictException(`This file is ${row.status.toLowerCase()} and cannot be viewed`);
    const key = variant === 'thumbnail' ? row.thumbnailKey : row.storageKey;
    if (!key) throw new NotFoundException('This file has no thumbnail');
    return this.storage.presignGet(key, VIEW_URL_TTL_SECONDS, readableName({ siteCode: row.siteCode, capturedAt: row.capturedAt, id: row.id, variant, kind: row.kind as MediaKind }));
  }

  async listForWorkOrder(workOrderId: string, scope: AuthzScope): Promise<MediaView[]> {
    const rows = await this.prisma.mediaObject.findMany({
      where: { AND: [scopeWhere(scope), { workOrderId, status: { notIn: ['DISCARDED', 'PURGED'] } }] },
      orderBy: { capturedAt: 'asc' },
    });
    return Promise.all(rows.map(async (row): Promise<MediaView> => ({
      id: row.id, kind: row.kind as MediaKind, status: row.status as MediaStatus,
      workOrderId: row.workOrderId, checklistItemId: row.checklistItemId, contentHash: row.contentHash, sizeBytes: row.sizeBytes,
      capturedAt: row.capturedAt?.toISOString() ?? null, receivedAt: row.receivedAt?.toISOString() ?? null,
      latitude: num(row.latitude), longitude: num(row.longitude), distanceFromSiteM: row.distanceFromSiteM, uploadedBy: row.uploadedBy,
      thumbnail: VIEWABLE.includes(row.status as MediaStatus) && row.thumbnailKey
        ? { signedUrl: (await this.storage.presignGet(row.thumbnailKey, VIEW_URL_TTL_SECONDS, readableName({ siteCode: row.siteCode, capturedAt: row.capturedAt, id: row.id, variant: 'thumbnail', kind: row.kind as MediaKind }))).signedUrl }
        : null,
    })));
  }
}
