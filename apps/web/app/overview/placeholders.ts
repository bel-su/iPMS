/**
 * SAMPLE DATA — the Finance service does not exist yet.
 *
 * Everything the overview shows about cash advances comes from this file, and
 * every panel that uses it is labelled "Sample data" on screen. When Finance
 * ships, replace these exports with a `finance-api.ts` client and delete the
 * file; nothing else in the overview invents numbers.
 */

export const ADVANCES_PAID_OUT = 1_286_000;
export const ADVANCES_UNSETTLED = 214_000;

/** Paid out, receipts not yet submitted, by how long ago it was paid. */
export const UNSETTLED_AGEING = [
  { label: '0–7 days', amount: 96_000, count: 5, tone: 'sky' },
  { label: '8–15 days', amount: 62_000, count: 3, tone: 'blue' },
  { label: '16–30 days', amount: 34_000, count: 2, tone: 'amber' },
  { label: 'Over 30 days', amount: 22_000, count: 1, tone: 'red' },
] as const;

export const OVERDUE_ADVANCE_NOTE = '1 advance over 30 days: Kiran Adhikari team, FB004';

/** Advances out per project, handed to the live project rows in order. */
export const ADVANCES_OUT_BY_ROW = [118_400, 53_000, 142_000, 96_500, 71_200] as const;

export interface SampleFinanceEntry {
  /** Minutes before "now", so the sample rows always read as recent. */
  minutesAgo: number;
  tag: string;
  tone: 'blue' | 'purple' | 'red';
  text: string;
  actor: string;
  actorRole: string;
  ref: string;
}

export const FINANCE_AUDIT_SAMPLES: readonly SampleFinanceEntry[] = [
  { minutesAgo: 95, tag: 'Paid out', tone: 'blue', text: 'NPR 40,000 disbursed to Sita Gurung for generator fuel, BRT014', actor: 'Finance service', actorRole: 'Finance', ref: 'ADV-198' },
  { minutesAgo: 1_700, tag: 'Advance approved', tone: 'purple', text: 'NPR 26,000 approved for Prakash Magar', actor: 'Anil Shrestha', actorRole: 'Project manager', ref: 'ADV-201' },
  { minutesAgo: 2_300, tag: 'Rejected', tone: 'red', text: 'Lodging advance rejected: previous advance unsettled', actor: 'Kiran Adhikari', actorRole: 'Project manager', ref: 'ADV-196' },
];
