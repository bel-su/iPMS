import { IMPORT_COLUMNS, SiteImportRowSchema, type ImportColumn, type SiteImportRowDto } from '@ipms/contracts';

export interface RawRow {
  rowNumber: number;
  cells: Partial<Record<ImportColumn, string>>;
}

export interface SheetContents {
  columns: ImportColumn[];
  unknownHeaders: string[];
  rows: RawRow[];
}

export interface ParsedRow {
  rowNumber: number;
  row: SiteImportRowDto | null;
  errors: string[];
}

/**
 * A cell's three states, which the missing-column rule turns on.
 *
 * `undefined` — the column is not in the sheet, so the field is not touched.
 * `null`      — the column is present and the cell is blank: clear the field.
 * a string    — a value to parse.
 */
function cell(row: RawRow, columns: ImportColumn[], column: ImportColumn): string | null | undefined {
  if (!columns.includes(column)) return undefined;
  const raw = row.cells[column];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseGeofence(value: string | null | undefined, errors: string[]): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null) return { geofenceMode: 'INHERIT', geofenceRadiusM: null };
  if (value.toLowerCase() === 'off') return { geofenceMode: 'OFF', geofenceRadiusM: null };
  const radius = Number(value);
  if (!Number.isInteger(radius) || radius <= 0) {
    errors.push(`geofence must be blank, "off", or a positive whole number of metres — got "${value}"`);
    return {};
  }
  return { geofenceMode: 'CUSTOM', geofenceRadiusM: radius };
}

function parseCoordinates(
  latitude: string | null | undefined,
  longitude: string | null | undefined,
  errors: string[],
): Record<string, unknown> {
  if (latitude === undefined && longitude === undefined) return {};
  const present = (value: string | null | undefined): boolean => typeof value === 'string';
  if (present(latitude) !== present(longitude)) {
    errors.push('latitude and longitude must be given together, or both left blank');
    return {};
  }
  if (!present(latitude)) return { latitude: null, longitude: null };
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    errors.push('latitude and longitude must be numbers');
    return {};
  }
  return { latitude: lat, longitude: lon };
}

/**
 * Validates every row and reports every problem on each, rather than stopping
 * at the first — one upload should surface everything wrong with the file.
 */
export function parseRows(sheet: SheetContents): ParsedRow[] {
  const seen = new Map<string, number>();
  return sheet.rows.map((raw) => {
    const errors: string[] = [];
    const siteCode = (cell(raw, sheet.columns, 'site_code') ?? '').toUpperCase();
    const candidate: Record<string, unknown> = {
      rowNumber: raw.rowNumber,
      siteCode,
      name: cell(raw, sheet.columns, 'name') ?? '',
      ...parseCoordinates(cell(raw, sheet.columns, 'latitude'), cell(raw, sheet.columns, 'longitude'), errors),
      ...parseGeofence(cell(raw, sheet.columns, 'geofence'), errors),
    };

    const text: Array<[ImportColumn, string]> = [
      ['region', 'regionName'], ['address', 'address'], ['city', 'city'],
      ['area', 'area'], ['scope_variant', 'scopeVariant'], ['status', 'status'],
    ];
    for (const [column, field] of text) {
      const value = cell(raw, sheet.columns, column);
      if (value !== undefined) candidate[field] = value;
    }
    // A blank status is the schema's default, not a clear — there is no
    // "no status" state on a site.
    if (candidate['status'] === null) delete candidate['status'];

    if (siteCode.length > 0) {
      const first = seen.get(siteCode);
      if (first !== undefined) errors.push(`site code ${siteCode} appears more than once in this file (first on row ${first})`);
      else seen.set(siteCode, raw.rowNumber);
    }

    const parsed = SiteImportRowSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${issue.path.join('.') || 'row'}: ${issue.message}`);
    }
    return { rowNumber: raw.rowNumber, row: errors.length === 0 && parsed.success ? parsed.data : null, errors };
  });
}

/** Header text to a known column: lowercased, trimmed, spaces and hyphens folded to underscores. */
export function normalizeHeader(raw: string): ImportColumn | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (IMPORT_COLUMNS as readonly string[]).includes(key) ? (key as ImportColumn) : null;
}
