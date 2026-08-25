import { describe, expect, it } from 'vitest';
import {
  ALTITUDE_BANDS,
  INITIAL_VIEW,
  LABELS_LAYER,
  TERRAIN_LAYER,
  TILE_TIMEOUT_MS,
  altitudeColor,
} from './basemap.js';

describe('altitudeColor', () => {
  it('returns a distinct colour for each band', () => {
    const colours = ALTITUDE_BANDS.map((b) => altitudeColor(b.from));
    expect(new Set(colours).size).toBe(ALTITUDE_BANDS.length);
  });

  it('picks the band a given altitude falls in', () => {
    expect(altitudeColor(35000)).toBe(altitudeColor(30000));
    expect(altitudeColor(24000)).toBe(altitudeColor(20000));
    expect(altitudeColor(1200)).toBe(altitudeColor(0));
  });

  it('puts a boundary altitude in the higher band, not the lower one', () => {
    // Bands are inclusive at their lower bound, so exactly 20,000 ft is the
    // 20–30 band. Off-by-one here would recolour a whole cruise altitude.
    expect(altitudeColor(20000)).toBe(altitudeColor(25000));
    expect(altitudeColor(19999)).toBe(altitudeColor(15000));
  });

  it('does not claim a colour for an unknown altitude', () => {
    // A missing altitude is not "on the ground" — it must look different from
    // every real band, or a non-reporting aircraft reads as a low one.
    const unknown = altitudeColor(null);
    expect(unknown).toBe(altitudeColor(undefined));
    expect(unknown).toBe(altitudeColor(Number.NaN));
    for (const band of ALTITUDE_BANDS) {
      expect(unknown).not.toBe(altitudeColor(band.from));
    }
  });

  it('handles a negative altitude, which real barometric readings produce', () => {
    // Below-sea-level pressure altitudes are ordinary at a low QNH.
    expect(() => altitudeColor(-200)).not.toThrow();
  });
});

describe('altitude bands', () => {
  it('are ordered high to low, which the lookup relies on', () => {
    const bounds = ALTITUDE_BANDS.map((b) => b.from);
    expect([...bounds].sort((a, b) => b - a)).toEqual(bounds);
  });

  it('reach the ground, so every altitude matches something', () => {
    expect(ALTITUDE_BANDS[ALTITUDE_BANDS.length - 1]?.from).toBe(0);
  });

  it('take their colours from theme tokens rather than hard-coded hexes', () => {
    // Keeps the map inside the tactical palette when the theme changes.
    for (const band of ALTITUDE_BANDS) {
      expect(band.color).toMatch(/^rgb\(var\(--[\w-]+\)\)$/);
    }
  });
});

describe('basemap configuration', () => {
  it('uses tile URL templates Leaflet can substitute', () => {
    for (const layer of [TERRAIN_LAYER, LABELS_LAYER]) {
      expect(layer.url).toContain('{z}');
      expect(layer.url).toContain('{x}');
      expect(layer.url).toContain('{y}');
    }
  });

  it('supplies subdomains for the layer whose URL needs them', () => {
    // A {s} placeholder with no subdomains configured requests a literal
    // "{s}.basemaps..." host and every tile 404s.
    expect(LABELS_LAYER.url.includes('{s}')).toBe(true);
    expect(LABELS_LAYER.subdomains).toBeTruthy();
    expect(TERRAIN_LAYER.url.includes('{s}')).toBe(false);
  });

  it('attributes both tile sources', () => {
    // Both providers require attribution; shipping without it is a licence
    // problem, not a styling preference.
    expect(TERRAIN_LAYER.attribution.length).toBeGreaterThan(0);
    expect(LABELS_LAYER.attribution).toMatch(/OpenStreetMap/);
    expect(LABELS_LAYER.attribution).toMatch(/CARTO/);
  });

  it('opens on a view that contains the demo region', () => {
    const [lat, lon] = INITIAL_VIEW.center;
    expect(lat).toBeGreaterThan(47.5);
    expect(lat).toBeLessThan(57.5);
    expect(lon).toBeGreaterThan(-132);
    expect(lon).toBeLessThan(-110);
  });

  it('keeps the initial zoom inside its own limits', () => {
    expect(INITIAL_VIEW.zoom).toBeGreaterThanOrEqual(INITIAL_VIEW.minZoom);
    expect(INITIAL_VIEW.zoom).toBeLessThanOrEqual(INITIAL_VIEW.maxZoom);
  });

  it('does not let the map zoom past the tiles that exist', () => {
    expect(INITIAL_VIEW.maxZoom).toBeLessThanOrEqual(TERRAIN_LAYER.maxZoom);
    expect(INITIAL_VIEW.maxZoom).toBeLessThanOrEqual(LABELS_LAYER.maxZoom);
  });

  it('gives tiles long enough to arrive on a slow link, but not forever', () => {
    // Too short and a slow connection is mistaken for a broken one; too long
    // and somebody watches a blank rectangle during a demonstration.
    expect(TILE_TIMEOUT_MS).toBeGreaterThanOrEqual(3000);
    expect(TILE_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });
});
