import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7, type CreateSubmissionDto, type ReviewSubmissionDto } from '@ipms/contracts';
import { resolveGeofence, type SiteGeofenceClient } from './site-geofence.client.js';
import { acceptVersion } from './version-acceptance.js';

const REFUSAL = {
  DISABLED: () => new ConflictException('This checklist has been disabled'),
  NOT_PUBLISHED: () => new BadRequestException('This checklist version has not been published'),
  SUPERSEDED: () => new ConflictException('This checklist has been updated. Refresh to get the latest version.'),
} as const;

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly geofence: SiteGeofenceClient,
    private readonly graceDays: number,
  ) {}

  async getSubmission(id: string) {
    const submission = await this.prisma.submission.findUnique({ where: { id }, include: { responses: { include: { item: true, photos: true } }, decisions: true, template: true } });
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }

  /**
   * `bearer` is the submitting user's own Authorization header, forwarded to
   * the project service so the geofence lookup stays permission-checked.
   */
  async createSubmission(dto: CreateSubmissionDto, actorId: string, bearer: string) {
    const duplicate = await this.prisma.submission.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (duplicate) return this.getSubmission(duplicate.id);
    const version = await this.prisma.templateVersion.findUnique({
      where: { id: dto.templateVersionId },
      include: { template: true, sections: { include: { items: true } } },
    });
    if (!version) throw new BadRequestException('Unknown checklist version');
    const acceptance = acceptVersion(version, version.template, new Date(), this.graceDays);
    if (!acceptance.ok) throw REFUSAL[acceptance.reason]();

    const items = version.sections.flatMap((section) => section.items);
    const responses = new Map(dto.responses.map((response) => [response.itemId, response]));
    if (responses.size !== dto.responses.length || items.some((item) => item.isRequired && !responses.has(item.id)) || [...responses.keys()].some((id) => !items.some((item) => item.id === id))) throw new BadRequestException('Responses must contain every required item from this template exactly once');
    for (const item of items) {
      const response = responses.get(item.id);
      if (!response) continue;
      if (response.selfCheckResult === 'NA' && !item.allowsNa) throw new BadRequestException(`Item ${item.number} does not allow N/A`);
      if (response.photoMediaIds.length < item.minPhotos || response.photoMediaIds.length > item.maxPhotos) throw new BadRequestException(`Item ${item.number} has an invalid photo count`);
    }
    const last = await this.prisma.submission.aggregate({ where: { taskId: dto.taskId }, _max: { attemptNo: true } });
    const integrityHash = createHash('sha256').update(JSON.stringify(dto.responses.map((r) => ({ itemId: r.itemId, result: r.selfCheckResult, photos: [...r.photoMediaIds].sort() })).sort((a, b) => a.itemId.localeCompare(b.itemId)))).digest('hex');
    // Never throws: an unreachable project service records UNVERIFIED rather
    // than failing a submission that represents work already done in the field.
    const outcome = resolveGeofence(await this.geofence.fetch(dto.siteId, bearer), dto);
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({ data: { id: uuidv7(), taskId: dto.taskId, siteId: dto.siteId, projectId: dto.projectId, templateId: version.templateId, templateVersionId: version.id, templateVersion: version.version, attemptNo: (last._max.attemptNo ?? 0) + 1, status: 'SUBMITTED', submittedBy: actorId, submittedAt: new Date(), integrityHash, idempotencyKey: dto.idempotencyKey, deviceId: dto.deviceId ?? null, latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, distanceFromSiteM: outcome.distanceFromSiteM, geofenceStatus: outcome.geofenceStatus } });
      for (const response of dto.responses) {
        const itemResponse = await tx.itemResponse.create({ data: { id: uuidv7(), submissionId: submission.id, itemId: response.itemId, selfCheckResult: response.selfCheckResult, selfCheckDescription: response.selfCheckDescription ?? null, textValue: response.textValue ?? null, numberValue: response.numberValue ?? null, booleanValue: response.booleanValue ?? null, selectValue: response.selectValue ?? null } });
        if (response.photoMediaIds.length) await tx.itemPhoto.createMany({ data: response.photoMediaIds.map((mediaId, sequence) => ({ id: uuidv7(), itemResponseId: itemResponse.id, mediaId, sequence })) });
      }
      return submission;
    });
  }

  async reviewSubmission(id: string, dto: ReviewSubmissionDto, actorId: string) {
    const submission = await this.prisma.submission.findUnique({ where: { id }, include: { responses: { include: { item: true } } } });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== 'SUBMITTED' && submission.status !== 'UNDER_REVIEW') throw new ConflictException('Only submitted work can be reviewed');
    const reviews = new Map(dto.itemReviews.map((review) => [review.itemId, review]));
    if (reviews.size !== submission.responses.length || submission.responses.some((response) => !reviews.has(response.itemId))) throw new BadRequestException('Every submitted item needs a review result');
    const rejected = [...reviews.values()].some((review) => review.result === 'REJECTED');
    if (dto.decision === 'APPROVE' && rejected) throw new BadRequestException('A submission with rejected items cannot be approved');
    return this.prisma.$transaction(async (tx) => {
      for (const response of submission.responses) { const review = reviews.get(response.itemId)!; await tx.itemResponse.update({ where: { id: response.id }, data: { reviewResult: review.result, reviewDescription: review.description ?? null, reviewedBy: actorId, reviewedAt: new Date() } }); }
      const approved = dto.decision === 'APPROVE';
      await tx.reviewDecision.create({ data: { id: uuidv7(), submissionId: id, reviewerId: actorId, decision: dto.decision, comment: dto.comment ?? null } });
      return tx.submission.update({ where: { id }, data: { status: approved ? 'APPROVED' : 'REJECTED_REWORK', overallVerdict: approved ? 'PASS' : 'FAIL', reviewedBy: actorId, reviewedAt: new Date(), reviewComment: dto.comment ?? null } });
    });
  }
}
