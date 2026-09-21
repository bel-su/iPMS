import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS } from '@ipms/contracts';
import { buildTemplate } from './template.js';

describe('buildTemplate', () => {
  it('produces a workbook whose header row is exactly the import columns', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplate(500) as never);
    const headers = workbook.worksheets[0]?.getRow(1).values as string[];
    expect(headers.slice(1)).toEqual([...IMPORT_COLUMNS]);
  });

  // The point of shipping a template: its example row must survive the
  // importer it is a template for, unchanged.
  it('round-trips through the parser it is a template for', async () => {
    const { readSheet } = await import('./workbook.js');
    const { parseRows } = await import('./parse.js');
    const sheet = await readSheet(await buildTemplate(500));
    expect(parseRows(sheet).every((row) => row.errors.length === 0)).toBe(true);
  });
});
