import { describe, expect, it } from 'vitest';
import { acceptVersion } from './version-acceptance.js';

const NOW = new Date('2026-09-22T12:00:00Z');
const DAY = 86_400_000;
const enabled = { disabledAt: null };

describe('acceptVersion', () => {
  it('accepts the published version', () => {
    expect(acceptVersion({ status: 'PUBLISHED', retiredAt: null }, enabled, NOW, 7)).toEqual({ ok: true });
  });

  it('accepts a version retired within the grace window', () => {
    const retiredAt = new Date(NOW.getTime() - 6 * DAY);
    expect(acceptVersion({ status: 'RETIRED', retiredAt }, enabled, NOW, 7)).toEqual({ ok: true });
  });

  it('refuses a version retired before the grace window', () => {
    const retiredAt = new Date(NOW.getTime() - 8 * DAY);
    expect(acceptVersion({ status: 'RETIRED', retiredAt }, enabled, NOW, 7)).toEqual({ ok: false, reason: 'SUPERSEDED' });
  });

  it('refuses at exactly the edge of the window', () => {
    const retiredAt = new Date(NOW.getTime() - 7 * DAY);
    expect(acceptVersion({ status: 'RETIRED', retiredAt }, enabled, NOW, 7)).toEqual({ ok: false, reason: 'SUPERSEDED' });
  });

  it('refuses a draft', () => {
    expect(acceptVersion({ status: 'DRAFT', retiredAt: null }, enabled, NOW, 7)).toEqual({ ok: false, reason: 'NOT_PUBLISHED' });
  });

  it('refuses anything on a disabled template, first', () => {
    expect(acceptVersion({ status: 'PUBLISHED', retiredAt: null }, { disabledAt: NOW }, NOW, 7)).toEqual({ ok: false, reason: 'DISABLED' });
  });
});
