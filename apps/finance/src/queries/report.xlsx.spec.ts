import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSpendWorkbook, sanitizeCell } from './report.xlsx.js';
import type { SpendRow } from './report.service.js';

describe('sanitizeCell', () => {
  it('escapes leading characters that Excel parses as formula execution triggers', () => {
    expect(sanitizeCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(sanitizeCell('+cmd|/c calc')).toBe("'+cmd|/c calc");
    expect(sanitizeCell('-1+2')).toBe("'-1+2");
    expect(sanitizeCell('@SUM(1,2)')).toBe("'@SUM(1,2)");
    expect(sanitizeCell('\tTabLeading')).toBe("'\tTabLeading");
    expect(sanitizeCell('\rReturnLeading')).toBe("'\rReturnLeading");
  });

  it('leaves ordinary labels untouched', () => {
    expect(sanitizeCell('KOS Koshi Rollout')).toBe('KOS Koshi Rollout');
    expect(sanitizeCell('Engineering Travel')).toBe('Engineering Travel');
    expect(sanitizeCell('12345')).toBe('12345');
  });
});

describe('buildSpendWorkbook', () => {
  it('sanitizes malicious formula labels in generated worksheets', async () => {
    const rows: SpendRow[] = [
      {
        key: 'k-1',
        label: '=1+1',
        advancesPaid: '100.00',
        applied: '50.00',
        cashReturned: '0.00',
        outstanding: '50.00',
        reimbursed: '0.00',
        settled: '50.00',
        expense: '50.00',
      },
    ];

    const buffer = await buildSpendWorkbook(rows);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    const sheet = book.getWorksheet('Spend');
    expect(sheet).toBeDefined();
    const cellValue = sheet!.getRow(2).getCell(1).value;
    expect(cellValue).toBe("'=1+1");
  });
});
