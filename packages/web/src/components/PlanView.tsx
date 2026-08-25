import {
  AIRPORTS,
  REGION,
  airportByIata,
  destinationPoint,
  projectToUnitSquare,
  type AircraftState,
  type LatLon,
  type TelemetryReport,
} from '@oat/shared';
import { placeDataBlocks, tiePoint } from './dataBlocks.js';

/**
 * A plan-view scope over the demo region.
 *
 * Deliberately not a slippy map. A tile provider is a third-party runtime
 * dependency, an API key to manage and a network request that can fail during a
 * demonstration — for a fixed region where the only thing that moves is the
 * aircraft. An equirectangular projection into an SVG viewBox needs none of
 * that, renders identically offline, and reads like the instrument it is
 * imitating.
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

/** The scope datum. Kelowna, because that is where the fleet is based. */
const DATUM = airportByIata('YLW') ?? AIRPORTS[0]!;

/** Range ring radii, nautical miles. */
const RANGE_RINGS_NM = [100, 200, 300];

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

function project(p: LatLon): { x: number; y: number } {
  const unit = projectToUnitSquare(p, REGION);
  return { x: unit.x * W, y: unit.y * H };
}

/** Distance in viewBox units from the datum to a point `nm` away, per axis. */
function ringRadii(nm: number): { rx: number; ry: number } {
  const centre = project(DATUM);
  const east = project(destinationPoint(DATUM, 90, nm));
  const north = project(destinationPoint(DATUM, 0, nm));
  return { rx: Math.abs(east.x - centre.x), ry: Math.abs(north.y - centre.y) };
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
}

export function PlanView({
  aircraft,
  alerting = new Set(),
  selectedId = null,
  onSelect,
  trail = [],
  showLegend = true,
}: PlanViewProps): React.JSX.Element {
  const centre = project(DATUM);

  // Whole-degree graticule across the region.
  const meridians: number[] = [];
  for (let lon = Math.ceil(REGION.west / 4) * 4; lon <= REGION.east; lon += 4) meridians.push(lon);
  const parallels: number[] = [];
  for (let lat = Math.ceil(REGION.south / 2) * 2; lat <= REGION.north; lat += 2)
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
        aria-label={`Plan view of ${aircraft.length} aircraft over British Columbia and Alberta, centred on ${DATUM.name}`}
      >
        {/* ── graticule ─────────────────────────────────────────────────── */}
        <g className="pv-graticule">
          {meridians.map((lon) => {
            const a = project({ latitude: REGION.north, longitude: lon });
            const b = project({ latitude: REGION.south, longitude: lon });
            return <line key={`m${lon}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {parallels.map((lat) => {
            const a = project({ latitude: lat, longitude: REGION.west });
            const b = project({ latitude: lat, longitude: REGION.east });
            return <line key={`p${lat}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </g>

        <g>
          {parallels.map((lat) => {
            const p = project({ latitude: lat, longitude: REGION.west });
            return (
              <text key={`pl${lat}`} className="pv-graticule-label" x={0.6} y={p.y - 0.4}>
                {Math.abs(lat)}
                {lat >= 0 ? 'N' : 'S'}
              </text>
            );
          })}
          {meridians.map((lon) => {
            const p = project({ latitude: REGION.south, longitude: lon });
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
            const { rx, ry } = ringRadii(nm);
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
            const { rx, ry } = ringRadii(RANGE_RINGS_NM[0] ?? 100);
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
            const { rx, ry } = ringRadii(RANGE_RINGS_NM[0] ?? 100);
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
          {AIRPORTS.map((airport) => {
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

            const block = blocks.get(ac.aircraft_id) ?? null;

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

                {/* A triangle rotated to the reported track: the glyph shows
                    direction of travel, which a dot cannot. */}
                <polygon
                  className={`pv-aircraft${suffix}`}
                  points="0,-1.15 0.78,0.9 0,0.45 -0.78,0.9"
                  transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${latest.heading_deg.toFixed(0)})`}
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
                </polygon>
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
            rings = {RANGE_RINGS_NM.join(' / ')} nm from {DATUM.iata}
          </span>
          <span>block = callsign / alt×100ft / gs×10kt</span>
        </div>
      ) : null}
    </div>
  );
}
