import {
  AIRCRAFT_TYPES,
  AIRPORTS,
  OPERATORS,
  bearingDeg,
  destinationPoint,
  distanceNm,
  type Airport,
  type AircraftType,
  type LatLon,
  type TelemetryReport,
} from '@oat/shared';

/**
 * A synthetic airframe flying a synthetic leg.
 *
 * The flight model is deliberately simple — climb, cruise, descend, land, pick a
 * new destination — because its job is to produce plausible, continuously
 * changing telemetry through the real ingest path, not to be a flight simulator.
 * What matters is that the numbers move the way an operator would expect, so a
 * reviewer looking at the dashboard sees something coherent rather than noise.
 */

export type SimPhase = 'taxi' | 'climb' | 'cruise' | 'descent' | 'landed';

export interface SimAircraft {
  aircraft_id: string;
  callsign: string;
  registration: string;
  operator: string;
  type: AircraftType;
  origin: Airport;
  destination: Airport;
  position: LatLon;
  altitude_ft: number;
  groundspeed_kts: number;
  heading_deg: number;
  vertical_rate_fpm: number;
  engine_temperature_c: number;
  engine_rpm: number;
  fuel_remaining_kg: number;
  phase: SimPhase;
  /** Seconds spent on the ground before departing again. */
  ground_hold_s: number;
}

/**
 * Deterministic pseudo-random numbers.
 *
 * A demo that produces the same fleet every time it starts is one you can
 * rehearse, and one where "it looked different when I tried it" is a real
 * signal rather than the generator being random.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Canadian civil registrations are C-Fxxx or C-Gxxx. */
function registrationFor(rand: () => number): string {
  const prefix = rand() < 0.5 ? 'F' : 'G';
  const pick = (): string => LETTERS[Math.floor(rand() * LETTERS.length)] ?? 'A';
  return `C-${prefix}${pick()}${pick()}${pick()}`;
}

function pick<T>(items: readonly T[], rand: () => number): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error('cannot pick from an empty list');
  return item;
}

export function createAircraft(index: number, rand: () => number): SimAircraft {
  const type = pick(AIRCRAFT_TYPES, rand);
  const origin = pick(AIRPORTS, rand);
  let destination = pick(AIRPORTS, rand);
  while (destination.iata === origin.iata) destination = pick(AIRPORTS, rand);

  const registration = registrationFor(rand);
  const operator = pick(OPERATORS, rand);

  return {
    aircraft_id: registration,
    callsign: `${operator.slice(0, 3).toUpperCase()}${100 + index}`,
    registration,
    operator,
    type,
    origin,
    destination,
    position: { latitude: origin.latitude, longitude: origin.longitude },
    altitude_ft: origin.elevation_ft,
    groundspeed_kts: 0,
    heading_deg: bearingDeg(origin, destination),
    vertical_rate_fpm: 0,
    engine_temperature_c: 40 + rand() * 15,
    engine_rpm: 800,
    fuel_remaining_kg: type.fuel_capacity_kg * (0.5 + rand() * 0.4),
    phase: 'taxi',
    // Stagger departures so the fleet does not move as one block.
    ground_hold_s: rand() * 60,
  };
}

/** Distance at which the aircraft begins its descent. */
function descentStartNm(type: AircraftType): number {
  // Roughly three nautical miles per thousand feet to lose, a standard rule of thumb.
  return (type.cruise_altitude_ft / 1000) * 3;
}

/**
 * Advances one airframe by `dtSeconds`.
 *
 * Pure with respect to everything except the supplied RNG: given the same state,
 * the same elapsed time and the same random stream, it produces the same result.
 * That is what makes it testable.
 */
export function advance(ac: SimAircraft, dtSeconds: number, rand: () => number): SimAircraft {
  const next: SimAircraft = { ...ac, position: { ...ac.position } };
  const type = ac.type;
  const remainingNm = distanceNm(ac.position, ac.destination);

  switch (ac.phase) {
    case 'taxi': {
      next.ground_hold_s = Math.max(0, ac.ground_hold_s - dtSeconds);
      next.groundspeed_kts = next.ground_hold_s > 0 ? 12 : 0;
      next.engine_rpm = 900;
      next.engine_temperature_c = Math.min(70, ac.engine_temperature_c + dtSeconds * 0.3);
      if (next.ground_hold_s <= 0) {
        next.phase = 'climb';
        next.heading_deg = bearingDeg(ac.position, ac.destination);
      }
      break;
    }

    case 'climb': {
      next.vertical_rate_fpm = type.climb_rate_fpm;
      next.altitude_ft = Math.min(
        type.cruise_altitude_ft,
        ac.altitude_ft + (type.climb_rate_fpm / 60) * dtSeconds,
      );
      // Accelerate toward cruise speed rather than jumping to it.
      next.groundspeed_kts = Math.min(type.cruise_speed_kts, ac.groundspeed_kts + 8 * dtSeconds);
      next.engine_rpm = type.nominal_rpm + 120;
      next.engine_temperature_c = Math.min(105, ac.engine_temperature_c + dtSeconds * 0.8);
      if (next.altitude_ft >= type.cruise_altitude_ft - 50) {
        next.phase = 'cruise';
        next.vertical_rate_fpm = 0;
      }
      break;
    }

    case 'cruise': {
      next.vertical_rate_fpm = 0;
      next.altitude_ft = type.cruise_altitude_ft;
      next.groundspeed_kts = type.cruise_speed_kts;
      next.engine_rpm = type.nominal_rpm;
      // Settle toward a steady cruise temperature with a little variation.
      next.engine_temperature_c = ac.engine_temperature_c + (92 - ac.engine_temperature_c) * 0.1;
      if (remainingNm <= descentStartNm(type)) {
        next.phase = 'descent';
      }
      break;
    }

    case 'descent': {
      const targetAlt = ac.destination.elevation_ft;
      const rate = -Math.min(1800, type.climb_rate_fpm);
      next.vertical_rate_fpm = rate;
      next.altitude_ft = Math.max(targetAlt, ac.altitude_ft + (rate / 60) * dtSeconds);
      next.groundspeed_kts = Math.max(120, ac.groundspeed_kts - 2 * dtSeconds);
      next.engine_rpm = type.nominal_rpm - 200;
      next.engine_temperature_c = Math.max(70, ac.engine_temperature_c - dtSeconds * 0.4);
      if (remainingNm < 1.5 || next.altitude_ft <= targetAlt + 20) {
        next.phase = 'landed';
      }
      break;
    }

    case 'landed': {
      next.altitude_ft = ac.destination.elevation_ft;
      next.groundspeed_kts = 0;
      next.vertical_rate_fpm = 0;
      next.engine_rpm = 800;
      next.engine_temperature_c = Math.max(45, ac.engine_temperature_c - dtSeconds * 0.6);
      // Turn the aircraft around: today's destination is tomorrow's origin.
      next.origin = ac.destination;
      let newDestination = pick(AIRPORTS, rand);
      while (newDestination.iata === ac.destination.iata) newDestination = pick(AIRPORTS, rand);
      next.destination = newDestination;
      next.position = { latitude: ac.destination.latitude, longitude: ac.destination.longitude };
      next.heading_deg = bearingDeg(next.position, newDestination);
      next.fuel_remaining_kg = type.fuel_capacity_kg * (0.6 + rand() * 0.3);
      next.ground_hold_s = 30 + rand() * 90;
      next.phase = 'taxi';
      break;
    }
  }

  // Move along the current heading at the current speed.
  if (next.groundspeed_kts > 0 && next.phase !== 'landed' && next.phase !== 'taxi') {
    const heading = bearingDeg(next.position, next.destination);
    next.heading_deg = heading;
    const travelledNm = (next.groundspeed_kts / 3600) * dtSeconds;
    next.position = destinationPoint(next.position, heading, Math.min(travelledNm, remainingNm));
  }

  // Burn fuel roughly in proportion to power setting.
  const burnKgPerSecond = (type.fuel_capacity_kg / 12_000) * (next.engine_rpm / type.nominal_rpm);
  next.fuel_remaining_kg = Math.max(0, next.fuel_remaining_kg - burnKgPerSecond * dtSeconds);

  return next;
}

/** Converts simulator state into the telemetry wire contract. */
export function toTelemetry(ac: SimAircraft, timestamp: string): TelemetryReport {
  return {
    aircraft_id: ac.aircraft_id,
    timestamp,
    position: {
      latitude: Number(ac.position.latitude.toFixed(5)),
      longitude: Number(ac.position.longitude.toFixed(5)),
    },
    altitude_ft: Math.round(ac.altitude_ft),
    groundspeed_kts: Math.round(ac.groundspeed_kts),
    heading_deg: Number(((ac.heading_deg % 360) + 360).toFixed(1)) % 360,
    vertical_rate_fpm: Math.round(ac.vertical_rate_fpm),
    engine: {
      temperature_c: Number(ac.engine_temperature_c.toFixed(1)),
      rpm: Math.round(ac.engine_rpm),
    },
    fuel_remaining_kg: Number(ac.fuel_remaining_kg.toFixed(1)),
    source: 'simulated',
  };
}
