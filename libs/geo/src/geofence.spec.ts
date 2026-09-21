import { describe, expect, it } from 'vitest';
import { resolveGeofenceRadius } from './geofence.js';

describe('resolveGeofenceRadius', () => {
  it('returns null for an OFF site even when the project has a default', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'OFF', geofenceRadiusM: 250 }, { defaultGeofenceRadiusM: 500 })).toBeNull();
  });

  it('returns the site radius for a CUSTOM site', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'CUSTOM', geofenceRadiusM: 250 }, { defaultGeofenceRadiusM: 500 })).toBe(250);
  });

  it('returns the project default for an INHERIT site', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'INHERIT', geofenceRadiusM: null }, { defaultGeofenceRadiusM: 500 })).toBe(500);
  });

  it('returns null for an INHERIT site when the project runs no checks', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'INHERIT', geofenceRadiusM: null }, { defaultGeofenceRadiusM: null })).toBeNull();
  });

  // Rejected by the contract schema, so it cannot be persisted — but the
  // resolver is also reached from the internal endpoint reading rows written
  // before that schema existed, and "no check" is the safe reading.
  it('returns null for a CUSTOM site with no radius', () => {
    expect(resolveGeofenceRadius({ geofenceMode: 'CUSTOM', geofenceRadiusM: null }, { defaultGeofenceRadiusM: 500 })).toBeNull();
  });
});
