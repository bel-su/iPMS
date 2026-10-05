import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import { PaymentDetailsSchema, uuidv7, type CashReturnDto, type PaymentDetailsDto } from '@ipms/contracts';
import { SUBJECTS, type FinanceApprovers } from '@ipms/events';
import type { PrismaClient } from '@prisma-clients/finance';
import { planSettlement } from '../balance.js';
import { recordAudit } from '../audit.js';
import { inScope, notFound, requirePermission, type Actor, type Tx } from '../common.js';
import { emit, factsOf, recordAction } from '../events.js';
import { loadBalance, lockAdvance } from '../ledger.js';
import { compareMoney } from '../money.js';
import { serializeDetail } from '../serialize.js';
import { finalStatus } from '../workflow.js';

const FINANCE = 'finance_payment.record';

/**
 * Finance's step: pay an approved advance or reimbursement, settle a
 * settlement against its advance, and record cash an engineer hands back.
 * One payment per request, for exactly the approved amount.
 */
export class PaymentService {
  constructor(private readonly prisma: PrismaClient) {}

  async pay(id: string, body: Partial<PaymentDetailsDto>, actor: Actor, scope: AuthzScope) {
    requirePermission(actor, FINANCE);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRequest.findUnique({ where: { id } });
      if (!row || !inScope(scope, row.projectId)) throw notFound('Request');
      if (row.status !== 'PENDING_FINANCE') throw new ConflictException('This request is not waiting for payment');
      if (row.requesterId === actor.id) throw new ConflictException('You cannot act on your own request');

      const approved = row.approvedAmount!.toFixed(2);
      let applied: string | null = null;
      let payout = approved;

      if (row.kind === 'SETTLEMENT') {
        // The balance is read and then written against: lock the advance so two settlements cannot both see the same room.
        await lockAdvance(tx, row.advanceId!);
        const balance = await loadBalance(tx, row.advanceId!);
        ({ applied, payout } = planSettlement(approved, balance.outstanding));
      }

      if (compareMoney(payout, '0') > 0) {
        const details = PaymentDetailsSchema.safeParse(body);
        if (!details.success) throw new UnprocessableEntityException('Payment details are required: mode, reference and date');
        await this.writePayment(tx, id, 'PAYOUT', payout, details.data, actor);
      }

      const status = finalStatus(row.kind as 'ADVANCE' | 'SETTLEMENT' | 'REIMBURSEMENT');
      const moved = await tx.financeRequest.updateMany({
        where: { id, status: 'PENDING_FINANCE', revision: row.revision },
        data: { status, ...(applied === null ? {} : { appliedAmount: applied }) },
      });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');

      await recordAction(tx, { requestId: id, revision: row.revision, step: 'FINANCE', action: 'PAID', actorId: actor.id, amount: payout });
      const after = await tx.financeRequest.findUniqueOrThrow({ where: { id } });
      const approvers = await this.approversOf(tx, id);
      const facts = factsOf(after, actor.id, null);
      if (row.kind === 'SETTLEMENT') {
        await emit(tx, SUBJECTS.FINANCE_SETTLEMENT_SETTLED, { ...facts, approvers, advanceId: row.advanceId, appliedAmount: applied, payoutAmount: payout }, actor.id);
      } else {
        await emit(tx, SUBJECTS.FINANCE_REQUEST_PAID, { ...facts, approvers, paidAmount: approved }, actor.id);
      }
      await recordAudit(tx, { actorId: actor.id, action: row.kind === 'SETTLEMENT' ? 'finance.settlement.settled' : 'finance.request.paid', objectId: id, previousState: { status: 'PENDING_FINANCE' }, newState: { status, ...(applied === null ? {} : { applied }), payout } });
    });
    return this.detail(id);
  }

  /** Cash an engineer hands back out of an advance. Lowers the balance; never more than is outstanding. */
  async returnCash(advanceId: string, dto: CashReturnDto, actor: Actor, scope: AuthzScope) {
    requirePermission(actor, FINANCE);
    await this.prisma.$transaction(async (tx) => {
      const advance = await tx.financeRequest.findUnique({ where: { id: advanceId } });
      if (!advance || advance.kind !== 'ADVANCE' || !inScope(scope, advance.projectId)) throw notFound('Advance');
      if (advance.status !== 'PAID') throw new UnprocessableEntityException('Cash can only be returned against a paid advance');

      await lockAdvance(tx, advanceId);
      const balance = await loadBalance(tx, advanceId);
      if (compareMoney(dto.amount, balance.outstanding) > 0) throw new UnprocessableEntityException('That is more than is outstanding on this advance');

      await this.writePayment(tx, advanceId, 'CASH_RETURN', dto.amount, dto, actor);
      await recordAudit(tx, { actorId: actor.id, action: 'finance.advance.cash_returned', objectId: advanceId, previousState: { outstanding: balance.outstanding }, newState: { returned: dto.amount } });
    });
    return this.detail(advanceId);
  }

  private async writePayment(tx: Tx, requestId: string, kind: 'PAYOUT' | 'CASH_RETURN', amount: string, d: PaymentDetailsDto, actor: Actor): Promise<void> {
    await tx.payment.create({
      data: {
        id: uuidv7(), requestId, kind, mode: d.mode, reference: d.reference, paidOn: d.paidOn, amount,
        note: d.note ?? null, proofMediaId: d.proofMediaId ?? null, recordedBy: actor.id,
      },
    });
  }

  /** Who approved at each step, read from the request's own history. */
  private async approversOf(tx: Tx, requestId: string): Promise<FinanceApprovers> {
    const approvals = await tx.approvalAction.findMany({ where: { requestId, action: 'APPROVED' }, orderBy: { at: 'desc' } });
    return {
      pmId: approvals.find((a) => a.step === 'PM')?.actorId ?? null,
      directorId: approvals.find((a) => a.step === 'DIRECTOR')!.actorId,
    };
  }

  private async detail(id: string) {
    return serializeDetail(await this.prisma.financeRequest.findUniqueOrThrow({
      where: { id }, include: { invoices: true, actions: { orderBy: { at: 'asc' } }, payments: true },
    }));
  }
}
