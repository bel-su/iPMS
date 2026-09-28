import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, NotFoundException,
  PayloadTooLargeException, UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type MediaObject, type PrismaClient } from '@prisma-clients/media';
import {
  MEDIA_LIMITS, MULTIPART_THRESHOLD_BYTES, PART_SIZE_BYTES, partCountFor,
  type CompleteUploadDto, type MediaKind, type MediaStatus, type PartUrls, type RegisterUploadDto,
  type RegisterUploadResponse, type RejectReason, type SignedPut, type UploadInstructions, type UploadStatusItem,
} from '@ipms/contracts';
import { required } from '../directory/lookup.js';
import { distanceFromSite, type ProjectClient } from '../directory/project.client.js';
import { OPEN_WORK_ORDER, type QcClient } from '../directory/qc.client.js';
import type { MediaDiscarder } from '../media/discarder.js';
import { LOCKED } from '../media/status.js';
import { captureToReceipt, uploadsCompleted, uploadsRegistered } from '../metrics.js';
import { evidenceKeys } from '../storage/keys.js';
import type { StorageClient } from '../storage/storage.client.js';

export const UPLOAD_URL_TTL_SECONDS = 3600;
export const PENDING_CAP = 500;

/**
 * The phone's side of the upload protocol. Every method is safe to repeat: a
 * phone on a failing link will call each of them more than once, and the
 * answer must be the same object in the same state, never a second copy.
 */
export class UploadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageClient,
    private readonly qc: Pick<QcClient, 'workOrder'>,
    private readonly project: Pick<ProjectClient, 'geofence'>,
    private readonly discarder: MediaDiscarder,
  ) {}

  async register(dto: RegisterUploadDto, userId: string, bearer: string): Promise<RegisterUploadResponse> {
    const limit = MEDIA_LIMITS[dto.kind];
    if (!limit.contentTypes.includes(dto.contentType)) throw new BadRequestException(`A ${dto.kind.toLowerCase()} must be ${limit.contentTypes.join(' or ')}`);
    if (dto.sizeBytes > limit.maxBytes) throw new PayloadTooLargeException(`A ${dto.kind.toLowerCase()} may be at most ${limit.maxBytes} bytes`);

    const existing = await this.prisma.mediaObject.findUnique({ where: { id: dto.id } });
    if (existing) return this.resume(existing, dto, userId);

    const pending = await this.prisma.mediaObject.count({ where: { uploadedBy: userId, status: 'PENDING' } });
    if (pending >= PENDING_CAP) throw new HttpException(`You already have ${PENDING_CAP} uploads waiting to finish`, HttpStatus.TOO_MANY_REQUESTS);

    const workOrder = required(await this.qc.workOrder(dto.workOrderId, bearer), 'Work order');
    if (!OPEN_WORK_ORDER.includes(workOrder.status)) throw new UnprocessableEntityException('This work order is closed; evidence can no longer be added');
    const site = await this.project.geofence(workOrder.siteId, bearer);

    const keys = evidenceKeys({ projectId: workOrder.projectId, siteId: workOrder.siteId, id: dto.id, kind: dto.kind });
    const multipart = dto.kind === 'VIDEO' && dto.sizeBytes > MULTIPART_THRESHOLD_BYTES;
    const uploadId = multipart ? await this.storage.createMultipart(keys.storageKey, dto.contentType) : null;

    try {
      const row = await this.prisma.mediaObject.create({
        data: {
          id: dto.id, kind: dto.kind, category: 'EVIDENCE', contentType: dto.contentType, sizeBytes: dto.sizeBytes,
          projectId: workOrder.projectId, siteId: workOrder.siteId, siteCode: workOrder.siteCode,
          workOrderId: workOrder.id, checklistItemId: dto.checklistItemId,
          storageKey: keys.storageKey, thumbnailKey: keys.thumbnailKey, multipartUploadId: uploadId,
          contentHash: dto.contentHash, capturedAt: dto.capturedAt,
          latitude: dto.latitude ?? null, longitude: dto.longitude ?? null,
          distanceFromSiteM: distanceFromSite(site, dto.latitude, dto.longitude),
          deviceId: dto.deviceId, uploadedBy: userId,
        },
      });
      uploadsRegistered.inc({ kind: dto.kind });
      return this.instructions(row);
    } catch (err) {
      // Two retries raced: the loser answers with the winner's row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        if (uploadId) await this.storage.abortMultipart(keys.storageKey, uploadId);
        return this.resume(await this.prisma.mediaObject.findUniqueOrThrow({ where: { id: dto.id } }), dto, userId);
      }
      throw err;
    }
  }

  async status(ids: string[], userId: string): Promise<UploadStatusItem[]> {
    const rows = await this.prisma.mediaObject.findMany({ where: { id: { in: ids }, uploadedBy: userId } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return Promise.all(ids.map(async (id): Promise<UploadStatusItem> => {
      const row = byId.get(id);
      if (!row) return { id, status: 'UNKNOWN' };
      const item: UploadStatusItem = { id, status: row.status as MediaStatus };
      if (row.rejectReason) item.rejectReason = row.rejectReason as RejectReason;
      if (row.status === 'PENDING' && row.multipartUploadId) {
        const parts = await this.storage.listParts(row.storageKey, row.multipartUploadId);
        item.completedParts = (parts ?? []).map((p) => p.partNumber).sort((a, b) => a - b);
      }
      return item;
    }));
  }

  async parts(id: string, partNumbers: number[], userId: string): Promise<PartUrls> {
    const row = await this.own(id, userId);
    if (row.status !== 'PENDING' || !row.multipartUploadId) throw new ConflictException('This upload is not waiting for parts');
    const uploadId = await this.liveUploadId(row);
    const count = partCountFor(row.sizeBytes);
    const bad = partNumbers.filter((n) => n > count);
    if (bad.length) throw new BadRequestException(`This upload has ${count} parts; ${bad.join(', ')} do not exist`);
    return {
      parts: await Promise.all(partNumbers.map(async (partNumber) => ({
        partNumber, signedUrl: await this.storage.presignPart(row.storageKey, uploadId, partNumber, UPLOAD_URL_TTL_SECONDS),
      }))),
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async complete(id: string, dto: CompleteUploadDto, userId: string): Promise<{ id: string; status: MediaStatus }> {
    const row = await this.own(id, userId);
    if (row.status !== 'PENDING') return { id, status: row.status as MediaStatus };

    if (row.multipartUploadId) {
      if (!dto.parts?.length) throw new BadRequestException('A multipart upload completes with its part list');
      if (dto.parts.length !== partCountFor(row.sizeBytes)) {
        throw new HttpException(`Expected ${partCountFor(row.sizeBytes)} parts, got ${dto.parts.length}`, HttpStatus.PRECONDITION_FAILED);
      }
      await this.storage.completeMultipart(row.storageKey, row.multipartUploadId, dto.parts);
    } else if (!(await this.storage.head(row.storageKey))) {
      // 412, not 409: the phone should send the bytes again, then retry.
      throw new HttpException('The file has not arrived in storage yet', HttpStatus.PRECONDITION_FAILED);
    }

    const now = new Date();
    const updated = await this.prisma.mediaObject.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'VERIFYING', multipartUploadId: null, receivedAt: now, nextAttemptAt: now },
    });
    if (updated.count === 1) {
      uploadsCompleted.inc({ kind: row.kind });
      if (row.capturedAt) captureToReceipt.observe((now.getTime() - row.capturedAt.getTime()) / 1000);
    }
    return { id, status: 'VERIFYING' };
  }

  async discard(id: string, userId: string): Promise<{ id: string; status: 'DISCARDED' }> {
    const row = await this.own(id, userId);
    if (row.status === 'DISCARDED') return { id, status: 'DISCARDED' };
    if (LOCKED.includes(row.status as MediaStatus)) throw new ConflictException('This file is part of a submission and cannot be removed');
    await this.discarder.discard(row, userId, 'media.discarded');
    return { id, status: 'DISCARDED' };
  }

  private async own(id: string, userId: string): Promise<MediaObject> {
    const row = await this.prisma.mediaObject.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Upload not found');
    if (row.uploadedBy !== userId) throw new ForbiddenException('Only the uploader can change this upload');
    return row;
  }

  private resume(row: MediaObject, dto: RegisterUploadDto, userId: string): Promise<RegisterUploadResponse> {
    if (row.uploadedBy !== userId) throw new ConflictException('This media id already belongs to another upload');
    if (row.contentHash !== dto.contentHash) throw new ConflictException('This media id was registered with different content');
    return this.instructions(row);
  }

  /** R2's lifecycle rule aborts multipart uploads left for 7 days; a returning phone gets a new one. */
  private async liveUploadId(row: MediaObject): Promise<string> {
    if (row.multipartUploadId && (await this.storage.listParts(row.storageKey, row.multipartUploadId)) !== null) return row.multipartUploadId;
    const uploadId = await this.storage.createMultipart(row.storageKey, row.contentType);
    await this.prisma.mediaObject.update({ where: { id: row.id }, data: { multipartUploadId: uploadId } });
    return uploadId;
  }

  private async instructions(row: MediaObject): Promise<RegisterUploadResponse> {
    if (row.status !== 'PENDING') return { id: row.id, status: row.status as MediaStatus, upload: null, posterUpload: null };
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();

    let upload: UploadInstructions;
    if (row.multipartUploadId) {
      const uploadId = await this.liveUploadId(row);
      const partCount = partCountFor(row.sizeBytes);
      const parts = await Promise.all(Array.from({ length: partCount }, async (_, i) => ({
        partNumber: i + 1, signedUrl: await this.storage.presignPart(row.storageKey, uploadId, i + 1, UPLOAD_URL_TTL_SECONDS),
      })));
      upload = { mode: 'multipart', uploadId, partSize: PART_SIZE_BYTES, partCount, parts, expiresAt };
    } else {
      const signed = await this.storage.presignPut(row.storageKey, { contentType: row.contentType, sizeBytes: row.sizeBytes, sha256Hex: row.contentHash }, UPLOAD_URL_TTL_SECONDS);
      upload = { mode: 'single', ...signed };
    }

    let posterUpload: SignedPut | null = null;
    if ((row.kind as MediaKind) === 'VIDEO' && row.thumbnailKey) {
      posterUpload = await this.storage.presignPut(row.thumbnailKey, { contentType: 'image/jpeg' }, UPLOAD_URL_TTL_SECONDS);
    }
    return { id: row.id, status: 'PENDING', upload, posterUpload };
  }
}
