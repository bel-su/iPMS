import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import type { ApproveDto } from '@ipms/contracts';
import { SUBJECTS } from '@ipms/events';
import type { PrismaClient } from '@prisma-clients/finance';
import { recordAudit } from '../audit.js';
import { inScope, notFound, requireNoEarlierApproval, type Actor } from '../common.js';
import { emit, factsOf, recordAction } from '../events.js';
import { compareMoney } from '../money.js';
import { serializeDetail } from '../serialize.js';
import { STEP_PERMISSION, statusAfterApproval, stepOf, type Step } from '../workflow.js';

type Outcome = 'APPROVED' | 'RETURNED' | 'REJECTED';

const VIEW_ALL = 'finance_request.view_all';

/**
 * The PM and Director steps. One route serves both, so the step is read from
 * the request's status and the permission it needs is checked here, together
 * with scope and the no-self-approval rule. Finance's step is PaymentService.
 */
export class ApprovalService {
  constructor(private readonly prisma: PrismaClient) {}

  approve(id: string, dto: ApproveDto, actor: Actor, scope: AuthzScope) {
    return this.act(id, 'APPROVED', dto.comment ?? null, dto.amount, actor, scope);
  }

  returnToRequester(id: string, comment: string, actor: Actor, scope: AuthzScope) {
    return this.act(id, 'RETURNED', comment, undefined, actor, scope);
  }

  reject(id: string, comment: string, actor: Actor, scope: AuthzScope) {
    return this.act(id, 'REJECTED', comment, undefined, actor, scope);
  }

  private async act(id: string, outcome: Outcome, comment: string | null, amount: string | undefined, actor: Actor, scope: AuthzScope) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRequest.findUnique({ where: { id } });
      // Out of scope looks like missing, so a request's existence is not disclosed across projects.
      if (!row || !inScope(scope, row.projectId)) throw notFound('Request');
      // So does a request the caller could not open: only its requester and view_all holders learn it exists or where it stands.
      if (row.requesterId !== actor.id && !actor.permissions.includes(VIEW_ALL)) throw notFound('Request');

      const step = stepOf(row.status);
      if (step === null || step === 'FINANCE') throw new ConflictException('This request is not waiting for an approval');
      if (!actor.permissions.includes(STEP_PERMISSION[step])) throw new ForbiddenException(`This step needs the ${STEP_PERMISSION[step]} permission`);
      if (row.requesterId === actor.id) throw new ForbiddenException('You cannot act on your own request');
      await requireNoEarlierApproval(tx, row, actor);

      let approvedAmount: string | undefined;
      if (outcome === 'APPROVED') {
        if (step === 'PM') {
          if (amount !== undefined) throw new UnprocessableEntityException('Only the project director can change the amount');
        } else {
          approvedAmount = amount ?? row.requestedAmount.toFixed(2);
          if (compareMoney(approvedAmount, '0') <= 0) {
            throw new UnprocessableEntityException('The approved amount must be greater than zero');
          }
          if (compareMoney(approvedAmount, row.requestedAmount.toFixed(2)) > 0) {
            throw new UnprocessableEntityException('The approved amount cannot be more than was requested');
          }
        }
      }

      const next = outcome === 'APPROVED' ? statusAfterApproval(row.status as 'PENDING_PM' | 'PENDING_DIRECTOR') : outcome;
      const moved = await tx.financeRequest.updateMany({
        where: { id, status: row.status, revision: row.revision },
        data: { status: next, ...(approvedAmount === undefined ? {} : { approvedAmount }) },
      });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');

      await recordAction(tx, { requestId: id, revision: row.revision, step, action: outcome, actorId: actor.id, amount: approvedAmount ?? null, comment });
      const after = await tx.financeRequest.findUniqueOrThrow({ where: { id } });
      await emit(tx, subjectFor(outcome, step), factsOf(after, actor.id, comment), actor.id);
      await recordAudit(tx, {
        actorId: actor.id, action: `finance.request.${outcome.toLowerCase()}`, objectId: id,
        previousState: { status: row.status }, newState: { status: next, step, ...(approvedAmount === undefined ? {} : { approvedAmount }) },
      });
    });
    return serializeDetail(await this.prisma.financeRequest.findUniqueOrThrow({
      where: { id }, include: { invoices: true, actions: { orderBy: { at: 'asc' } }, payments: true },
    }));
  }
}

function subjectFor(outcome: Outcome, step: Step): string {
  if (outcome === 'RETURNED') return SUBJECTS.FINANCE_REQUEST_RETURNED;
  if (outcome === 'REJECTED') return SUBJECTS.FINANCE_REQUEST_REJECTED;
  return step === 'PM' ? SUBJECTS.FINANCE_REQUEST_APPROVED_BY_PM : SUBJECTS.FINANCE_REQUEST_APPROVED;
}
