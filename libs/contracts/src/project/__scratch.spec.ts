import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const Lat = z.number().gte(-90).lte(90);
const Lon = z.number().gte(-180).lte(180);
const Fields = z.object({ name: z.string(), latitude: Lat.optional(), longitude: Lon.optional() });

const together = (v: { latitude?: number | null; longitude?: number | null }): boolean => {
  const lat = v.latitude !== undefined;
  const lon = v.longitude !== undefined;
  if (!lat && !lon) return true;
  if (lat !== lon) return false;
  return (v.latitude === null) === (v.longitude === null);
};

const Update = Fields.partial()
  .extend({ latitude: Lat.nullable().optional(), longitude: Lon.nullable().optional() })
  .strip()
  .refine(() => true, { message: 'x', path: ['geofenceRadiusM'] })
  .refine(together, { message: 'pair', path: ['latitude'] });

describe('scratch', () => {
  it('accepts both null', () => { expect(Update.safeParse({ latitude: null, longitude: null }).success).toBe(true); });
  it('accepts neither', () => { expect(Update.safeParse({ name: 'x' }).success).toBe(true); });
  it('rejects one alone', () => { expect(Update.safeParse({ latitude: 1 }).success).toBe(false); });
  it('rejects one nulled', () => { expect(Update.safeParse({ latitude: null, longitude: 2 }).success).toBe(false); });
  it('omits absent keys', () => { expect(Update.parse({ name: 'x' })).toEqual({ name: 'x' }); });
});
