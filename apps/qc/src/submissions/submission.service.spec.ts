import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SubmissionService } from './submission.service.js';

describe('SubmissionService', () => {
  let service: SubmissionService;
  let prisma: any;
  let geofenceClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    prisma = {
      submission: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _max: { attemptNo: 1 } }),
        create: vi.fn(),
        update: vi.fn(),
      },
      workOrder: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      templateVersion: {
        findUnique: vi.fn(),
      },
      itemResponse: {
        create: vi.fn(),
        update: vi.fn(),
      },
      itemPhoto: {
        createMany: vi.fn(),
      },
      outboxEvent: {
        create: vi.fn(),
      },
      auditEvent: {
        create: vi.fn(),
      },
      workOrderEvent: {
        create: vi.fn(),
      },
      reviewDecision: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(prisma)),
    };

    geofenceClient = {
      fetch: vi.fn().mockResolvedValue(null),
    };

    service = new SubmissionService(prisma, geofenceClient, 7);
  });

  describe('createSubmission validation', () => {
    const actorId = '0192f7a0-0000-7000-8000-000000000001';
    const taskId = '0192f7a0-0000-7000-8000-000000000002';
    const projectId = '0192f7a0-0000-7000-8000-000000000003';
    const siteId = '0192f7a0-0000-7000-8000-000000000004';
    const templateId = '0192f7a0-0000-7000-8000-000000000005';
    const templateVersionId = '0192f7a0-0000-7000-8000-000000000006';
    const itemId = '0192f7a0-0000-7000-8000-000000000007';

    beforeEach(() => {
      prisma.submission.findUnique.mockResolvedValue(null); // not duplicate
      prisma.submission.findFirst.mockResolvedValue(null); // no pending

      prisma.workOrder.findUnique.mockResolvedValue({
        id: taskId,
        assigneeId: actorId,
        status: 'ONGOING',
        projectId,
        siteId,
        templateId,
      });

      prisma.templateVersion.findUnique.mockResolvedValue({
        id: templateVersionId,
        templateId,
        version: 1,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        template: { status: 'ACTIVE' },
        sections: [
          {
            id: 'sec-1',
            items: [
              {
                id: itemId,
                number: '1.1',
                isRequired: true,
                allowsNa: false,
                minPhotos: 1,
                maxPhotos: 5,
              },
            ],
          },
        ],
      });
    });

    it('rejects when required photos are missing (photoMediaIds.length < minPhotos)', async () => {
      const dto = {
        taskId,
        siteId,
        projectId,
        templateVersionId,
        idempotencyKey: 'idem-1',
        responses: [
          {
            itemId,
            selfCheckResult: 'PASS' as const,
            photoMediaIds: [], // 0 photos, but minPhotos = 1
          },
        ],
      };

      await expect(service.createSubmission(dto as any, actorId, 'bearer')).rejects.toThrow(BadRequestException);
      await expect(service.createSubmission(dto as any, actorId, 'bearer')).rejects.toThrow('Item 1.1 has an invalid photo count');
    });

    it('rejects when photoMediaIds exceed maxPhotos', async () => {
      const dto = {
        taskId,
        siteId,
        projectId,
        templateVersionId,
        idempotencyKey: 'idem-2',
        responses: [
          {
            itemId,
            selfCheckResult: 'PASS' as const,
            photoMediaIds: [
              '0192f7a0-0000-7000-8000-000000000010',
              '0192f7a0-0000-7000-8000-000000000011',
              '0192f7a0-0000-7000-8000-000000000012',
              '0192f7a0-0000-7000-8000-000000000013',
              '0192f7a0-0000-7000-8000-000000000014',
              '0192f7a0-0000-7000-8000-000000000015', // 6 photos, max is 5
            ],
          },
        ],
      };

      await expect(service.createSubmission(dto as any, actorId, 'bearer')).rejects.toThrow('Item 1.1 has an invalid photo count');
    });

    it('rejects when selfCheckResult is NA but allowsNa is false', async () => {
      const dto = {
        taskId,
        siteId,
        projectId,
        templateVersionId,
        idempotencyKey: 'idem-3',
        responses: [
          {
            itemId,
            selfCheckResult: 'NA' as const,
            photoMediaIds: ['0192f7a0-0000-7000-8000-000000000010'],
          },
        ],
      };

      await expect(service.createSubmission(dto as any, actorId, 'bearer')).rejects.toThrow('Item 1.1 does not allow N/A');
    });

    it('successfully creates submission and records photos when evidence requirements are met', async () => {
      const photoId = '0192f7a0-0000-7000-8000-000000000010';
      const dto = {
        taskId,
        siteId,
        projectId,
        templateVersionId,
        idempotencyKey: 'idem-4',
        responses: [
          {
            itemId,
            selfCheckResult: 'PASS' as const,
            photoMediaIds: [photoId],
          },
        ],
      };

      prisma.submission.create.mockResolvedValue({ id: 'sub-created-1', attemptNo: 2, submittedAt: new Date() });
      prisma.itemResponse.create.mockResolvedValue({ id: 'resp-1' });

      const result = await service.createSubmission(dto as any, actorId, 'bearer');
      expect(result).toBeDefined();
      expect(prisma.submission.create).toHaveBeenCalled();
      expect(prisma.itemPhoto.createMany).toHaveBeenCalledWith({
        data: [{ id: expect.any(String), itemResponseId: 'resp-1', mediaId: photoId, sequence: 0 }],
      });
      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REVIEWING' }),
        }),
      );
    });
  });

  describe('reviewSubmission', () => {
    const actorId = '0192f7a0-0000-7000-8000-000000000001';
    const submissionId = '0192f7a0-0000-7000-8000-000000000002';
    const itemId = '0192f7a0-0000-7000-8000-000000000003';
    const taskId = '0192f7a0-0000-7000-8000-000000000004';
    const projectId = '0192f7a0-0000-7000-8000-000000000005';

    beforeEach(() => {
      prisma.submission.findUnique.mockResolvedValue({
        id: submissionId,
        status: 'SUBMITTED',
        taskId,
        projectId,
        attemptNo: 1,
        responses: [
          {
            id: 'resp-1',
            itemId,
            item: { id: itemId, number: '1.1' },
          },
        ],
      });
      prisma.submission.update.mockResolvedValue({
        id: submissionId,
        status: 'APPROVED',
        taskId,
        projectId,
        attemptNo: 1,
        reviewedAt: new Date(),
      });
      prisma.workOrder.findUnique.mockResolvedValue({ id: taskId });
    });

    it('rejects approval when an item review is REJECTED', async () => {
      const dto = {
        decision: 'APPROVE' as const,
        itemReviews: [
          {
            itemId,
            result: 'REJECTED' as const,
            description: 'Photo blur',
          },
        ],
      };

      await expect(service.reviewSubmission(submissionId, dto as any, actorId)).rejects.toThrow(
        'A submission with rejected items cannot be approved',
      );
    });

    it('successfully approves submission and completes work order when all items pass', async () => {
      const dto = {
        decision: 'APPROVE' as const,
        comment: 'All tests verified',
        itemReviews: [
          {
            itemId,
            result: 'APPROVED' as const,
          },
        ],
      };

      await service.reviewSubmission(submissionId, dto as any, actorId);
      expect(prisma.reviewDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ decision: 'APPROVE' }),
        }),
      );
      expect(prisma.workOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('successfully rejects submission and sets work order to RECTIFYING when decision is REJECT', async () => {
      const dto = {
        decision: 'REJECT' as const,
        comment: 'Rework needed',
        itemReviews: [
          {
            itemId,
            result: 'REJECTED' as const,
            description: 'Insufficient photo evidence',
          },
        ],
      };

      prisma.submission.update.mockResolvedValue({
        id: submissionId,
        status: 'REJECTED_REWORK',
        taskId,
        projectId,
        attemptNo: 1,
        reviewedAt: new Date(),
      });

      await service.reviewSubmission(submissionId, dto as any, actorId);
      expect(prisma.workOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RECTIFYING' }),
        }),
      );
    });
  });
});
