import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  destinationPoint,
  distanceNm,
  projectToUnitSquare,
  trackDistanceNm,
} from './geo.js';
import { REGION, airportByIata } from './reference.js';

const YLW = airportByIata('YLW')!;
const YVR = airportByIata('YVR')!;

describe('distanceNm', () => {
  it('is zero for a point against itself', () => {
    expect(distanceNm(YLW, YLW)).toBeCloseTo(0, 6);
  });

  it('matches the published Kelowna to Vancouver distance', () => {
    // Great-circle YLW->YVR is roughly 148 nm.
    expect(distanceNm(YLW, YVR)).toBeGreaterThan(140);
    expect(distanceNm(YLW, YVR)).toBeLessThan(156);
  });

  it('is symmetric', () => {
    expect(distanceNm(YLW, YVR)).toBeCloseTo(distanceNm(YVR, YLW), 6);
  });
});

describe('bearingDeg', () => {
  it('points due east along the equator', () => {
    expect(bearingDeg({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 10 })).toBeCloseTo(
      90,
      4,
    );
  });

  it('points due north along a meridian', () => {
    expect(bearingDeg({ latitude: 0, longitude: 0 }, { latitude: 10, longitude: 0 })).toBeCloseTo(
      0,
      4,
    );
  });

  it('reports Kelowna to Vancouver as a westerly track', () => {
    const b = bearingDeg(YLW, YVR);
    expect(b).toBeGreaterThan(230);
    expect(b).toBeLessThan(280);
  });
});

describe('destinationPoint', () => {
  it('round-trips with distanceNm', () => {
    const moved = destinationPoint(YLW, 45, 120);
    expect(distanceNm(YLW, moved)).toBeCloseTo(120, 2);
  });

  it('round-trips with bearingDeg', () => {
    const moved = destinationPoint(YLW, 137, 80);
    expect(bearingDeg(YLW, moved)).toBeCloseTo(137, 2);
  });

  it('keeps longitude normalised into -180..180 when crossing the antimeridian', () => {
    const nearDateLine = { latitude: 0, longitude: 179 };
    const moved = destinationPoint(nearDateLine, 90, 300);
    expect(moved.longitude).toBeGreaterThanOrEqual(-180);
    expect(moved.longitude).toBeLessThanOrEqual(180);
    expect(moved.longitude).toBeLessThan(0);
  });
});

describe('trackDistanceNm', () => {
  it('is zero for fewer than two points', () => {
    expect(trackDistanceNm([])).toBe(0);
    expect(trackDistanceNm([YLW])).toBe(0);
  });

  it('sums consecutive legs', () => {
    const mid = destinationPoint(YLW, 270, 70);
    const total = trackDistanceNm([YLW, mid, YVR]);
    expect(total).toBeGreaterThan(distanceNm(YLW, YVR) - 1);
  });
});

describe('projectToUnitSquare', () => {
  it('places the north-west corner at the origin', () => {
    const p = projectToUnitSquare({ latitude: REGION.north, longitude: REGION.west }, REGION);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it('places the south-east corner at (1, 1)', () => {
    const p = projectToUnitSquare({ latitude: REGION.south, longitude: REGION.east }, REGION);
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(1, 9);
  });

  it('keeps every reference airport inside the display window', () => {
    for (const airport of [YLW, YVR]) {
      const p = projectToUnitSquare(airport, REGION);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});
