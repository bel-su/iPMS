import { describe, expect, it } from 'vitest';
import type { ImportColumn } from '@ipms/contracts';
import { diffSite } from './site-import.service.js';

const existing = {
  siteCode: 'S1', name: 'One', city: 'Kathmandu', address: null, area: null,
  scopeVariant: null, status: 'PLANNED', latitude: null, longitude: null,
  geofenceMode: 'INHERIT', geofenceRadiusM: null, region: { name: 'North' },
};

describe('diffSite', () => {
  it('reports a changed field', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One', city: 'Pokhara' } as never, ['site_code', 'name', 'city'] as ImportColumn[]);
    expect(changes).toEqual([{ field: 'city', from: 'Kathmandu', to: 'Pokhara' }]);
  });

  it('reports nothing when the value is unchanged', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One', city: 'Kathmandu' } as never, ['site_code', 'name', 'city'] as ImportColumn[]);
    expect(changes).toEqual([]);
  });

  // The rule that protects a three-column correction file from wiping data.
  it('ignores a field whose column is absent from the sheet', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One' } as never, ['site_code', 'name'] as ImportColumn[]);
    expect(changes).toEqual([]);
  });

  // The other half: a blank cell in a present column IS a clear, and the
  // manager must see it before confirming.
  it('reports a blank cell in a present column as a clear', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One', city: null } as never, ['site_code', 'name', 'city'] as ImportColumn[]);
    expect(changes).toEqual([{ field: 'city', from: 'Kathmandu', to: null }]);
  });

  it('reports a region change by name', () => {
    const changes = diffSite(existing, { rowNumber: 2, siteCode: 'S1', name: 'One', regionName: 'South' } as never, ['site_code', 'name', 'region'] as ImportColumn[]);
    expect(changes).toEqual([{ field: 'region', from: 'North', to: 'South' }]);
  });
});
