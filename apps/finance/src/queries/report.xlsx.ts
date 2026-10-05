import ExcelJS from 'exceljs';
import type { SpendRow } from './report.service.js';

const MONEY = '#,##0.00';

/** The spend report as an Excel file, replacing the spreadsheets this service exists to retire. */
export async function buildSpendWorkbook(rows: SpendRow[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Spend');
  sheet.columns = [
    { header: 'Group', key: 'label', width: 36 },
    { header: 'Advances paid', key: 'advancesPaid', width: 18 },
    { header: 'Applied to settlements', key: 'applied', width: 22 },
    { header: 'Cash returned', key: 'cashReturned', width: 16 },
    { header: 'Outstanding', key: 'outstanding', width: 16 },
    { header: 'Reimbursed', key: 'reimbursed', width: 16 },
    { header: 'Settled', key: 'settled', width: 16 },
    { header: 'Expense (NPR)', key: 'expense', width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow({
      label: row.label, advancesPaid: Number(row.advancesPaid), applied: Number(row.applied), cashReturned: Number(row.cashReturned),
      outstanding: Number(row.outstanding), reimbursed: Number(row.reimbursed), settled: Number(row.settled), expense: Number(row.expense),
    });
  }
  for (let c = 2; c <= 8; c += 1) sheet.getColumn(c).numFmt = MONEY;
  return Buffer.from(await book.xlsx.writeBuffer());
}
