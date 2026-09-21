import { describe, expect, it } from 'vitest';
import type { ImportColumn } from '@ipms/contracts';
import { parseRows } from './parse.js';

const sheet = (columns: ImportColumn[], cells: Array<Partial<Record<ImportColumn, string>>>) => ({
  columns, unknownHeaders: [],
  rows: cells.map((value, index) => ({ rowNumber: index + 2, cells: value })),
});

const BASE: ImportColumn[] = ['site_code', 'name'];

describe('parseRows', () => {
  it('parses a minimal valid row', () => {
    const [parsed] = parseRows(sheet(BASE, [{ site_code: 'SITE_01', name: 'One' }]));
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.row).toMatchObject({ siteCode: 'SITE_01', name: 'One', rowNumber: 2 });
  });

  it('uppercases and trims a site code', () => {
    const [parsed] = parseRows(sheet(BASE, [{ site_code: '  site_01 ', name: 'One' }]));
    expect(parsed?.row?.siteCode).toBe('SITE_01');
  });

  it('reports a missing required field', () => {
    const [parsed] = parseRows(sheet(BASE, [{ site_code: 'SITE_01', name: '  ' }]));
    expect(parsed?.row).toBeNull();
    expect(parsed?.errors.join(' ')).toContain('name');
  });

  // A lone coordinate is always a data-entry error: the site would look
  // located but could never be measured against.
  it('rejects a latitude with no longitude', () => {
    const [parsed] = parseRows(sheet([...BASE, 'latitude', 'longitude'], [{ site_code: 'S1', name: 'One', latitude: '27.7' }]));
    expect(parsed?.errors.join(' ')).toContain('latitude and longitude');
  });

  it('rejects an out-of-range latitude', () => {
    const [parsed] = parseRows(sheet([...BASE, 'latitude', 'longitude'], [{ site_code: 'S1', name: 'One', latitude: '99', longitude: '85' }]));
    expect(parsed?.row).toBeNull();
  });

  it('reads a blank geofence cell as INHERIT', () => {
    const [parsed] = parseRows(sheet([...BASE, 'geofence'], [{ site_code: 'S1', name: 'One', geofence: '' }]));
    expect(parsed?.row).toMatchObject({ geofenceMode: 'INHERIT', geofenceRadiusM: null });
  });

  it('reads "off" in any case as OFF', () => {
    const [parsed] = parseRows(sheet([...BASE, 'geofence'], [{ site_code: 'S1', name: 'One', geofence: 'Off' }]));
    expect(parsed?.row).toMatchObject({ geofenceMode: 'OFF' });
  });

  it('reads a number as a custom radius', () => {
    const [parsed] = parseRows(sheet([...BASE, 'geofence'], [{ site_code: 'S1', name: 'One', geofence: '250' }]));
    expect(parsed?.row).toMatchObject({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 });
  });

  it('rejects a geofence value that is neither off nor a number', () => {
    const [parsed] = parseRows(sheet([...BASE, 'geofence'], [{ site_code: 'S1', name: 'One', geofence: 'maybe' }]));
    expect(parsed?.errors.join(' ')).toContain('geofence');
  });

  it('flags a duplicate site code within the file, on the later row', () => {
    const parsed = parseRows(sheet(BASE, [
      { site_code: 'SITE_01', name: 'One' },
      { site_code: 'site_01', name: 'Two' },
    ]));
    expect(parsed[0]?.errors).toEqual([]);
    expect(parsed[1]?.errors.join(' ')).toContain('appears more than once');
  });

  it('reads a blank cell in a present column as an explicit clear', () => {
    const [parsed] = parseRows(sheet([...BASE, 'city'], [{ site_code: 'S1', name: 'One', city: '' }]));
    expect(parsed?.row?.city).toBeNull();
  });

  // The other half of that rule: an absent column is not a clear.
  it('leaves a field undefined when its column is absent', () => {
    const [parsed] = parseRows(sheet(BASE, [{ site_code: 'S1', name: 'One' }]));
    expect(parsed?.row?.city).toBeUndefined();
  });

  it('collects every error on a row, not just the first', () => {
    const [parsed] = parseRows(sheet([...BASE, 'status'], [{ site_code: 'bad code!', name: '', status: 'NOPE' }]));
    expect(parsed?.errors.length).toBeGreaterThanOrEqual(3);
  });
});
