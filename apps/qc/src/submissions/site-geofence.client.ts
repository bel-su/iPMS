import { haversineMeters } from '@ipms/geo';

export type GeofenceStatus = 'INSIDE' | 'OUTSIDE' | 'NO_FIX' | 'NOT_APPLICABLE' | 'UNVERIFIED';

export interface SiteGeofence {
  latitude: number | null;
  longitude: number | null;
  effectiveRadiusM: number | null;
}

export interface GeofenceOutcome {
  geofenceStatus: GeofenceStatus;
  distanceFromSiteM: number | null;
}

/**
 * Classifies one submission against its site.
 *
 * Ordered by precedence and evaluated first-match. A site that runs no check
 * answers `NOT_APPLICABLE` even when the device also had no fix: "we were not
 * checking" is a more useful answer to a reviewer than "the device could not
 * say".
 *
 * Pure. The fetch that can fail happens in `SiteGeofenceClient`, and its
 * failure arrives here as a `null` site, so every branch is reachable from a
 * unit test without a network.
 */
export function resolveGeofence(
  site: SiteGeofence | null,
  // The explicit `| undefined`s are required under exactOptionalPropertyTypes:
  // a caller's parsed DTO has these as `number | undefined`, which is not
  // assignable to a bare `latitude?: number`.
  submitted: { latitude?: number | undefined; longitude?: number | undefined },
): GeofenceOutcome {
  if (!site) return { geofenceStatus: 'UNVERIFIED', distanceFromSiteM: null };
  if (site.latitude === null || site.longitude === null || site.effectiveRadiusM === null) {
    return { geofenceStatus: 'NOT_APPLICABLE', distanceFromSiteM: null };
  }
  if (submitted.latitude === undefined || submitted.longitude === undefined) {
    return { geofenceStatus: 'NO_FIX', distanceFromSiteM: null };
  }
  const distance = haversineMeters(
    { latitude: site.latitude, longitude: site.longitude },
    { latitude: submitted.latitude, longitude: submitted.longitude },
  );
  return { geofenceStatus: distance <= site.effectiveRadiusM ? 'INSIDE' : 'OUTSIDE', distanceFromSiteM: distance };
}

/**
 * Reads a site's geofence from the project service.
 *
 * Returns `null` on any failure rather than throwing. A submission is field
 * work already done; losing it because this lookup timed out would be a far
 * worse outcome than not knowing where it was filed from. The caller turns a
 * `null` into a recorded `UNVERIFIED`, so "we could not check" stays a fact on
 * the record rather than being indistinguishable from "nothing to check".
 *
 * Forwards the submitting user's own bearer token, so the endpoint stays
 * permission-checked and this needs no shared secret or service identity.
 */
export class SiteGeofenceClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 2000) {}

  async fetch(siteId: string, bearer: string): Promise<SiteGeofence | null> {
    try {
      const response = await globalThis.fetch(`${this.baseUrl}/api/v1/internal/sites/${siteId}/geofence`, {
        headers: { authorization: bearer },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return null;
      return (await response.json()) as SiteGeofence;
    } catch {
      return null;
    }
  }
}
