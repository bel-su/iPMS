import { describe, expect, it } from 'vitest';
import { CreateSiteSchema, CreateProjectSchema } from './project.js';

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
