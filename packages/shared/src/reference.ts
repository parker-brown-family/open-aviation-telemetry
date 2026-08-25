import type { BoundingBox, LatLon } from './geo.js';

/**
 * Reference data for the demo region: the BC/Alberta interior, anchored on
 * Kelowna. All of it is static and shipped with the code, so the demo has no
 * runtime dependency on any external aviation data provider.
 */

export interface Airport {
  iata: string;
  icao: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation_ft: number;
  /** Larger fields anchor the display; smaller ones are route endpoints only. */
  major: boolean;
}

export const AIRPORTS: readonly Airport[] = [
  {
    iata: 'YLW',
    icao: 'CYLW',
    name: 'Kelowna',
    latitude: 49.9561,
    longitude: -119.3777,
    elevation_ft: 1421,
    major: true,
  },
  {
    iata: 'YVR',
    icao: 'CYVR',
    name: 'Vancouver',
    latitude: 49.1967,
    longitude: -123.1815,
    elevation_ft: 14,
    major: true,
  },
  {
    iata: 'YYC',
    icao: 'CYYC',
    name: 'Calgary',
    latitude: 51.1139,
    longitude: -114.0203,
    elevation_ft: 3557,
    major: true,
  },
  {
    iata: 'YEG',
    icao: 'CYEG',
    name: 'Edmonton',
    latitude: 53.3097,
    longitude: -113.5801,
    elevation_ft: 2373,
    major: true,
  },
  {
    iata: 'YXS',
    icao: 'CYXS',
    name: 'Prince George',
    latitude: 53.8894,
    longitude: -122.6789,
    elevation_ft: 2267,
    major: true,
  },
  {
    iata: 'YKA',
    icao: 'CYKA',
    name: 'Kamloops',
    latitude: 50.7022,
    longitude: -120.4442,
    elevation_ft: 1133,
    major: false,
  },
  {
    iata: 'YYJ',
    icao: 'CYYJ',
    name: 'Victoria',
    latitude: 48.6469,
    longitude: -123.4258,
    elevation_ft: 63,
    major: false,
  },
  {
    iata: 'YXC',
    icao: 'CYXC',
    name: 'Cranbrook',
    latitude: 49.6108,
    longitude: -115.7822,
    elevation_ft: 3084,
    major: false,
  },
  {
    iata: 'YQQ',
    icao: 'CYQQ',
    name: 'Comox',
    latitude: 49.7108,
    longitude: -124.8867,
    elevation_ft: 84,
    major: false,
  },
  {
    iata: 'YPR',
    icao: 'CYPR',
    name: 'Prince Rupert',
    latitude: 54.2861,
    longitude: -130.4447,
    elevation_ft: 116,
    major: false,
  },
  {
    iata: 'YXJ',
    icao: 'CYXJ',
    name: 'Fort St. John',
    latitude: 56.2381,
    longitude: -120.7404,
    elevation_ft: 2280,
    major: false,
  },
  {
    iata: 'YCG',
    icao: 'CYCG',
    name: 'Castlegar',
    latitude: 49.2964,
    longitude: -117.6322,
    elevation_ft: 1624,
    major: false,
  },
];

export function airportByIata(iata: string): Airport | undefined {
  return AIRPORTS.find((a) => a.iata === iata);
}

/**
 * The fields a display can be centred on.
 *
 * Derived from the `major` flag rather than listed again, so adding a datum is
 * a data change in AIRPORTS above and not an edit in two places that can
 * disagree. Small fields stay plottable but are not offered as an anchor —
 * centring a 600-nm-tall window on Castlegar shows mostly empty terrain.
 */
export const DATUMS: readonly Airport[] = AIRPORTS.filter((a) => a.major);

/** Where a display opens: Kelowna, because that is where the fleet is based. */
export const DEFAULT_DATUM: Airport = airportByIata('YLW') ?? AIRPORTS[0]!;

export function isDatum(iata: string): boolean {
  return DATUMS.some((a) => a.iata === iata);
}

/** The datum for an IATA code, falling back to the default for an unknown one. */
export function datumByIata(iata: string | null | undefined): Airport {
  if (!iata) return DEFAULT_DATUM;
  return DATUMS.find((a) => a.iata === iata) ?? DEFAULT_DATUM;
}

/** The plan-view display window. Chosen to contain every airport above. */
export const REGION: BoundingBox = {
  north: 57.5,
  south: 47.5,
  west: -132.0,
  east: -110.0,
};

export function isInRegion(p: LatLon): boolean {
  return (
    p.latitude <= REGION.north &&
    p.latitude >= REGION.south &&
    p.longitude >= REGION.west &&
    p.longitude <= REGION.east
  );
}

export interface AircraftType {
  icao: string;
  name: string;
  cruise_altitude_ft: number;
  cruise_speed_kts: number;
  climb_rate_fpm: number;
  fuel_capacity_kg: number;
  nominal_rpm: number;
}

export const AIRCRAFT_TYPES: readonly AircraftType[] = [
  {
    icao: 'DH8D',
    name: 'Dash 8-400',
    cruise_altitude_ft: 24000,
    cruise_speed_kts: 360,
    climb_rate_fpm: 1500,
    fuel_capacity_kg: 5300,
    nominal_rpm: 2200,
  },
  {
    icao: 'PC12',
    name: 'Pilatus PC-12',
    cruise_altitude_ft: 26000,
    cruise_speed_kts: 270,
    climb_rate_fpm: 1200,
    fuel_capacity_kg: 1200,
    nominal_rpm: 2100,
  },
  {
    icao: 'B350',
    name: 'King Air 350',
    cruise_altitude_ft: 27000,
    cruise_speed_kts: 300,
    climb_rate_fpm: 1400,
    fuel_capacity_kg: 1600,
    nominal_rpm: 2300,
  },
  {
    icao: 'C208',
    name: 'Cessna Caravan',
    cruise_altitude_ft: 14000,
    cruise_speed_kts: 180,
    climb_rate_fpm: 900,
    fuel_capacity_kg: 1000,
    nominal_rpm: 1900,
  },
  {
    icao: 'DHC6',
    name: 'Twin Otter',
    cruise_altitude_ft: 12000,
    cruise_speed_kts: 160,
    climb_rate_fpm: 1000,
    fuel_capacity_kg: 1100,
    nominal_rpm: 2000,
  },
  {
    icao: 'CL60',
    name: 'Challenger 604',
    cruise_altitude_ft: 37000,
    cruise_speed_kts: 460,
    climb_rate_fpm: 2200,
    fuel_capacity_kg: 9000,
    nominal_rpm: 2450,
  },
  {
    icao: 'AS50',
    name: 'AS350 Helicopter',
    cruise_altitude_ft: 6000,
    cruise_speed_kts: 120,
    climb_rate_fpm: 1100,
    fuel_capacity_kg: 400,
    nominal_rpm: 2600,
  },
  {
    icao: 'CRJ9',
    name: 'CRJ-900',
    cruise_altitude_ft: 34000,
    cruise_speed_kts: 440,
    climb_rate_fpm: 2000,
    fuel_capacity_kg: 8800,
    nominal_rpm: 2400,
  },
];

export function aircraftTypeByIcao(icao: string): AircraftType | undefined {
  return AIRCRAFT_TYPES.find((t) => t.icao === icao);
}

/**
 * Fictional operators. Using invented names keeps the project unambiguously a
 * reference implementation rather than something that appears to publish data
 * about a real carrier's fleet.
 */
export const OPERATORS: readonly string[] = [
  'Okanagan Air',
  'Cascade Regional',
  'Selkirk Charter',
  'Monashee Air Services',
  'Kootenay Medevac',
  'Pacific Survey',
  'Interior Freight',
  'Columbia Air Ambulance',
];
