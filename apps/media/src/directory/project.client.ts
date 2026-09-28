import type { AuthzScope } from '@ipms/authz';
import { haversineMeters } from '@ipms/geo';
import { getJson, type Lookup } from './lookup.js';

export interface SiteGeofence { latitude: number | null; longitude: number | null; effectiveRadiusM: number | null }

export function distanceFromSite(site: SiteGeofence | null, latitude?: number, longitude?: number): number | null {
  if (!site || site.latitude === null || site.longitude === null) return null;
  if (latitude === undefined || longitude === undefined) return null;
  return Math.round(haversineMeters({ latitude: site.latitude, longitude: site.longitude }, { latitude, longitude }));
}

/** Scope and site coordinates, from project's internal endpoints, with the caller's own token. */
export class ProjectClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  scope(bearer: string): Promise<Lookup<AuthzScope>> {
    return getJson<AuthzScope>(`${this.baseUrl}/api/v1/internal/scope`, bearer, this.timeoutMs);
  }

  /** Null on any failure: the distance is informative, and losing it must never lose an upload. */
  async geofence(siteId: string, bearer: string): Promise<SiteGeofence | null> {
    const lookup = await getJson<SiteGeofence>(`${this.baseUrl}/api/v1/internal/sites/${siteId}/geofence`, bearer, this.timeoutMs);
    return lookup.state === 'found' ? lookup.value : null;
  }
}
