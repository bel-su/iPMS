export const GROUPINGS = ['project', 'category', 'requester'] as const;
export type Grouping = (typeof GROUPINGS)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportQuery { groupBy: Grouping; from?: string; to?: string }

/** Query params from the URL, reduced to what the service understands: an unknown grouping becomes `project`, a malformed date is dropped. */
export function resolveReportQuery(raw: { groupBy?: string | string[] | undefined; from?: string | string[] | undefined; to?: string | string[] | undefined }): ReportQuery {
  const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
  const groupBy = GROUPINGS.find((g) => g === one(raw.groupBy)) ?? 'project';
  const from = one(raw.from);
  const to = one(raw.to);
  return { groupBy, ...(from && DATE.test(from) ? { from } : {}), ...(to && DATE.test(to) ? { to } : {}) };
}

/** Whole paisa of a decimal string such as "250.75" (missing decimals are zero). */
function toPaisa(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');
  const paisa = BigInt(whole || '0') * 100n + BigInt(`${fraction}00`.slice(0, 2));
  return negative ? -paisa : paisa;
}

/** Adds amount strings in integer paisa, so two-decimal money never picks up floating-point error. */
export function sumMoney(values: readonly string[]): string {
  const total = values.reduce((sum, value) => sum + toPaisa(value), 0n);
  const abs = total < 0n ? -total : total;
  const cents = (abs % 100n).toString().padStart(2, '0');
  return `${total < 0n ? '-' : ''}${abs / 100n}.${cents}`;
}
