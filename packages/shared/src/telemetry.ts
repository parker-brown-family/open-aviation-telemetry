import { z } from 'zod';

/**
 * The telemetry wire contract.
 *
 * Deliberate decision: the HTTP payload, the Kafka event body and the PostgreSQL
 * column names all use the SAME snake_case vocabulary. There is no wire/domain
 * mapping layer, because every mapping layer is a place where two names for one
 * concept can drift apart. One vocabulary, one source of truth: this file.
 */
export const PositionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const EngineSchema = z.object({
  temperature_c: z.number().min(-60).max(400),
  rpm: z.number().min(0).max(6000),
});

export const TelemetryReportSchema = z.object({
  aircraft_id: z
    .string()
    .min(2)
    .max(16)
    .regex(/^[A-Z0-9-]+$/, 'aircraft_id must be uppercase alphanumeric with hyphens'),
  timestamp: z.string().datetime({ offset: true }),
  position: PositionSchema,
  altitude_ft: z.number().min(-1500).max(60000),
  groundspeed_kts: z.number().min(0).max(1200),
  heading_deg: z.number().min(0).max(360),
  vertical_rate_fpm: z.number().min(-15000).max(15000).default(0),
  engine: EngineSchema,
  fuel_remaining_kg: z.number().min(0).max(200000).optional(),
  /** Where the report entered the system. Satellite/ACARS-style links are common in aviation. */
  source: z.enum(['satellite', 'vhf', 'cellular', 'simulated']).default('simulated'),
});

export type Position = z.infer<typeof PositionSchema>;
export type TelemetryReport = z.infer<typeof TelemetryReportSchema>;

/** Flight phase is DERIVED, never reported by the aircraft. */
export const FLIGHT_PHASES = [
  'parked',
  'taxi',
  'climb',
  'cruise',
  'descent',
  'approach',
  'unknown',
] as const;
export type FlightPhase = (typeof FLIGHT_PHASES)[number];

export const AIRCRAFT_STATUSES = ['active', 'stale', 'lost'] as const;
export type AircraftStatus = (typeof AIRCRAFT_STATUSES)[number];

export interface AircraftState {
  aircraft_id: string;
  callsign: string | null;
  registration: string | null;
  type_icao: string | null;
  operator: string | null;
  status: AircraftStatus;
  flight_phase: FlightPhase;
  first_seen: string;
  last_seen: string;
  latest: TelemetryReport | null;
}

/**
 * Derive flight phase from a single report. Pure, so it is trivially testable and
 * produces identical results in the API, the stream processor and the tests.
 */
export function deriveFlightPhase(report: TelemetryReport): FlightPhase {
  const { altitude_ft, groundspeed_kts, vertical_rate_fpm } = report;
  if (altitude_ft < 100 && groundspeed_kts < 5) return 'parked';
  if (altitude_ft < 100 && groundspeed_kts < 60) return 'taxi';
  if (vertical_rate_fpm > 300) return 'climb';
  if (vertical_rate_fpm < -300) return altitude_ft < 8000 ? 'approach' : 'descent';
  if (altitude_ft >= 8000) return 'cruise';
  if (altitude_ft >= 100) return 'unknown';
  return 'unknown';
}

/** An aircraft is stale after 2 telemetry intervals, lost after 10. */
export const STALE_AFTER_MS = 120_000;
export const LOST_AFTER_MS = 600_000;

export function deriveStatus(lastSeenIso: string, nowMs: number): AircraftStatus {
  const age = nowMs - Date.parse(lastSeenIso);
  if (age > LOST_AFTER_MS) return 'lost';
  if (age > STALE_AFTER_MS) return 'stale';
  return 'active';
}
