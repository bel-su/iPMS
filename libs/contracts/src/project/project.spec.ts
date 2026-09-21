import { describe, expect, it } from 'vitest';
import { CreateSiteSchema, CreateProjectSchema, UpdateSiteSchema } from './project.js';

const site = { siteCode: 'SITE_01', name: 'Site One' };

describe('CreateSiteSchema geofence', () => {
  it('defaults to INHERIT when no mode is given', () => {
    expect(CreateSiteSchema.parse(site).geofenceMode).toBe('INHERIT');
  });

  it('accepts OFF with no radius', () => {
    expect(CreateSiteSchema.parse({ ...site, geofenceMode: 'OFF' }).geofenceMode).toBe('OFF');
  });

  it('accepts CUSTOM with a radius', () => {
    expect(CreateSiteSchema.parse({ ...site, geofenceMode: 'CUSTOM', geofenceRadiusM: 250 }).geofenceRadiusM).toBe(250);
  });

  // The invalid state the resolver would otherwise have to guess at.
  it('rejects CUSTOM with no radius', () => {
    expect(CreateSiteSchema.safeParse({ ...site, geofenceMode: 'CUSTOM' }).success).toBe(false);
  });

  it('rejects a negative radius', () => {
    expect(CreateSiteSchema.safeParse({ ...site, geofenceMode: 'CUSTOM', geofenceRadiusM: -1 }).success).toBe(false);
  });
});

describe('CreateProjectSchema geofence', () => {
  it('accepts an explicit null default, meaning no checks on this project', () => {
    expect(CreateProjectSchema.parse({ code: 'P1', name: 'P', defaultGeofenceRadiusM: null }).defaultGeofenceRadiusM).toBeNull();
  });

  it('accepts a radius', () => {
    expect(CreateProjectSchema.parse({ code: 'P1', name: 'P', defaultGeofenceRadiusM: 500 }).defaultGeofenceRadiusM).toBe(500);
  });
});

describe('UpdateSiteSchema clearing', () => {
  it('accepts null for the fields an update may clear', () => {
    const parsed = UpdateSiteSchema.parse({ regionName: null, city: null, latitude: null, longitude: null });
    expect(parsed).toEqual({ regionName: null, city: null, latitude: null, longitude: null });
  });

  it('omits a field that was not sent, which is how "leave it alone" is said', () => {
    expect(UpdateSiteSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('rejects one coordinate sent without the other', () => {
    expect(UpdateSiteSchema.safeParse({ latitude: 27.7 }).success).toBe(false);
  });

  // Half a coordinate is a site no distance can be measured from.
  it('rejects one coordinate cleared while the other is set', () => {
    expect(UpdateSiteSchema.safeParse({ latitude: null, longitude: 85.3 }).success).toBe(false);
  });

  it('accepts both coordinates together', () => {
    expect(UpdateSiteSchema.safeParse({ latitude: 27.7, longitude: 85.3 }).success).toBe(true);
  });

  it('still rejects CUSTOM with no radius', () => {
    expect(UpdateSiteSchema.safeParse({ geofenceMode: 'CUSTOM' }).success).toBe(false);
  });

  // `.partial()` keeps the create schema's default, so an update that said
  // nothing about the geofence used to hand the service an INHERIT that the
  // caller never sent, silently discarding a site's CUSTOM radius or its OFF.
  it('does not invent a geofence mode for an update that never mentioned one', () => {
    expect(UpdateSiteSchema.parse({ name: 'Renamed' })).not.toHaveProperty('geofenceMode');
  });

  it('still refuses a latitude out of range', () => {
    expect(UpdateSiteSchema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false);
  });
});

describe('CreateSiteSchema clearing', () => {
  // Creating a site with an explicitly null city says nothing that omitting it does not.
  it('rejects null for a field only an update may clear', () => {
    expect(CreateSiteSchema.safeParse({ ...site, city: null }).success).toBe(false);
  });
});
