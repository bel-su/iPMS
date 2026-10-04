import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectClient, distanceFromSite } from './project.client.js';

afterEach(() => vi.restoreAllMocks());

describe('ProjectClient', () => {
  it('reads the caller scope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ global: false, projectIds: ['p'], siteIds: [] }), { status: 200 }));
    expect(await new ProjectClient('http://project:3004').scope('Bearer t')).toEqual({ state: 'found', value: { global: false, projectIds: ['p'], siteIds: [] } });
  });

  it('returns null geofence on any failure: a missing distance must not block an upload', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    expect(await new ProjectClient('http://project:3004').geofence('s', 'Bearer t')).toBeNull();
  });
});

describe('distanceFromSite', () => {
  const site = { latitude: 26.4525, longitude: 87.2718, effectiveRadiusM: 100 };
  it('rounds to whole metres', () => {
    expect(distanceFromSite(site, 26.4525, 87.2718)).toBe(0);
    expect(distanceFromSite(site, 26.4534, 87.2718)).toBe(100);
  });
  it('is null without both fixes', () => {
    expect(distanceFromSite(null, 26.4, 87.2)).toBeNull();
    expect(distanceFromSite({ latitude: null, longitude: null, effectiveRadiusM: null }, 26.4, 87.2)).toBeNull();
    expect(distanceFromSite(site, undefined, undefined)).toBeNull();
  });
});
