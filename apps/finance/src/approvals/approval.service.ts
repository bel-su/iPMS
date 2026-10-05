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
 * Approve, return and reject. One route per outcome serves every step, so the
 * step is read from the request's status and the permission it needs is checked
 * here, together with visibility, scope, no-self-approval and segregation of
 * duties. The PM and Director approve; at the Finance step only return and
 * reject happen here (holding finance_payment.record), since paying is
 * PaymentService.
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
      if (step === null) throw new ConflictException('This request is not waiting for an approval');
      // Finance may send a request back or refuse it, but never "approve" it: paying is Finance's approval (PaymentService).
      if (step === 'FINANCE' && outcome === 'APPROVED') throw new ConflictException('This request is waiting for payment, not an approval');
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
        // Leaving the Finance step without paying drops the Director's amount: a resubmission goes back through the Director, who sets it again.
        data: { status: next, ...(approvedAmount === undefined ? {} : { approvedAmount }), ...(step === 'FINANCE' ? { approvedAmount: null } : {}) },
      });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');

      await recordAction(tx, { requestId: id, revision: row.revision, step, action: outcome, actorId: actor.id, amount: approvedAmount ?? null, comment });
      const after = await tx.financeRequest.findUniqueOrThrow({ where: { id } });
      const facts = factsOf(after, actor.id, comment);
      await emit(tx, subjectFor(outcome, step), outcome === 'APPROVED' ? facts : { ...facts, step }, actor.id);
      await recordAudit(tx, {
        actorId: actor.id, action: `finance.request.${outcome.toLowerCase()}`, objectId: id,
        previousState: { status: row.status, ...(step === 'FINANCE' ? { approvedAmount: row.approvedAmount?.toFixed(2) ?? null } : {}) },
        newState: { status: next, step, ...(approvedAmount === undefined ? {} : { approvedAmount }), ...(step === 'FINANCE' ? { approvedAmount: null } : {}) },
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
