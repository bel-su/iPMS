import { describe, expect, it } from 'vitest';
import { haversineMeters } from './haversine.js';

/** One degree of arc on the mean-radius sphere is ~111,195 m. */
const ONE_DEGREE_MIN = 111_150;
const ONE_DEGREE_MAX = 111_240;

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ latitude: 27.7172, longitude: 85.324 }, { latitude: 27.7172, longitude: 85.324 })).toBe(0);
  });

  it('measures one degree of longitude at the equator', () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(d).toBeGreaterThanOrEqual(ONE_DEGREE_MIN);
    expect(d).toBeLessThanOrEqual(ONE_DEGREE_MAX);
  });

  it('measures one degree of latitude', () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThanOrEqual(ONE_DEGREE_MIN);
    expect(d).toBeLessThanOrEqual(ONE_DEGREE_MAX);
  });

  it('measures a ~500 m step north', () => {
    const d = haversineMeters({ latitude: 27.7172, longitude: 85.324 }, { latitude: 27.7217, longitude: 85.324 });
    expect(d).toBeGreaterThanOrEqual(498);
    expect(d).toBeLessThanOrEqual(502);
  });

  // The short way round, not 359 degrees the long way. A site near the
  // antimeridian must not read as a third of the planet away.
  it('crosses the antimeridian the short way', () => {
    const d = haversineMeters({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 });
    expect(d).toBeGreaterThanOrEqual(ONE_DEGREE_MIN);
    expect(d).toBeLessThanOrEqual(ONE_DEGREE_MAX);
  });

  it('is symmetric', () => {
    const a = { latitude: 27.7172, longitude: 85.324 };
    const b = { latitude: 28.2096, longitude: 83.9856 };
    expect(haversineMeters(a, b)).toBe(haversineMeters(b, a));
  });
});
