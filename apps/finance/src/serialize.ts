import type { ApprovalAction, FinanceRequest, Payment, RequestInvoice } from '@prisma-clients/finance';

const money = (value: { toFixed(digits: number): string } | null): string | null => value?.toFixed(2) ?? null;

/** A request as JSON: amounts are two-decimal strings, never Decimal objects. */
export function serializeRequest(row: FinanceRequest) {
  return {
    ...row,
    requestedAmount: row.requestedAmount.toFixed(2),
    approvedAmount: money(row.approvedAmount),
    appliedAmount: money(row.appliedAmount),
  };
}

type Detail = FinanceRequest & { invoices?: RequestInvoice[]; actions?: ApprovalAction[]; payments?: Payment[] };

/** A request with whichever of its invoices, history and payments were loaded. */
export function serializeDetail(row: Detail) {
  const { invoices, actions, payments, ...rest } = row;
  return {
    ...serializeRequest(rest),
    ...(invoices ? { invoices: invoices.map((i) => ({ ...i, amount: i.amount.toFixed(2) })) } : {}),
    ...(actions ? { actions: actions.map((a) => ({ ...a, amount: money(a.amount) })) } : {}),
    ...(payments ? { payments: payments.map((p) => ({ ...p, amount: p.amount.toFixed(2) })) } : {}),
  };
}
