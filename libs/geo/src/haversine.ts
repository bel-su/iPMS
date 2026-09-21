export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** IUGG mean Earth radius. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres, rounded to the nearest metre.
 *
 * A spherical model is ~0.5% off an ellipsoidal one, which is an order of
 * magnitude inside the error of the handset GPS fix this is ever compared
 * against. Sub-metre precision here would be false precision.
 *
 * `Math.min(1, …)` guards the `asin` domain: for two points a few centimetres
 * apart, floating-point error can push the square root a hair above 1 and
 * produce NaN.
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}
