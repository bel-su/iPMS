import { describe, expect, it } from 'vitest';
import { photoLabel, videoLabel } from './labels';

describe('evidence labels', () => {
  it('describes video counts like photo counts', () => {
    expect(videoLabel(0, 0)).toBeNull();
    expect(videoLabel(0, 2)).toBe('Optional, up to 2 videos');
    expect(videoLabel(1, 1)).toBe('1 video');
    expect(videoLabel(1, 3)).toBe('1–3 videos');
  });
  it('leaves photo labels unchanged', () => {
    expect(photoLabel(0, 1)).toBe('Optional, up to 1 photo');
    expect(photoLabel(2, 4)).toBe('2–4 photos');
  });
});
