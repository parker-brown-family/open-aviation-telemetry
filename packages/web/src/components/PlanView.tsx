import {
  AIRPORTS,
  REGION,
  projectToUnitSquare,
  type AircraftState,
  type TelemetryReport,
} from '@oat/shared';

/**
 * A plan-view scope over the demo region.
 *
 * Deliberately not a slippy map. A tile provider would be a third-party runtime
 * dependency, an API key to manage, and a network request that can fail during a
 * demonstration — for a fixed region where the only thing that moves is the
 * aircraft. An equirectangular projection into an SVG viewBox needs none of
 * that, renders identically offline, and reads like the instrument it is
 * imitating.
 */

const W = 100;
const H = 62;

function project(p: { latitude: number; longitude: number }): { x: number; y: number } {
  const unit = projectToUnitSquare(p, REGION);
  return { x: unit.x * W, y: unit.y * H };
}

export interface PlanViewProps {
  aircraft: AircraftState[];
  /** Aircraft ids with an unacknowledged alert, drawn in red. */
  alerting?: Set<string>;
  selectedId?: string | null;
  onSelect?: (aircraftId: string) => void;
  /** Optional trail for the selected aircraft, oldest last. */
  trail?: TelemetryReport[];
}

export function PlanView({
  aircraft,
  alerting = new Set(),
  selectedId = null,
  onSelect,
  trail = [],
}: PlanViewProps): React.JSX.Element {
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

  return (
    <div className="planview">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Plan view of ${aircraft.length} aircraft over British Columbia and Alberta`}
      >
        <g className="planview__graticule">
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
          {AIRPORTS.map((airport) => {
            const p = project(airport);
            return (
              <g key={airport.iata}>
                <circle
                  className="planview__airport"
                  cx={p.x}
                  cy={p.y}
                  r={airport.major ? 0.5 : 0.32}
                />
                <text className="planview__airport-label" x={p.x + 0.9} y={p.y + 0.5}>
                  {airport.iata}
                </text>
              </g>
            );
          })}
        </g>

        {trailPath ? <path className="planview__trail" d={trailPath} /> : null}

        <g>
          {aircraft.map((ac) => {
            if (!ac.latest) return null;
            const p = project(ac.latest.position);
            const isSelected = ac.aircraft_id === selectedId;
            const isAlerting = alerting.has(ac.aircraft_id);
            const classes = [
              'planview__aircraft',
              isAlerting ? 'planview__aircraft--alert' : '',
              isSelected ? 'planview__aircraft--selected' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <g key={ac.aircraft_id}>
                {/* A triangle rotated to the reported heading: the glyph shows
                    direction of travel, which a dot cannot. */}
                <polygon
                  className={classes}
                  points="0,-1.05 0.72,0.85 0,0.42 -0.72,0.85"
                  transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${ac.latest.heading_deg.toFixed(0)})`}
                  onClick={() => onSelect?.(ac.aircraft_id)}
                >
                  <title>
                    {ac.callsign ?? ac.aircraft_id} — {Math.round(ac.latest.altitude_ft)} ft,{' '}
                    {Math.round(ac.latest.groundspeed_kts)} kts
                  </title>
                </polygon>
                {isSelected ? (
                  <text className="planview__callsign" x={p.x + 1.2} y={p.y - 0.9}>
                    {ac.callsign ?? ac.aircraft_id}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
