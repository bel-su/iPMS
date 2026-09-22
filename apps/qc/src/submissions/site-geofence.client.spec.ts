import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteGeofenceClient, resolveGeofence } from './site-geofence.client.js';

const SITE = { latitude: 27.7172, longitude: 85.324, effectiveRadiusM: 500 };

describe('resolveGeofence', () => {
  it('is INSIDE within the radius', () => {
    expect(resolveGeofence(SITE, { latitude: 27.7175, longitude: 85.324 })).toMatchObject({ geofenceStatus: 'INSIDE' });
  });

  it('is OUTSIDE beyond it, and says by how far', () => {
    const result = resolveGeofence(SITE, { latitude: 27.7372, longitude: 85.324 });
    expect(result.geofenceStatus).toBe('OUTSIDE');
    expect(result.distanceFromSiteM).toBeGreaterThan(500);
  });

  // The project service could not be reached. Distinct from "we checked and
  // it was fine" and from "there was nothing to check".
  it('is UNVERIFIED when the site could not be fetched', () => {
    expect(resolveGeofence(null, { latitude: 27.7, longitude: 85.3 })).toEqual({ geofenceStatus: 'UNVERIFIED', distanceFromSiteM: null });
  });

  it('is NOT_APPLICABLE when the site runs no check', () => {
    expect(resolveGeofence({ ...SITE, effectiveRadiusM: null }, { latitude: 27.7, longitude: 85.3 })).toMatchObject({ geofenceStatus: 'NOT_APPLICABLE' });
  });

  it('is NOT_APPLICABLE when the site has no coordinates', () => {
    expect(resolveGeofence({ latitude: null, longitude: null, effectiveRadiusM: 500 }, { latitude: 27.7, longitude: 85.3 })).toMatchObject({ geofenceStatus: 'NOT_APPLICABLE' });
  });

  it('is NO_FIX when the device sent no coordinates', () => {
    expect(resolveGeofence(SITE, {})).toEqual({ geofenceStatus: 'NO_FIX', distanceFromSiteM: null });
  });

  // Precedence: a site with no check answers NOT_APPLICABLE even when the
  // device also had no fix. "We were not checking" is the more useful answer.
  it('prefers NOT_APPLICABLE over NO_FIX', () => {
    expect(resolveGeofence({ ...SITE, effectiveRadiusM: null }, {})).toMatchObject({ geofenceStatus: 'NOT_APPLICABLE' });
  });

  // The bound is inclusive: an engineer standing exactly on the radius is in,
  // not out. 0.0045 degrees north is ~500 m.
  it('counts a point exactly on the boundary as inside', () => {
    const edge = { latitude: 27.7217, longitude: 85.324 };
    const distance = resolveGeofence(SITE, edge).distanceFromSiteM;
    expect(distance).toBe(500);
    expect(resolveGeofence({ ...SITE, effectiveRadiusM: 500 }, edge)).toMatchObject({ geofenceStatus: 'INSIDE' });
    expect(resolveGeofence({ ...SITE, effectiveRadiusM: 499 }, edge)).toMatchObject({ geofenceStatus: 'OUTSIDE' });
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('SiteGeofenceClient.fetch — never throws', () => {
  const client = new SiteGeofenceClient('http://project:3004');

  it('returns null when the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(client.fetch('s-1', 'Bearer t')).resolves.toBeNull();
  });

  it('returns null on a non-2xx answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    await expect(client.fetch('s-1', 'Bearer t')).resolves.toBeNull();
  });

  it('returns null when the answer is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
    await expect(client.fetch('s-1', 'Bearer t')).resolves.toBeNull();
  });

  it('forwards the caller’s bearer token to the internal endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ latitude: null, longitude: null, effectiveRadiusM: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await client.fetch('s-1', 'Bearer t');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://project:3004/api/v1/internal/sites/s-1/geofence');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer t' });
  });
});
