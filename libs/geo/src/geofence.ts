export type GeofenceMode = 'INHERIT' | 'CUSTOM' | 'OFF';

export interface GeofenceSite {
  geofenceMode: GeofenceMode;
  geofenceRadiusM: number | null;
}

export interface GeofenceProject {
  defaultGeofenceRadiusM: number | null;
}

/**
 * The effective proximity radius for a site in metres, or `null` for no check.
 *
 * `null` is the single representation of "do not check". There is deliberately
 * no second enabled flag that could disagree with the radius.
 */
export function resolveGeofenceRadius(site: GeofenceSite, project: GeofenceProject): number | null {
  if (site.geofenceMode === 'OFF') return null;
  if (site.geofenceMode === 'CUSTOM') return site.geofenceRadiusM;
  return project.defaultGeofenceRadiusM;
}
