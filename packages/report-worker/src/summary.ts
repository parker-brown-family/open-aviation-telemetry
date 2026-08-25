import { trackDistanceNm, type FlightSummary, type TelemetryReport } from '@oat/shared';

/**
 * Turns a window of telemetry into a flight summary.
 *
 * Pure: takes the samples, returns the summary. All the I/O — reading history,
 * counting alerts, writing the result — stays in the worker, so the arithmetic
 * that a reviewer might actually want to check can be tested directly.
 */
export function buildFlightSummary(args: {
  aircraftId: string;
  windowMinutes: number;
  samples: readonly TelemetryReport[];
  alertsInWindow: number;
  generatedAt: string;
}): FlightSummary {
  const { aircraftId, windowMinutes, samples, alertsInWindow, generatedAt } = args;

  if (samples.length === 0) {
    return {
      aircraft_id: aircraftId,
      window_minutes: windowMinutes,
      samples: 0,
      first_sample_at: null,
      last_sample_at: null,
      distance_nm: 0,
      max_altitude_ft: 0,
      max_groundspeed_kts: 0,
      avg_groundspeed_kts: 0,
      max_engine_temp_c: 0,
      alerts_in_window: alertsInWindow,
      generated_at: generatedAt,
    };
  }

  // Samples arrive oldest-first from the repository. Sorting defensively means
  // the distance calculation cannot be quietly wrong if that ever changes.
  const ordered = [...samples].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const speeds = ordered.map((s) => s.groundspeed_kts);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  return {
    aircraft_id: aircraftId,
    window_minutes: windowMinutes,
    samples: ordered.length,
    first_sample_at: first?.timestamp ?? null,
    last_sample_at: last?.timestamp ?? null,
    distance_nm: Number(trackDistanceNm(ordered.map((s) => s.position)).toFixed(2)),
    max_altitude_ft: Math.max(...ordered.map((s) => s.altitude_ft)),
    max_groundspeed_kts: Math.max(...speeds),
    avg_groundspeed_kts: Number((speeds.reduce((sum, v) => sum + v, 0) / speeds.length).toFixed(1)),
    max_engine_temp_c: Math.max(...ordered.map((s) => s.engine.temperature_c)),
    alerts_in_window: alertsInWindow,
    generated_at: generatedAt,
  };
}

export type JobOutcome =
  | { action: 'retry'; attempt: number; delayMs: number }
  | { action: 'dead_letter'; attempt: number };

/**
 * Decides what happens to a job that just failed.
 *
 * Separated from the messaging code because "how many times do we try before
 * giving up" is a policy decision, and policy decisions should be readable and
 * testable without a broker in the room.
 */
export function decideFailureOutcome(
  attempt: number,
  maxAttempts: number,
  delayMs: number,
): JobOutcome {
  return attempt < maxAttempts
    ? { action: 'retry', attempt, delayMs }
    : { action: 'dead_letter', attempt };
}
