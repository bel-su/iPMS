import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7, type CreateSubmissionDto, type CreateTemplateDto, type ReviewSubmissionDto } from '@ipms/contracts';

@Injectable()
export class QcService {
  constructor(private readonly prisma: PrismaClient) {}

  async listTemplates(projectId?: string) {
    return this.prisma.checklistTemplate.findMany({
      ...(projectId === undefined ? {} : { where: { projectId } }),
      include: { sections: { include: { items: true }, orderBy: { order: 'asc' } } },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });
  }

  async createTemplate(dto: CreateTemplateDto, actorId: string) {
    const previous = await this.prisma.checklistTemplate.findFirst({ where: { projectId: dto.projectId, code: dto.code }, orderBy: { version: 'desc' } });
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.checklistTemplate.create({ data: { id: uuidv7(), projectId: dto.projectId, code: dto.code, name: dto.name, category: dto.category, version: (previous?.version ?? 0) + 1, createdBy: actorId } });
      for (const sectionDto of dto.sections) {
        const section = await tx.checklistSection.create({ data: { id: uuidv7(), templateId: template.id, number: sectionDto.number, title: sectionDto.title, order: sectionDto.order } });
        await tx.checklistItem.createMany({ data: sectionDto.items.map((item) => ({ id: uuidv7(), sectionId: section.id, number: item.number, requirementText: item.requirementText, severity: item.severity, responseType: item.responseType, requiresPhoto: item.requiresPhoto, minPhotos: item.minPhotos, maxPhotos: item.maxPhotos, allowsNa: item.allowsNa, isRequired: item.isRequired, guidanceText: item.guidanceText ?? null, order: item.order })) });
      }
      return template;
    });
  }

  async publishTemplate(id: string) {
    const template = await this.prisma.checklistTemplate.findUnique({ where: { id }, include: { sections: { include: { items: true } } } });
    if (!template) throw new NotFoundException('Checklist template not found');
    if (template.status !== 'DRAFT') throw new ConflictException('Only draft templates can be published');
    if (!template.sections.length || template.sections.some((section) => !section.items.length)) throw new BadRequestException('A template needs at least one item in every section');
    return this.prisma.checklistTemplate.update({ where: { id }, data: { status: 'ENABLED', publishedAt: new Date() } });
  }

  async getSubmission(id: string) {
    const submission = await this.prisma.submission.findUnique({ where: { id }, include: { responses: { include: { item: true, photos: true } }, decisions: true, template: true } });
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }

  async createSubmission(dto: CreateSubmissionDto, actorId: string) {
    const duplicate = await this.prisma.submission.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (duplicate) return this.getSubmission(duplicate.id);
    const template = await this.prisma.checklistTemplate.findUnique({ where: { id: dto.templateId }, include: { sections: { include: { items: true } } } });
    if (!template || template.status !== 'ENABLED') throw new BadRequestException('An enabled checklist template is required');
    const items = template.sections.flatMap((section) => section.items);
    const responses = new Map(dto.responses.map((response) => [response.itemId, response]));
    if (responses.size !== dto.responses.length || items.some((item) => item.isRequired && !responses.has(item.id)) || [...responses.keys()].some((id) => !items.some((item) => item.id === id))) throw new BadRequestException('Responses must contain every required item from this template exactly once');
    for (const item of items) { const response = responses.get(item.id); if (!response) continue; if (response.selfCheckResult === 'NA' && !item.allowsNa) throw new BadRequestException(`Item ${item.number} does not allow N/A`); if (response.photoMediaIds.length < item.minPhotos || response.photoMediaIds.length > item.maxPhotos) throw new BadRequestException(`Item ${item.number} has an invalid photo count`); }
    const last = await this.prisma.submission.aggregate({ where: { taskId: dto.taskId }, _max: { attemptNo: true } });
    const integrityHash = createHash('sha256').update(JSON.stringify(dto.responses.map((r) => ({ itemId: r.itemId, result: r.selfCheckResult, photos: [...r.photoMediaIds].sort() })).sort((a, b) => a.itemId.localeCompare(b.itemId)))).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({ data: { id: uuidv7(), taskId: dto.taskId, siteId: dto.siteId, projectId: dto.projectId, templateId: template.id, templateVersion: template.version, attemptNo: (last._max.attemptNo ?? 0) + 1, status: 'SUBMITTED', submittedBy: actorId, submittedAt: new Date(), integrityHash, idempotencyKey: dto.idempotencyKey, deviceId: dto.deviceId ?? null } });
      for (const response of dto.responses) { const itemResponse = await tx.itemResponse.create({ data: { id: uuidv7(), submissionId: submission.id, itemId: response.itemId, selfCheckResult: response.selfCheckResult, selfCheckDescription: response.selfCheckDescription ?? null, textValue: response.textValue ?? null, numberValue: response.numberValue ?? null, booleanValue: response.booleanValue ?? null, selectValue: response.selectValue ?? null } }); if (response.photoMediaIds.length) await tx.itemPhoto.createMany({ data: response.photoMediaIds.map((mediaId, sequence) => ({ id: uuidv7(), itemResponseId: itemResponse.id, mediaId, sequence })) }); }
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
