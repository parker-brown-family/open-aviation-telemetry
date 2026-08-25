import {
  AIRPORTS,
  DEFAULT_DATUM,
  destinationPoint,
  projectToUnitSquare,
  regionAround,
  type Airport,
  type AircraftState,
  type BoundingBox,
  type LatLon,
  type TelemetryReport,
} from '@oat/shared';
import { placeDataBlocks, tiePoint } from './dataBlocks.js';

/**
 * A plan-view scope over the demo region.
 *
 * One of two fleet displays. This is the SCOPE: no tiles, no network, no
 * third-party anything. An equirectangular projection into an SVG viewBox over a
 * fixed region, which renders identically offline and reads like the instrument
 * it is imitating.
 *
 * The other is TacticalMap, which puts the same fleet over a real terrain
 * basemap. That is the better picture and it is the default; this is what the
 * application falls back to when the tiles do not load, so a demonstration never
 * depends on a CDN being reachable. See ADR-0011.
 *
 * What makes it readable rather than just a scatter of dots is borrowed from
 * air-traffic displays:
 *
 *   * a VELOCITY LEADER — a line from the target showing where it will be in
 *     one minute at its current groundspeed and track. Length encodes speed, so
 *     a fast aircraft is visibly fast without reading a number.
 *   * a DATA BLOCK — callsign, altitude and groundspeed in a small box tied to
 *     the target by a thin line. This is why a controller can read a screen
 *     full of traffic without hovering anything.
 *   * RANGE RINGS from a datum, so distance is judged rather than guessed.
 *
 * Data blocks are shown selectively — see BLOCK_ALL_BELOW. A hundred blocks on
 * one screen is worse than none.
 */

const W = 100;
const H = 62;

/** Range ring radii, nautical miles. */
const RANGE_RINGS_NM = [100, 200, 300];

/**
 * Half the window height, in nautical miles.
 *
 * Equal to the outermost range ring, so that ring touches the top and bottom
 * edges: the scope shows exactly the area it draws a scale for, whichever field
 * it is centred on.
 */
const HALF_HEIGHT_NM = RANGE_RINGS_NM[RANGE_RINGS_NM.length - 1]!;

/**
 * Show a data block for every aircraft while the fleet is small enough that the
 * blocks do not collide. Above this, only the selected and alerting targets get
 * one — the same density decision a real display makes.
 */
const BLOCK_ALL_BELOW = 14;

/** Minutes of travel represented by the velocity leader. */
const LEADER_MINUTES = 1;

/** Data-block box size, in viewBox units. */
const BLOCK_W = 9.6;
const BLOCK_H = 4.4;

function projectInto(p: LatLon, region: BoundingBox): { x: number; y: number } {
  const unit = projectToUnitSquare(p, region);
  return { x: unit.x * W, y: unit.y * H };
}

/** Distance in viewBox units from the datum to a point `nm` away, per axis. */
function ringRadii(nm: number, datum: LatLon, region: BoundingBox): { rx: number; ry: number } {
  const centre = projectInto(datum, region);
  const east = projectInto(destinationPoint(datum, 90, nm), region);
  const north = projectInto(destinationPoint(datum, 0, nm), region);
  return { rx: Math.abs(east.x - centre.x), ry: Math.abs(north.y - centre.y) };
}

/** Is this point inside the drawn window? Used to skip off-scope furniture. */
function withinRegion(p: LatLon, region: BoundingBox): boolean {
  return (
    p.latitude <= region.north &&
    p.latitude >= region.south &&
    p.longitude >= region.west &&
    p.longitude <= region.east
  );
}

export interface PlanViewProps {
  aircraft: AircraftState[];
  /** Aircraft ids with an unacknowledged alert, drawn in red. */
  alerting?: Set<string>;
  selectedId?: string | null;
  onSelect?: (aircraftId: string) => void;
  /** Optional trail for the selected aircraft, newest first. */
  trail?: TelemetryReport[];
  /** Hide the legend when the surrounding panel already explains the view. */
  showLegend?: boolean;
  /** The field the scope is centred on. The window follows it. */
  datum?: Airport;
}

export function PlanView({
  aircraft,
  alerting = new Set(),
  selectedId = null,
  onSelect,
  trail = [],
  showLegend = true,
  datum = DEFAULT_DATUM,
}: PlanViewProps): React.JSX.Element {
  // The window is derived from the datum rather than fixed, so choosing a
  // different field re-centres the picture instead of only moving the rings.
  const region = regionAround(datum, HALF_HEIGHT_NM, W / H);
  const project = (p: LatLon): { x: number; y: number } => projectInto(p, region);
  const centre = project(datum);

  // Graticule across the window. The interval adapts because a window centred
  // further north spans more longitude for the same distance, and a fixed 4°
  // step would crowd the display.
  const lonStep = region.east - region.west > 30 ? 8 : 4;
  const meridians: number[] = [];
  for (let lon = Math.ceil(region.west / lonStep) * lonStep; lon <= region.east; lon += lonStep)
    meridians.push(lon);
  const parallels: number[] = [];
  for (let lat = Math.ceil(region.south / 2) * 2; lat <= region.north; lat += 2)
    parallels.push(lat);

  const trailPath =
    trail.length > 1
      ? trail
          .map((t, i) => {
            const p = project(t.position);
            return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
          })
          .join(' ')
      : null;

  const showAllBlocks = aircraft.length <= BLOCK_ALL_BELOW;

  /*
   * Lay the data blocks out before drawing anything.
   *
   * Order is the priority order: the selected target gets its preferred
   * position, then alerting targets, then everyone else — so when the display
   * is crowded, the blocks that get pushed aside are the ones that matter
   * least. Without this the blocks are placed in fleet order and the one you
   * are actually looking at ends up underneath somebody else's.
   */
  const blockTargets = aircraft
    .filter((ac) => ac.latest !== null)
    .filter((ac) => showAllBlocks || ac.aircraft_id === selectedId || alerting.has(ac.aircraft_id))
    .sort((a, b) => {
      const rank = (ac: AircraftState): number =>
        ac.aircraft_id === selectedId ? 0 : alerting.has(ac.aircraft_id) ? 1 : 2;
      return rank(a) - rank(b);
    })
    .map((ac) => {
      const p = project(ac.latest!.position);
      return { id: ac.aircraft_id, x: p.x, y: p.y };
    });

  const blocks = new Map(
    placeDataBlocks(blockTargets, {
      blockWidth: BLOCK_W,
      blockHeight: BLOCK_H,
      width: W,
      height: H,
    }).map((placement) => [placement.id, placement]),
  );

  return (
    <div className="planview">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Plan view of ${aircraft.length} aircraft, centred on ${datum.name} with range rings at ${RANGE_RINGS_NM.join(', ')} nautical miles`}
      >
        {/* ── graticule ─────────────────────────────────────────────────── */}
        <g className="pv-graticule">
          {meridians.map((lon) => {
            const a = project({ latitude: region.north, longitude: lon });
            const b = project({ latitude: region.south, longitude: lon });
            return <line key={`m${lon}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {parallels.map((lat) => {
            const a = project({ latitude: lat, longitude: region.west });
            const b = project({ latitude: lat, longitude: region.east });
            return <line key={`p${lat}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </g>

        <g>
          {parallels.map((lat) => {
            const p = project({ latitude: lat, longitude: region.west });
            return (
              <text key={`pl${lat}`} className="pv-graticule-label" x={0.6} y={p.y - 0.4}>
                {Math.abs(lat)}
                {lat >= 0 ? 'N' : 'S'}
              </text>
            );
          })}
          {meridians.map((lon) => {
            const p = project({ latitude: region.south, longitude: lon });
            return (
              <text key={`ml${lon}`} className="pv-graticule-label" x={p.x + 0.4} y={H - 0.6}>
                {Math.abs(lon)}
                {lon >= 0 ? 'E' : 'W'}
              </text>
            );
          })}
        </g>

        {/* ── range rings from the datum ────────────────────────────────── */}
        <g>
          {RANGE_RINGS_NM.map((nm) => {
            const { rx, ry } = ringRadii(nm, datum, region);
            return (
              <g key={`r${nm}`}>
                <ellipse className="pv-range-ring" cx={centre.x} cy={centre.y} rx={rx} ry={ry} />
                <text className="pv-range-label" x={centre.x + 0.5} y={centre.y - ry + 1.4}>
                  {nm}
                </text>
              </g>
            );
          })}
        </g>

        {/* ── compass rose at the datum ─────────────────────────────────── */}
        <g>
          {Array.from({ length: 36 }, (_, i) => i * 10).map((brg) => {
            const cardinal = brg % 90 === 0;
            const { rx, ry } = ringRadii(RANGE_RINGS_NM[0] ?? 100, datum, region);
            const r = Math.min(rx, ry);
            const rad = ((brg - 90) * Math.PI) / 180;
            const inner = cardinal ? r - 1.6 : r - 0.8;
            return (
              <line
                key={`t${brg}`}
                className={`pv-tick${cardinal ? ' pv-tick--cardinal' : ''}`}
                x1={centre.x + Math.cos(rad) * inner}
                y1={centre.y + Math.sin(rad) * inner}
                x2={centre.x + Math.cos(rad) * r}
                y2={centre.y + Math.sin(rad) * r}
              />
            );
          })}
          {(
            [
              ['N', 0],
              ['E', 90],
              ['S', 180],
              ['W', 270],
            ] as const
          ).map(([label, brg]) => {
            const { rx, ry } = ringRadii(RANGE_RINGS_NM[0] ?? 100, datum, region);
            const r = Math.min(rx, ry) + 1.8;
            const rad = ((brg - 90) * Math.PI) / 180;
            return (
              <text
                key={label}
                className="pv-compass-label"
                x={centre.x + Math.cos(rad) * r}
                y={centre.y + Math.sin(rad) * r + 0.5}
                textAnchor="middle"
              >
                {label}
              </text>
            );
          })}
        </g>

        {/* ── airports ──────────────────────────────────────────────────── */}
        <g>
          {/*
            Only the fields inside the window. Without this, projecting an
            airport outside the region yields coordinates beyond the viewBox and
            its label is clipped mid-glyph at the edge — which reads as a
            rendering fault rather than as somewhere off-scope.
          */}
          {AIRPORTS.filter((airport) => withinRegion(airport, region)).map((airport) => {
            const p = project(airport);
            return (
              <g key={airport.iata} className={airport.major ? '' : 'pv-airport--minor'}>
                {/* Ringed dot: the aeronautical-chart convention for an airport. */}
                <circle
                  className="pv-airport-ring"
                  cx={p.x}
                  cy={p.y}
                  r={airport.major ? 0.85 : 0.6}
                />
                <circle
                  className="pv-airport-dot"
                  cx={p.x}
                  cy={p.y}
                  r={airport.major ? 0.3 : 0.22}
                />
                <text className="pv-airport-label" x={p.x + 1.2} y={p.y + 0.5}>
                  {airport.iata}
                </text>
              </g>
            );
          })}
        </g>

        {/* ── selected aircraft's track history ─────────────────────────── */}
        {trailPath ? <path className="pv-trail" d={trailPath} /> : null}

        {/* ── targets ───────────────────────────────────────────────────── */}
        <g>
          {aircraft.map((ac) => {
            const latest = ac.latest;
            if (!latest) return null;

            const p = project(latest.position);
            const isSelected = ac.aircraft_id === selectedId;
            const isAlerting = alerting.has(ac.aircraft_id);
            const state = isSelected ? 'selected' : isAlerting ? 'alert' : '';
            const suffix = state ? ` pv-aircraft--${state}` : '';

            // Velocity leader: where this aircraft will be in LEADER_MINUTES at
            // its current groundspeed and track. Computed with the shared
            // geodesy so it curves correctly rather than being a flat offset.
            const aheadNm = (latest.groundspeed_kts / 60) * LEADER_MINUTES;
            const ahead =
              aheadNm > 0.1
                ? project(destinationPoint(latest.position, latest.heading_deg, aheadNm))
                : null;

            /*
             * Drop a block the placer could not fit.
             *
             * `crowded` means every candidate offset collided and it returned
             * an overlapping rectangle anyway. Two labels printed on top of
             * each other are not half-readable, they are unreadable — and the
             * one underneath is invisible rather than obviously missing.
             *
             * This matters more since the scope became re-centrable: a fleet
             * that spreads comfortably over a window centred on its own base
             * bunches into one corner when the datum moves, and BLOCK_ALL_BELOW
             * cannot see that because it counts aircraft rather than measuring
             * density. The selected and alerting targets keep their block
             * regardless — those are the two you are looking for.
             */
            const placement = blocks.get(ac.aircraft_id) ?? null;
            const block =
              placement && placement.crowded && !isSelected && !alerting.has(ac.aircraft_id)
                ? null
                : placement;

            return (
              <g key={ac.aircraft_id}>
                {ahead ? (
                  <line
                    className={`pv-leader${state ? ` pv-leader--${state}` : ''}`}
                    x1={p.x}
                    y1={p.y}
                    x2={ahead.x}
                    y2={ahead.y}
                  />
                ) : null}

                {isSelected ? (
                  <g className="pv-reticle">
                    <circle cx={p.x} cy={p.y} r={2} />
                    <line x1={p.x - 3} y1={p.y} x2={p.x - 2.4} y2={p.y} />
                    <line x1={p.x + 2.4} y1={p.y} x2={p.x + 3} y2={p.y} />
                    <line x1={p.x} y1={p.y - 3} x2={p.x} y2={p.y - 2.4} />
                    <line x1={p.x} y1={p.y + 2.4} x2={p.x} y2={p.y + 3} />
                  </g>
                ) : null}

                {block ? (
                  <g
                    className={`pv-block${state ? ` pv-block--${state}` : ''}`}
                    pointerEvents="none"
                  >
                    <line
                      className="pv-block-tie"
                      x1={p.x}
                      y1={p.y}
                      x2={tiePoint(block.rect, block.anchor).x}
                      y2={tiePoint(block.rect, block.anchor).y}
                    />
                    <rect
                      className="pv-block-bg"
                      x={block.rect.x}
                      y={block.rect.y}
                      width={block.rect.w}
                      height={block.rect.h}
                    />
                    <text className="pv-block-text" x={block.rect.x + 0.5} y={block.rect.y + 1.7}>
                      {(ac.callsign ?? ac.aircraft_id).slice(0, 9)}
                    </text>
                    <text className="pv-block-text" x={block.rect.x + 0.5} y={block.rect.y + 3.5}>
                      {/* Altitude in hundreds of feet and groundspeed in tens of
                          knots — the compact form used on a real data block. */}
                      {String(Math.round(latest.altitude_ft / 100)).padStart(3, '0')}{' '}
                      {String(Math.round(latest.groundspeed_kts / 10)).padStart(2, '0')}
                    </text>
                  </g>
                ) : null}

                {/*
                  An invisible hit target.

                  The glyph itself renders at roughly 14x16 CSS pixels — below
                  the 24px minimum for a pointer target, and it is a concave
                  arrow, so parts of its bounding box are not clickable at all.
                  A transparent disc gives a forgiving target without changing
                  what is drawn. It carries the interaction; the visible glyph
                  is then purely decorative and is hidden from assistive tech.
                */}
                <circle
                  className="pv-hit"
                  cx={p.x}
                  cy={p.y}
                  r={1.7}
                  fill="transparent"
                  onClick={() => onSelect?.(ac.aircraft_id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${ac.callsign ?? ac.aircraft_id}, ${Math.round(latest.altitude_ft)} feet, ${Math.round(latest.groundspeed_kts)} knots`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect?.(ac.aircraft_id);
                    }
                  }}
                >
                  <title>
                    {ac.callsign ?? ac.aircraft_id} — {Math.round(latest.altitude_ft)} ft,{' '}
                    {Math.round(latest.groundspeed_kts)} kt, track {Math.round(latest.heading_deg)}°
                  </title>
                </circle>

                {/* A triangle rotated to the reported track: the glyph shows
                    direction of travel, which a dot cannot. */}
                <polygon
                  className={`pv-aircraft${suffix}`}
                  points="0,-1.15 0.78,0.9 0,0.45 -0.78,0.9"
                  transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${latest.heading_deg.toFixed(0)})`}
                  aria-hidden="true"
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </g>
      </svg>

      {showLegend ? (
        <div className="planview__legend">
          <span>
            <i style={{ background: 'rgb(var(--olive-bright))' }} /> nominal
          </span>
          <span>
            <i style={{ background: 'rgb(var(--red))' }} /> alerting
          </span>
          <span>
            <i style={{ background: 'rgb(var(--orange))' }} /> selected
          </span>
          <span>leader = {LEADER_MINUTES} min of travel</span>
          <span>
            rings = {RANGE_RINGS_NM.join(' / ')} nm from {datum.iata}
          </span>
          <span>block = callsign / alt×100ft / gs×10kt</span>
        </div>
      ) : null}
    </div>
  );
}
