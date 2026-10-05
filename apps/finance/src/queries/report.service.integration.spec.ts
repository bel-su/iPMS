import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, OTHER_PROJECT, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RequestService } from '../requests/request.service.js';
import { ReportService } from './report.service.js';
import { buildSpendWorkbook } from './report.xlsx.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService; let approvals: ApprovalService; let payments: PaymentService; let reports: ReportService;
let categoryId: string;

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma); reports = new ReportService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const bank = { mode: 'BANK_TRANSFER' as const, reference: 'T', paidOn: new Date('2026-10-05') };
const inv = (amount: string) => ({ vendor: 'V', invoiceNumber: `I${amount}`, invoiceDate: new Date('2026-10-01'), amount, mediaId: ACTORS.engineer.id });
const through = async (id: string) => {
  await approvals.approve(id, {}, ACTORS.pm, scopes.project);
  await approvals.approve(id, {}, ACTORS.director, scopes.project);
};

async function scenario() {
  // KOS: advance 50,000 paid; settlement 12,000 settled; 3,000 returned; reimbursement 800 paid.
  const adv = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount: '50000' }, ACTORS.engineer, scopes.project, PROJECT);
  await requests.submit(adv.id, ACTORS.engineer); await through(adv.id); await payments.pay(adv.id, bank, ACTORS.finance, scopes.global);
  const set = await requests.create({ kind: 'SETTLEMENT', advanceId: adv.id, categoryId, purpose: 'Bills', invoices: [inv('12000')] }, ACTORS.engineer, scopes.project);
  await requests.submit(set.id, ACTORS.engineer); await through(set.id); await payments.pay(set.id, {}, ACTORS.finance, scopes.global);
  await payments.returnCash(adv.id, { ...bank, amount: '3000' }, ACTORS.finance, scopes.global);
  const rei = await requests.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [inv('800')] }, ACTORS.engineer, scopes.project, PROJECT);
  await requests.submit(rei.id, ACTORS.engineer); await through(rei.id); await payments.pay(rei.id, bank, ACTORS.finance, scopes.global);
  // An unpaid request on another project must not count.
  const other = await requests.create({ kind: 'ADVANCE', projectId: OTHER_PROJECT.id, categoryId, purpose: 'x', amount: '999' }, ACTORS.otherEngineer, scopes.otherProject, OTHER_PROJECT);
  await requests.submit(other.id, ACTORS.otherEngineer);
}

describe('spend report', () => {
  it('totals advances, settlements, returns and outstanding per project', async () => {
    await scenario();
    const rows = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'project', format: 'json' });
    expect(rows).toEqual([{
      key: PROJECT.id, label: 'KOS Koshi Rollout',
      advancesPaid: '50000.00', applied: '12000.00', cashReturned: '3000.00', outstanding: '35000.00',
      reimbursed: '800.00', settled: '12000.00', expense: '12800.00',
    }]);
  });

  it('groups by category and by requester', async () => {
    await scenario();
    const byCategory = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'category', format: 'json' });
    expect(byCategory).toHaveLength(1);
    expect(byCategory[0]).toMatchObject({ key: categoryId, expense: '12800.00' });
    const byRequester = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'requester', format: 'json' });
    expect(byRequester[0]).toMatchObject({ key: ACTORS.engineer.id, advancesPaid: '50000.00' });
  });

  it('limits a PM to the projects in their scope, and refuses a caller without view_all', async () => {
    await scenario();
    expect(await reports.spend(ACTORS.pm, scopes.otherProject, { groupBy: 'project', format: 'json' })).toEqual([]);
    await expect(reports.spend(ACTORS.engineer, scopes.project, { groupBy: 'project', format: 'json' })).rejects.toThrow(/finance_request\.view_all/);
  });

  it('filters by date', async () => {
    await scenario();
    const future = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'project', format: 'json', from: new Date('2100-01-01') });
    expect(future).toEqual([]);
  });
});

describe('spend workbook', () => {
  it('writes one row per group with a header', async () => {
    await scenario();
    const rows = await reports.spend(ACTORS.finance, scopes.global, { groupBy: 'project', format: 'xlsx' });
    const book = new ExcelJS.Workbook();
    // exceljs ships an older, non-generic Buffer type; identical at runtime.
    await book.xlsx.load((await buildSpendWorkbook(rows)) as unknown as Parameters<typeof book.xlsx.load>[0]);
    const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(['Group', 'Advances paid', 'Expense (NPR)']));
    expect(sheet.getRow(2).getCell(1).value).toBe('KOS Koshi Rollout');
    expect(sheet.rowCount).toBe(2);
  });
});
