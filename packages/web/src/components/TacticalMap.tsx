import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AIRPORTS, type AircraftState, type TelemetryReport } from '@oat/shared';
import {
  INITIAL_VIEW,
  LABELS_LAYER,
  TERRAIN_LAYER,
  TILE_TIMEOUT_MS,
  altitudeColor,
} from './basemap.js';

/**
 * The tactical map: real terrain and place names, with the fleet on top.
 *
 * Leaflet rather than a React wrapper library. The wrappers exist to make
 * Leaflet feel declarative, and the cost is that you fight them the moment you
 * want imperative control — which is immediately here, because markers update
 * every two seconds and recreating a hundred of them each poll is exactly the
 * thing that makes a live map stutter. Instead each aircraft gets one marker
 * that is created once and then MOVED, and the DOM node is mutated in place for
 * rotation and colour.
 *
 * Falls back to the offline scope when tiles do not arrive — see basemap.ts for
 * why that matters and ADR-0011 for the decision.
 */

export interface TacticalMapProps {
  aircraft: AircraftState[];
  alerting?: Set<string>;
  selectedId?: string | null;
  onSelect?: (aircraftId: string) => void;
  trail?: TelemetryReport[];
  /** Called once if the basemap cannot load, so the caller can fall back. */
  onTilesUnavailable?: () => void;
}

/** The aircraft glyph, as markup for a Leaflet divIcon. */
function glyphHtml(colour: string, heading: number, state: string): string {
  return `<span class="tm-glyph ${state}" style="--glyph:${colour};transform:rotate(${heading}deg)">
    <svg viewBox="-2 -2 4 4" aria-hidden="true"><polygon points="0,-1.35 0.92,1.05 0,0.5 -0.92,1.05"/></svg>
  </span>`;
}

export function TacticalMap({
  aircraft,
  alerting = new Set(),
  selectedId = null,
  onSelect,
  trail = [],
  onTilesUnavailable,
}: TacticalMapProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const trailRef = useRef<L.Polyline | null>(null);
  const [hovered, setHovered] = useState<AircraftState | null>(null);

  // Handlers change on every render; markers are created once. Reading them
  // through a ref keeps the marker callbacks current without rebinding.
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // ── create the map once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;

    const map = L.map(hostRef.current, {
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      minZoom: INITIAL_VIEW.minZoom,
      maxZoom: INITIAL_VIEW.maxZoom,
      zoomControl: true,
      attributionControl: true,
      // The fleet is the subject; the basemap is context. Scroll-zoom stays on
      // but the map never steals a page scroll it was not given.
      scrollWheelZoom: true,
    });
    mapRef.current = map;

    const terrain = L.tileLayer(TERRAIN_LAYER.url, {
      attribution: TERRAIN_LAYER.attribution,
      maxZoom: TERRAIN_LAYER.maxZoom,
    }).addTo(map);

    L.tileLayer(LABELS_LAYER.url, {
      attribution: LABELS_LAYER.attribution,
      maxZoom: LABELS_LAYER.maxZoom,
      subdomains: LABELS_LAYER.subdomains ?? 'abc',
      opacity: LABELS_LAYER.opacity ?? 1,
    }).addTo(map);

    // Reference airports, drawn as the same ringed dot the scope uses.
    for (const airport of AIRPORTS) {
      L.marker([airport.latitude, airport.longitude], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'tm-airport-icon',
          html: `<span class="tm-airport${airport.major ? ' tm-airport--major' : ''}"><i></i><b>${airport.iata}</b></span>`,
          iconSize: [0, 0],
        }),
      }).addTo(map);
    }

    /*
     * Tile availability.
     *
     * `tileerror` fires per failed tile, but a blocked CDN often produces no
     * event at all — the requests simply hang. So success is what is watched
     * for: if no tile has loaded by the timeout, the basemap is declared
     * unavailable and the caller falls back to the offline scope.
     */
    let loaded = false;
    terrain.on('tileload', () => {
      loaded = true;
    });
    const timer = setTimeout(() => {
      if (!loaded) onTilesUnavailable?.();
    }, TILE_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // Created once. onTilesUnavailable is read at timeout time, and re-running
    // this effect would tear down and rebuild the whole map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── sync markers to the fleet ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();

    for (const ac of aircraft) {
      const latest = ac.latest;
      if (!latest) continue;
      seen.add(ac.aircraft_id);

      const position: L.LatLngExpression = [latest.position.latitude, latest.position.longitude];
      const state = [
        ac.aircraft_id === selectedId ? 'is-selected' : '',
        alerting.has(ac.aircraft_id) ? 'is-alerting' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const colour = alerting.has(ac.aircraft_id)
        ? 'rgb(var(--red))'
        : ac.aircraft_id === selectedId
          ? 'rgb(var(--orange))'
          : altitudeColor(latest.altitude_ft);

      const existing = markers.get(ac.aircraft_id);
      if (existing) {
        // Move and repaint rather than recreate — recreating every marker on
        // every poll is what makes a live map stutter.
        existing.setLatLng(position);
        const node = existing.getElement()?.querySelector('.tm-glyph') as HTMLElement | null;
        if (node) {
          node.style.setProperty('--glyph', colour);
          node.style.transform = `rotate(${latest.heading_deg}deg)`;
          node.className = `tm-glyph ${state}`;
        }
        continue;
      }

      const marker = L.marker(position, {
        icon: L.divIcon({
          className: 'tm-aircraft-icon',
          html: glyphHtml(colour, latest.heading_deg, state),
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        keyboard: true,
        title: `${ac.callsign ?? ac.aircraft_id}`,
        alt: `${ac.callsign ?? ac.aircraft_id}, ${Math.round(latest.altitude_ft)} feet`,
      }).addTo(map);

      marker.on('click', () => selectRef.current?.(ac.aircraft_id));
      marker.on('mouseover', () => setHovered(ac));
      marker.on('mouseout', () => setHovered(null));
      markers.set(ac.aircraft_id, marker);
    }

    // Remove markers for aircraft that are no longer in the fleet.
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }, [aircraft, selectedId, alerting]);

  // ── the selected aircraft's track ────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    trailRef.current?.remove();
    trailRef.current = null;
    if (trail.length < 2) return;

    trailRef.current = L.polyline(
      trail.map((t) => [t.position.latitude, t.position.longitude] as L.LatLngExpression),
      { className: 'tm-trail', interactive: false },
    ).addTo(map);
  }, [trail]);

  const card = hovered ?? aircraft.find((a) => a.aircraft_id === selectedId) ?? null;

  return (
    <div className="tm">
      <div ref={hostRef} className="tm-canvas" role="application" aria-label="Tactical map" />

      {/*
        The hover card. Rendered in React rather than as a Leaflet popup so it
        is styled by the same stylesheet as everything else, and so it can show
        the selected aircraft when nothing is hovered — which keeps the panel
        from flickering empty as the pointer crosses between targets.
      */}
      {card?.latest ? (
        <div className="tm-card" role="status" aria-live="polite">
          <div className="tm-card__kicker">
            {hovered ? 'Contact' : 'Selected'} · {card.operator ?? 'unknown operator'}
          </div>
          <div className="tm-card__title">{card.callsign ?? card.aircraft_id}</div>
          <div className="tm-card__sub">
            {card.registration ?? card.aircraft_id} · {card.type_icao ?? '—'}
          </div>
          <dl className="tm-card__grid">
            <dt>Altitude</dt>
            <dd>{Math.round(card.latest.altitude_ft).toLocaleString('en-CA')} ft</dd>
            <dt>Speed</dt>
            <dd>{Math.round(card.latest.groundspeed_kts)} kt</dd>
            <dt>Track</dt>
            <dd>{Math.round(card.latest.heading_deg)}°</dd>
            <dt>Vertical</dt>
            <dd>{Math.round(card.latest.vertical_rate_fpm)} fpm</dd>
            <dt>Phase</dt>
            <dd>{card.flight_phase}</dd>
            <dt>Source</dt>
            <dd>{card.latest.source}</dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
