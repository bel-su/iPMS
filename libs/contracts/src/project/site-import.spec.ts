import { describe, expect, it } from 'vitest';
import { IMPORT_ROW_LIMIT, SiteImportCommitSchema } from './site-import.js';

const row = { rowNumber: 2, siteCode: 'SITE_01', name: 'One' };

describe('SiteImportCommitSchema', () => {
  it('accepts a minimal commit', () => {
    const parsed = SiteImportCommitSchema.parse({ columns: ['site_code', 'name'], rows: [row] });
    expect(parsed.rows).toHaveLength(1);
  });

  it('rejects an empty commit', () => {
    expect(SiteImportCommitSchema.safeParse({ columns: ['site_code'], rows: [] }).success).toBe(false);
  });

  it('rejects more rows than the cap', () => {
    const rows = Array.from({ length: IMPORT_ROW_LIMIT + 1 }, (_, i) => ({ ...row, rowNumber: i + 2 }));
    expect(SiteImportCommitSchema.safeParse({ columns: ['site_code', 'name'], rows }).success).toBe(false);
  });

  it('rejects a column name that is not an import column', () => {
    expect(SiteImportCommitSchema.safeParse({ columns: ['nonsense'], rows: [row] }).success).toBe(false);
  });
});
