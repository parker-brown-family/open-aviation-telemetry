/** Spherical-earth geodesy. Good to ~0.5% — ample for fleet display and demo distances. */

export const EARTH_RADIUS_NM = 3440.065;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in nautical miles. */
export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from `a` to `b`, degrees true, 0..360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by travelling `distNm` from `origin` on bearing `headingDeg`. */
export function destinationPoint(origin: LatLon, headingDeg: number, distNm: number): LatLon {
  const delta = distNm / EARTH_RADIUS_NM;
  const theta = toRad(headingDeg);
  const lat1 = toRad(origin.latitude);
  const lon1 = toRad(origin.longitude);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latitude: toDeg(lat2),
    longitude: ((toDeg(lon2) + 540) % 360) - 180,
  };
}

/** Total path length of an ordered track, in nautical miles. */
export function trackDistanceNm(points: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev && curr) total += distanceNm(prev, curr);
  }
  return total;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Equirectangular projection into a unit square (0..1, y down). The map view is a
 * plan-view scope over a fixed region, not a slippy map, so the cheapest correct
 * projection is the right one — and it removes any third-party tile dependency.
 */
export function projectToUnitSquare(p: LatLon, box: BoundingBox): { x: number; y: number } {
  const x = (p.longitude - box.west) / (box.east - box.west);
  const y = (box.north - p.latitude) / (box.north - box.south);
  return { x, y };
}
