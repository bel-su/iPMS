import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS } from '@ipms/contracts';

/** One valid example row, which the template's own test parses to prove it is importable. */
const EXAMPLE: Record<string, string> = {
  site_code: 'SITE_001', name: 'Example Site', region: 'Bagmati',
  latitude: '27.7172', longitude: '85.3240', geofence: '',
  address: '1 Example Road', city: 'Kathmandu', area: 'Thamel',
  scope_variant: 'Standard', status: 'PLANNED',
};

export async function buildTemplate(defaultRadius: number | null): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sites');
  sheet.addRow([...IMPORT_COLUMNS]);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(IMPORT_COLUMNS.map((column) => EXAMPLE[column] ?? ''));
  for (const [index, column] of IMPORT_COLUMNS.entries()) sheet.getColumn(index + 1).width = Math.max(column.length + 4, 14);

  const notes = workbook.addWorksheet('Notes');
  notes.addRow(['site_code and name are required. Every other column is optional.']);
  notes.addRow(['Delete a column you do not want to change — a column left out is never written.']);
  notes.addRow(['A blank cell in a column that IS present clears that field.']);
  notes.addRow(['latitude and longitude must be filled in together, or both left blank.']);
  notes.addRow([
    defaultRadius === null
      ? 'geofence: blank uses this project setting, which is currently NO proximity check. Enter "off", or a radius in metres.'
      : `geofence: blank uses this project default of ${defaultRadius} m. Enter "off" for no check, or a radius in metres.`,
  ]);
  notes.getColumn(1).width = 110;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
