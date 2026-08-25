/**
 * Basemap configuration for the tactical map.
 *
 * THE TRADE-OFF, STATED PLAINLY
 * -----------------------------
 * The plan-view scope draws no tiles on purpose: it renders identically offline
 * and cannot fail during a demonstration. This map is the opposite bargain — a
 * real basemap with terrain and place names, at the cost of depending on two
 * third-party CDNs being reachable.
 *
 * Both bargains are worth taking, so the application takes both: the map is the
 * default view because it is the better picture, and it falls back to the scope
 * automatically when tiles do not load. A demo that quietly degrades beats one
 * that shows a grey void — and it means the tile dependency is never on the
 * critical path for showing the system working. See ADR-0011.
 *
 * Tile sources are the same ones parker.brownfamilysports.com/map uses, so the
 * two surfaces look like they belong to each other.
 */

export interface BasemapLayer {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /** Drawn beneath the labels layer when present. */
  subdomains?: string;
  opacity?: number;
}

/**
 * Hillshade underneath, dark street/label raster on top.
 *
 * Two layers rather than one because the CARTO dark basemap is flat — the
 * hillshade is what makes the Coast Mountains and the Rockies legible, which
 * matters when the whole point is that these aircraft are flying over terrain.
 */
export const TERRAIN_LAYER: BasemapLayer = {
  id: 'hillshade',
  label: 'Hillshade',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Hillshade &copy; Esri',
  maxZoom: 16,
};

export const LABELS_LAYER: BasemapLayer = {
  id: 'dark',
  label: 'Dark',
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 19,
  // Held back so the olive HUD overlay stays the brightest thing on screen.
  opacity: 0.85,
};

/** Initial view: the whole demo region, centred between Kelowna and Calgary. */
export const INITIAL_VIEW = {
  center: [51.4, -120.5] as [number, number],
  zoom: 5,
  minZoom: 3,
  maxZoom: 11,
};

/**
 * How long to wait for a tile before declaring the basemap unavailable.
 *
 * Long enough that a slow connection is not mistaken for a broken one, short
 * enough that nobody watches a blank rectangle wondering whether to reload.
 */
export const TILE_TIMEOUT_MS = 6000;

/**
 * Altitude bands for target colour.
 *
 * Colouring by altitude is what makes a busy display readable at a glance —
 * you can see the stack of arrivals below the overflights without reading a
 * single number. The bands are the conventional ones from open ADS-B displays,
 * mapped onto the tactical palette rather than the usual rainbow.
 */
export interface AltitudeBand {
  /** Lower bound in feet, inclusive. */
  from: number;
  label: string;
  /** CSS colour, as a var() reference so the theme stays the single source. */
  color: string;
}

export const ALTITUDE_BANDS: AltitudeBand[] = [
  { from: 30000, label: '30,000 ft +', color: 'rgb(var(--olive-pale))' },
  { from: 20000, label: '20–30,000 ft', color: 'rgb(var(--olive-bright))' },
  { from: 10000, label: '10–20,000 ft', color: 'rgb(var(--olive))' },
  { from: 5000, label: '5–10,000 ft', color: 'rgb(var(--amber))' },
  { from: 0, label: 'below 5,000 ft', color: 'rgb(var(--orange))' },
];

export function altitudeColor(altitudeFt: number | null | undefined): string {
  if (altitudeFt === null || altitudeFt === undefined || Number.isNaN(altitudeFt)) {
    return 'rgb(var(--fg-faint))';
  }
  // Bands are ordered high to low, so the first match is the right one.
  const band = ALTITUDE_BANDS.find((b) => altitudeFt >= b.from);
  return band?.color ?? 'rgb(var(--fg-faint))';
}
