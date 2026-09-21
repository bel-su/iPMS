import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { IMPORT_ROW_LIMIT, type ImportColumn } from '@ipms/contracts';
import { normalizeHeader, type RawRow, type SheetContents } from './parse.js';

/**
 * Reads the first worksheet into plain strings.
 *
 * Everything becomes a string here and is parsed in `parse.ts`, so validation
 * never has to care whether Excel stored a coordinate as a number, a formula
 * result, or text a client typed with a stray space.
 */
export async function readSheet(buffer: Buffer): Promise<SheetContents> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs ships its own older @types/node, where `Buffer` is not generic;
    // ours is `Buffer<ArrayBufferLike>`. Identical at runtime, nominally
    // incompatible, so the cast sits at this one boundary rather than being
    // pushed out to every caller.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new BadRequestException('That file could not be read as an Excel workbook');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('That workbook has no worksheets');

  const columns: ImportColumn[] = [];
  const unknownHeaders: string[] = [];
  const positions = new Map<number, ImportColumn>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const text = String(cell.text ?? '');
    if (text.trim().length === 0) return;
    const column = normalizeHeader(text);
    if (!column) { unknownHeaders.push(text.trim()); return; }
    positions.set(colNumber, column);
    columns.push(column);
  });

  if (!columns.includes('site_code') || !columns.includes('name')) {
    throw new BadRequestException('The sheet needs at least a site_code column and a name column');
  }

  const rows: RawRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells: Partial<Record<ImportColumn, string>> = {};
    let hasValue = false;
    for (const [colNumber, column] of positions) {
      const text = String(row.getCell(colNumber).text ?? '');
      if (text.trim().length > 0) hasValue = true;
      cells[column] = text;
    }
    // A trailing run of formatting-only rows is normal in a hand-edited
    // spreadsheet and must not count against the cap or report as invalid.
    if (!hasValue) continue;
    rows.push({ rowNumber, cells });
    if (rows.length > IMPORT_ROW_LIMIT) {
      throw new BadRequestException(`This file has more than ${IMPORT_ROW_LIMIT} rows. Split it and import each part.`);
    }
  }

  if (rows.length === 0) throw new BadRequestException('That sheet has a header row and no data');
  return { columns, unknownHeaders, rows };
}
