import { ForbiddenException } from '@nestjs/common';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { ReportQuery } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import type { Actor } from '../common.js';
import { compareMoney, fromMinor, sumMoney, toMinor } from '../money.js';

export interface SpendRow {
  key: string;
  label: string;
  advancesPaid: string;
  applied: string;
  cashReturned: string;
  outstanding: string;
  reimbursed: string;
  settled: string;
  /** reimbursed + settled: money the project actually spent. Unsettled advance is outstanding, not expense. */
  expense: string;
}

const VIEW_ALL = 'finance_request.view_all';

/**
 * Spend per project, category or engineer. Only completed money counts: a paid
 * advance, a paid reimbursement, a settled settlement and cash returned.
 * Volumes are small (one row per request), so grouping is done in memory.
 */
export class ReportService {
  constructor(private readonly prisma: PrismaClient) {}

  async spend(actor: Actor, scope: AuthzScope, query: ReportQuery): Promise<SpendRow[]> {
    if (!actor.permissions.includes(VIEW_ALL)) throw new ForbiddenException(`Reports need the ${VIEW_ALL} permission`);

    const base: Prisma.FinanceRequestWhereInput = {
      AND: [
        scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput,
        query.projectId ? { projectId: query.projectId } : {},
        query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {},
      ],
    };
    const [requests, returns] = await Promise.all([
      this.prisma.financeRequest.findMany({
        where: { AND: [base, { status: { in: ['PAID', 'SETTLED'] } }] },
        select: { kind: true, projectId: true, projectCode: true, projectName: true, categoryId: true, requesterId: true, approvedAmount: true, appliedAmount: true, category: { select: { name: true } } },
      }),
      this.prisma.payment.findMany({
        where: { kind: 'CASH_RETURN', request: base },
        select: { amount: true, request: { select: { projectId: true, projectCode: true, projectName: true, categoryId: true, requesterId: true, category: { select: { name: true } } } } },
      }),
    ]);

    const groups = new Map<string, { label: string; advances: string[]; applied: string[]; returned: string[]; reimbursed: string[]; settled: string[] }>();
    const slot = (r: { projectId: string; projectCode: string; projectName: string; categoryId: string; requesterId: string; category: { name: string } }) => {
      const [key, label] = query.groupBy === 'project' ? [r.projectId, `${r.projectCode} ${r.projectName}`]
        : query.groupBy === 'category' ? [r.categoryId, r.category.name]
        : [r.requesterId, r.requesterId];
      if (!groups.has(key)) groups.set(key, { label, advances: [], applied: [], returned: [], reimbursed: [], settled: [] });
      return { key, group: groups.get(key)! };
    };

    for (const r of requests) {
      const { group } = slot(r);
      const approved = r.approvedAmount?.toFixed(2) ?? '0.00';
      if (r.kind === 'ADVANCE') group.advances.push(approved);
      else if (r.kind === 'REIMBURSEMENT') group.reimbursed.push(approved);
      else { group.settled.push(approved); group.applied.push(r.appliedAmount?.toFixed(2) ?? '0.00'); }
    }
    for (const p of returns) slot(p.request).group.returned.push(p.amount.toFixed(2));

    return [...groups.entries()].map(([key, g]) => {
      const advancesPaid = sumMoney(g.advances);
      const applied = sumMoney(g.applied);
      const cashReturned = sumMoney(g.returned);
      const reimbursed = sumMoney(g.reimbursed);
      const settled = sumMoney(g.settled);
      return {
        key, label: g.label, advancesPaid, applied, cashReturned,
        outstanding: fromMinor(toMinor(advancesPaid) - toMinor(applied) - toMinor(cashReturned)),
        reimbursed, settled, expense: sumMoney([reimbursed, settled]),
      };
    }).sort((a, b) => compareMoney(b.expense, a.expense) || a.label.localeCompare(b.label));
  }
}
