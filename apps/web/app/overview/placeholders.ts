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

/** Cash advance requests waiting on the project manager — sample until Finance exists. */
export interface SampleAdvanceRequest {
  ref: string;
  title: string;
  who: string;
  where: string;
  context: string;
  amount: number;
  requested: string;
}

export const ADVANCE_REQUESTS: readonly SampleAdvanceRequest[] = [
  { ref: 'ADV-207', title: 'Cash advance · Crane hire', who: 'Ramesh Thapa', where: 'KOS001 · Ncell Phase 13', context: 'Linked to WO-1042 · 2 previous advances settled', amount: 85_000, requested: 'Requested 3h ago' },
  { ref: 'ADV-208', title: 'Cash advance · Generator fuel', who: 'Sita Gurung', where: 'BRT014 · Ncell Phase 13', context: 'NPR 12,000 from ADV-191 not yet settled', amount: 48_000, requested: 'Requested 6h ago' },
  { ref: 'ADV-205', title: 'Cash advance · Rigger labour, 3 × 5 days', who: 'Bikash Rai', where: 'ITH007 · NTC 4G Expansion', context: 'Linked to WO-1036 · no open advances', amount: 32_500, requested: 'Requested yesterday' },
  { ref: 'ADV-203', title: 'Cash advance · Lodging', who: 'Prakash Magar', where: 'DHN003 · NTC 4G Expansion', context: 'No open advances', amount: 21_000, requested: 'Requested 2 days ago' },
];

export const ADVANCE_PIPELINE = [
  { stage: 'Awaiting your approval', owner: 'Project manager', amount: 186_500, count: 4, tone: 'purple' },
  { stage: 'Approved, with Finance', owner: 'Finance team', amount: 72_000, count: 2, tone: 'blue' },
  { stage: 'Paid out', owner: 'Disbursed to engineer', amount: 214_000, count: 9, tone: 'green' },
  { stage: 'Settled with receipts', owner: 'Closed', amount: 158_000, count: 6, tone: 'slate' },
] as const;
