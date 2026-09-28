import { describe, expect, it } from 'vitest';
import { readableName } from './filename.js';

const id = '0192f7a0-0000-7000-8000-00000000abcd';

describe('readableName', () => {
  it('names a download by site code, capture time (UTC) and a short id', () => {
    expect(readableName({ siteCode: 'KOS121', capturedAt: new Date('2026-09-28T08:05:09Z'), id, variant: 'original', kind: 'PHOTO' }))
      .toBe('KOS121_20260928-080509_00abcd.jpg');
  });

  it('uses the thumbnail and video extensions', () => {
    expect(readableName({ siteCode: 'KOS121', capturedAt: null, id, variant: 'thumbnail', kind: 'PHOTO' })).toBe('KOS121_undated_00abcd.webp');
    expect(readableName({ siteCode: null, capturedAt: null, id, variant: 'original', kind: 'VIDEO' })).toBe('site_undated_00abcd.mp4');
    expect(readableName({ siteCode: 'KOS121', capturedAt: null, id, variant: 'thumbnail', kind: 'VIDEO' })).toBe('KOS121_undated_00abcd.jpg');
  });
});
