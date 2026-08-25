import { useEffect, useState } from 'react';
import type { AircraftState, TelemetryReport } from '@oat/shared';
import { PlanView } from './PlanView.js';
import { TacticalMap } from './TacticalMap.js';
import { ALTITUDE_BANDS } from './basemap.js';

/**
 * The fleet display, in either of its two forms.
 *
 *   map   — real terrain and place names, from third-party tiles. The better
 *           picture, and the default.
 *   scope — the self-contained plan view. No network, no tiles, renders
 *           identically offline.
 *
 * The switch is manual, but the fallback is not: if the basemap does not load
 * within a few seconds the view drops to the scope on its own and says why. A
 * demonstration should never depend on a CDN being reachable, and this is how
 * both the good picture and that guarantee are kept at once. See ADR-0011.
 */

export type FleetViewMode = 'map' | 'scope';

export interface FleetViewProps {
  aircraft: AircraftState[];
  alerting?: Set<string>;
  selectedId?: string | null;
  onSelect?: (aircraftId: string) => void;
  trail?: TelemetryReport[];
  /** Starting mode. Defaults to the map. */
  initialMode?: FleetViewMode;
}

export function FleetView({
  aircraft,
  alerting,
  selectedId,
  onSelect,
  trail,
  initialMode = 'map',
}: FleetViewProps): React.JSX.Element {
  const [mode, setMode] = useState<FleetViewMode>(initialMode);
  const [tilesFailed, setTilesFailed] = useState(false);

  // Once tiles are known to be unreachable, stop offering the map: choosing it
  // again would just show the same empty rectangle.
  useEffect(() => {
    if (tilesFailed && mode === 'map') setMode('scope');
  }, [tilesFailed, mode]);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', padding: '8px 12px 0' }}>
        <div className="view-switch" role="group" aria-label="Fleet display mode">
          <button
            type="button"
            aria-pressed={mode === 'map'}
            disabled={tilesFailed}
            onClick={() => setMode('map')}
            title={tilesFailed ? 'Basemap tiles are unreachable' : 'Terrain basemap'}
          >
            Map
          </button>
          <button
            type="button"
            aria-pressed={mode === 'scope'}
            onClick={() => setMode('scope')}
            title="Self-contained plan view — no tiles"
          >
            Scope
          </button>
        </div>
        {tilesFailed ? (
          <span className="faint" style={{ fontSize: 10.5, letterSpacing: '0.1em' }}>
            basemap unreachable — showing the offline scope
          </span>
        ) : null}
      </div>

      {mode === 'map' ? (
        <>
          <TacticalMap
            aircraft={aircraft}
            {...(alerting ? { alerting } : {})}
            selectedId={selectedId ?? null}
            {...(onSelect ? { onSelect } : {})}
            {...(trail ? { trail } : {})}
            onTilesUnavailable={() => setTilesFailed(true)}
          />
          <div className="alt-legend">
            <span className="kicker" style={{ letterSpacing: '0.2em' }}>
              Altitude
            </span>
            {ALTITUDE_BANDS.map((band) => (
              <span key={band.label}>
                <i style={{ background: band.color }} /> {band.label}
              </span>
            ))}
            <span>
              <i style={{ background: 'rgb(var(--red))' }} /> alerting
            </span>
          </div>
        </>
      ) : (
        <PlanView
          aircraft={aircraft}
          {...(alerting ? { alerting } : {})}
          selectedId={selectedId ?? null}
          {...(onSelect ? { onSelect } : {})}
          {...(trail ? { trail } : {})}
        />
      )}
    </div>
  );
}
