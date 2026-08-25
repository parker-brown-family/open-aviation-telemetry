import { useMemo, useState } from 'react';
import type { AircraftState } from '@oat/shared';

/**
 * Filtering and sorting for the fleet table.
 *
 * Kept out of the component because it is the part with rules worth testing:
 * which fields a query matches, how missing values sort, and that the ordering
 * is stable. A React component is an awkward place to assert any of that.
 */

export type SortKey =
  | 'callsign'
  | 'registration'
  | 'type_icao'
  | 'status'
  | 'flight_phase'
  | 'altitude_ft'
  | 'groundspeed_kts'
  | 'last_seen';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

/** The value a given column sorts on. Null means "no value". */
function sortValue(a: AircraftState, key: SortKey): string | number | null {
  switch (key) {
    case 'callsign':
      return a.callsign;
    case 'registration':
      return a.registration ?? a.aircraft_id;
    case 'type_icao':
      return a.type_icao;
    case 'status':
      return a.status;
    case 'flight_phase':
      return a.flight_phase;
    case 'altitude_ft':
      return a.latest?.altitude_ft ?? null;
    case 'groundspeed_kts':
      return a.latest?.groundspeed_kts ?? null;
    case 'last_seen':
      return Date.parse(a.last_seen);
  }
}

/**
 * Does this aircraft match the query?
 *
 * Matches across every identifier an operator might type, because they will
 * type whichever one they happen to have — the callsign from the radio, the
 * registration from the paperwork, or the operator from the schedule.
 */
export function matches(a: AircraftState, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [a.callsign, a.registration, a.aircraft_id, a.type_icao, a.operator, a.flight_phase]
    .filter((v): v is string => typeof v === 'string')
    .some((v) => v.toLowerCase().includes(q));
}

/**
 * Sorts a copy, never the input.
 *
 * Missing values always sort last regardless of direction. An aircraft that has
 * not reported an altitude is not "the lowest aircraft" — it is an aircraft
 * with no altitude, and floating it to the top of an ascending sort would be
 * actively misleading.
 */
export function sortAircraft(list: readonly AircraftState[], sort: SortState): AircraftState[] {
  const factor = sort.direction === 'asc' ? 1 : -1;

  return [...list].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);

    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;

    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * factor;
    }
    const cmp = String(av).localeCompare(String(bv));
    // Tie-break on the stable identifier so equal rows do not reshuffle on
    // every poll — a table that jitters while you are trying to click a row is
    // the single most annoying thing a live view can do.
    return cmp !== 0 ? cmp * factor : a.aircraft_id.localeCompare(b.aircraft_id);
  });
}

export interface FleetTable {
  rows: AircraftState[];
  query: string;
  setQuery: (q: string) => void;
  sort: SortState;
  /** Click a column: same column flips direction, a new column starts descending. */
  toggleSort: (key: SortKey) => void;
  /** Class names for a column header, so the component does not build them. */
  headerClass: (key: SortKey) => string;
}

export function useFleetTable(
  aircraft: readonly AircraftState[],
  initial: SortState = { key: 'last_seen', direction: 'desc' },
): FleetTable {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(initial);

  const rows = useMemo(
    () =>
      sortAircraft(
        aircraft.filter((a) => matches(a, query)),
        sort,
      ),
    [aircraft, query, sort],
  );

  const toggleSort = (key: SortKey): void =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : // A new column starts descending: for altitude, speed and recency the
          // interesting end is the top, and starting ascending means every user
          // clicks twice.
          { key, direction: 'desc' },
    );

  const headerClass = (key: SortKey): string => {
    if (sort.key !== key) return 'sortable';
    return `sortable ${sort.direction === 'asc' ? 'sorted-asc' : 'sorted'}`;
  };

  return { rows, query, setQuery, sort, toggleSort, headerClass };
}
