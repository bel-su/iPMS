import { ForbiddenException } from '@nestjs/common';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { ReportQuery } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import type { Actor } from '../common.js';
import { advanceBalance } from '../balance.js';
import { compareMoney, fromMinor, sumMoney, toMinor } from '../money.js';

export interface SpendRow {
  key: string;
  label: string;
  advancesPaid: string;
  applied: string;
  cashReturned: string;
  /** Outstanding balance today of the advances in this group: for each paid advance filed under the group (by the advance's own project, category or requester, within the project and date filters), paid minus ALL its settled settlements and ALL cash returned, whatever their dates or categories. */
  outstanding: string;
  reimbursed: string;
  settled: string;
  /** reimbursed + settled: money the project actually spent. Unsettled advance is outstanding, not expense. */
  expense: string;
}

const VIEW_ALL = 'finance_request.view_all';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The upper bound of the date filter. A date without a time (`to=2026-10-31`
 * parses to UTC midnight) means "up to the end of that day", so it becomes
 * `< next midnight`; a value with a time is an exact instant, kept as `<=`.
 */
function upTo(to: Date): { lt: Date } | { lte: Date } {
  return to.getTime() % DAY_MS === 0 ? { lt: new Date(to.getTime() + DAY_MS) } : { lte: to };
}

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
        query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? upTo(query.to) : {}) } } : {},
      ],
    };
    const [requests, returns] = await Promise.all([
      this.prisma.financeRequest.findMany({
        where: { AND: [base, { status: { in: ['PAID', 'SETTLED'] } }] },
        select: { id: true, kind: true, projectId: true, projectCode: true, projectName: true, categoryId: true, requesterId: true, approvedAmount: true, appliedAmount: true, category: { select: { name: true } } },
      }),
      this.prisma.payment.findMany({
        where: { kind: 'CASH_RETURN', request: base },
        select: { amount: true, request: { select: { projectId: true, projectCode: true, projectName: true, categoryId: true, requesterId: true, category: { select: { name: true } } } } },
      }),
    ]);

    const groups = new Map<string, { label: string; advances: string[]; outstanding: string[]; applied: string[]; returned: string[]; reimbursed: string[]; settled: string[] }>();
    const slot = (r: { projectId: string; projectCode: string; projectName: string; categoryId: string; requesterId: string; category: { name: string } }) => {
      const [key, label] = query.groupBy === 'project' ? [r.projectId, `${r.projectCode} ${r.projectName}`]
        : query.groupBy === 'category' ? [r.categoryId, r.category.name]
        : [r.requesterId, r.requesterId];
      if (!groups.has(key)) groups.set(key, { label, advances: [], outstanding: [], applied: [], returned: [], reimbursed: [], settled: [] });
      return { key, group: groups.get(key)! };
    };

    // Outstanding is a property of each paid advance, not of the period: take its balance as it stands now.
    const advanceIds = requests.filter((r) => r.kind === 'ADVANCE').map((r) => r.id);
    const [settlements, allReturns] = advanceIds.length === 0 ? [[], []] : await Promise.all([
      this.prisma.financeRequest.findMany({ where: { advanceId: { in: advanceIds }, status: 'SETTLED' }, select: { advanceId: true, appliedAmount: true } }),
      this.prisma.payment.findMany({ where: { requestId: { in: advanceIds }, kind: 'CASH_RETURN' }, select: { requestId: true, amount: true } }),
    ]);
    const appliedBy = new Map<string, string[]>(); const returnedBy = new Map<string, string[]>();
    for (const s of settlements) appliedBy.set(s.advanceId!, [...(appliedBy.get(s.advanceId!) ?? []), s.appliedAmount?.toFixed(2) ?? '0.00']);
    for (const p of allReturns) returnedBy.set(p.requestId, [...(returnedBy.get(p.requestId) ?? []), p.amount.toFixed(2)]);

    for (const r of requests) {
      const { group } = slot(r);
      if (r.kind === 'ADVANCE') {
        group.outstanding.push(advanceBalance({ paid: r.approvedAmount?.toFixed(2) ?? '0.00', applied: appliedBy.get(r.id) ?? [], cashReturned: returnedBy.get(r.id) ?? [] }).outstanding);
      }
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
        outstanding: sumMoney(g.outstanding),
        reimbursed, settled, expense: sumMoney([reimbursed, settled]),
      };
    }).sort((a, b) => compareMoney(b.expense, a.expense) || a.label.localeCompare(b.label));
  }
}
