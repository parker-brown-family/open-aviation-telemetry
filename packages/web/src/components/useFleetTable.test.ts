import { describe, expect, it } from 'vitest';
import type { AircraftState } from '@oat/shared';
import { matches, sortAircraft, type SortState } from './useFleetTable.js';

function aircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  const base: AircraftState = {
    aircraft_id: 'C-GABC',
    callsign: 'OKA101',
    registration: 'C-GABC',
    type_icao: 'DH8D',
    operator: 'Okanagan Air',
    status: 'active',
    flight_phase: 'cruise',
    first_seen: '2026-08-25T17:00:00.000Z',
    last_seen: '2026-08-25T18:00:00.000Z',
    latest: {
      aircraft_id: 'C-GABC',
      timestamp: '2026-08-25T18:00:00.000Z',
      position: { latitude: 49.9561, longitude: -119.3777 },
      altitude_ft: 24000,
      groundspeed_kts: 360,
      heading_deg: 90,
      vertical_rate_fpm: 0,
      engine: { temperature_c: 92, rpm: 2200 },
      source: 'simulated',
    },
  };
  return { ...base, ...overrides };
}

describe('matches', () => {
  const a = aircraft();

  it('matches everything on an empty query', () => {
    expect(matches(a, '')).toBe(true);
    expect(matches(a, '   ')).toBe(true);
  });

  it('matches on any identifier an operator might actually type', () => {
    // They will use whichever one is in front of them: the callsign from the
    // radio, the registration from the paperwork, the operator from the roster.
    expect(matches(a, 'OKA')).toBe(true);
    expect(matches(a, 'C-GAB')).toBe(true);
    expect(matches(a, 'DH8D')).toBe(true);
    expect(matches(a, 'Okanagan')).toBe(true);
    expect(matches(a, 'cruise')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matches(a, 'oka101')).toBe(true);
    expect(matches(a, '  dh8d  ')).toBe(true);
  });

  it('does not match an unrelated string', () => {
    expect(matches(a, 'zzz')).toBe(false);
  });

  it('tolerates an aircraft with null identifiers', () => {
    const sparse = aircraft({
      callsign: null,
      registration: null,
      type_icao: null,
      operator: null,
    });
    expect(matches(sparse, 'anything')).toBe(false);
    expect(matches(sparse, 'C-GABC')).toBe(true);
  });
});

describe('sortAircraft', () => {
  const desc = (key: SortState['key']): SortState => ({ key, direction: 'desc' });
  const asc = (key: SortState['key']): SortState => ({ key, direction: 'asc' });

  const fast = aircraft({
    aircraft_id: 'C-GFAST',
    latest: { ...aircraft().latest!, groundspeed_kts: 460, altitude_ft: 34000 },
  });
  const slow = aircraft({
    aircraft_id: 'C-GSLOW',
    latest: { ...aircraft().latest!, groundspeed_kts: 120, altitude_ft: 4000 },
  });
  const noTelemetry = aircraft({ aircraft_id: 'C-GNONE', latest: null });

  it('does not mutate its input', () => {
    const list = [slow, fast];
    const before = list.map((a) => a.aircraft_id);
    sortAircraft(list, desc('groundspeed_kts'));
    expect(list.map((a) => a.aircraft_id)).toEqual(before);
  });

  it('sorts numerically, not lexically', () => {
    // A lexical sort would put 120 above 460.
    const sorted = sortAircraft([slow, fast], desc('groundspeed_kts'));
    expect(sorted.map((a) => a.aircraft_id)).toEqual(['C-GFAST', 'C-GSLOW']);
  });

  it('reverses on direction', () => {
    const sorted = sortAircraft([fast, slow], asc('altitude_ft'));
    expect(sorted.map((a) => a.aircraft_id)).toEqual(['C-GSLOW', 'C-GFAST']);
  });

  it('sorts missing values last in BOTH directions', () => {
    // An aircraft with no altitude is not "the lowest aircraft". Floating it to
    // the top of an ascending sort would be actively misleading.
    const ascending = sortAircraft([noTelemetry, fast, slow], asc('altitude_ft'));
    expect(ascending[ascending.length - 1]?.aircraft_id).toBe('C-GNONE');

    const descending = sortAircraft([noTelemetry, fast, slow], desc('altitude_ft'));
    expect(descending[descending.length - 1]?.aircraft_id).toBe('C-GNONE');
  });

  it('breaks ties on the stable identifier so rows do not reshuffle between polls', () => {
    const a = aircraft({ aircraft_id: 'C-GBBB', callsign: 'SAME' });
    const b = aircraft({ aircraft_id: 'C-GAAA', callsign: 'SAME' });

    const first = sortAircraft([a, b], asc('callsign')).map((x) => x.aircraft_id);
    const second = sortAircraft([b, a], asc('callsign')).map((x) => x.aircraft_id);

    expect(first).toEqual(second);
    expect(first).toEqual(['C-GAAA', 'C-GBBB']);
  });

  it('sorts last_seen as a time, not as a string', () => {
    const older = aircraft({ aircraft_id: 'C-GOLD', last_seen: '2026-08-25T09:00:00.000Z' });
    const newer = aircraft({ aircraft_id: 'C-GNEW', last_seen: '2026-08-25T18:00:00.000Z' });
    const sorted = sortAircraft([older, newer], desc('last_seen'));
    expect(sorted[0]?.aircraft_id).toBe('C-GNEW');
  });

  it('falls back to the registration when sorting a column that can be null', () => {
    const unnamed = aircraft({ aircraft_id: 'C-GZZZ', registration: null });
    const sorted = sortAircraft([unnamed, aircraft()], asc('registration'));
    // aircraft_id stands in for a missing registration, so it still sorts.
    expect(sorted.map((a) => a.aircraft_id)).toEqual(['C-GABC', 'C-GZZZ']);
  });

  it('handles an empty list', () => {
    expect(sortAircraft([], desc('callsign'))).toEqual([]);
  });
});
