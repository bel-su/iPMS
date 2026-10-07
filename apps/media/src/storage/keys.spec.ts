import { describe, expect, it } from 'vitest';
import { evidenceKeys, financeKeys } from './keys.js';

const P = '0192f7a0-0000-7000-8000-000000000001';
const S = '0192f7a0-0000-7000-8000-000000000002';
const M = '0192f7a0-0000-7000-8000-000000000003';

describe('evidenceKeys', () => {
  it('files a photo and its thumbnail under project and site', () => {
    expect(evidenceKeys({ projectId: P, siteId: S, id: M, kind: 'PHOTO' })).toEqual({
      storageKey: `projects/${P}/sites/${S}/evidence/${M}.jpg`,
      thumbnailKey: `projects/${P}/sites/${S}/evidence/${M}.thumb.webp`,
    });
  });

  it('gives a video a phone-made poster', () => {
    expect(evidenceKeys({ projectId: P, siteId: S, id: M, kind: 'VIDEO' }).thumbnailKey).toBe(`projects/${P}/sites/${S}/evidence/${M}.poster.jpg`);
  });

  it('refuses anything that is not a UUID, so no caller can steer a key', () => {
    expect(() => evidenceKeys({ projectId: '../other', siteId: S, id: M, kind: 'PHOTO' })).toThrow('Invalid id');
  });
});

describe('financeKeys', () => {
  it('files an invoice photo under its project, apart from site evidence', () => {
    expect(financeKeys({ projectId: P, id: M })).toEqual({
      storageKey: `projects/${P}/finance/${M}.jpg`,
      thumbnailKey: `projects/${P}/finance/${M}.thumb.webp`,
    });
  });

  it('refuses anything that is not a UUID', () => {
    expect(() => financeKeys({ projectId: '../x', id: M })).toThrow();
  });
});
