import type { ActiveInjection, TelemetryReport } from '@oat/shared';

/**
 * Applies demo fault injections to an outgoing telemetry report.
 *
 * The injections change what the aircraft *reports*, not what the platform
 * records. The anomalous reading then travels the same route as every other
 * report — HTTP ingest, Kafka, the stream processor's rules — so the alert on
 * the dashboard was genuinely derived, not written there by the demo button.
 * That is the difference between demonstrating a system and drawing a picture
 * of one.
 *
 * Returns null when the aircraft should stay silent for this tick.
 */
export function applyInjections(
  report: TelemetryReport,
  injections: readonly ActiveInjection[],
  nowMs: number,
): TelemetryReport | null {
  let result = report;

  for (const injection of injections) {
    if (Date.parse(injection.expires_at) <= nowMs) continue;
    if (!injection.aircraft_ids.includes(report.aircraft_id)) continue;

    switch (injection.scenario) {
      case 'engine_anomaly': {
        // Ramp rather than jump, so the operator sees the temperature climbing
        // through the advisory limit into the critical one.
        const elapsedS = (nowMs - Date.parse(injection.started_at)) / 1000;
        const climb = Math.min(70, elapsedS * 1.5);
        result = {
          ...result,
          engine: {
            ...result.engine,
            temperature_c: Number((result.engine.temperature_c + climb).toFixed(1)),
          },
        };
        break;
      }

      case 'rapid_descent': {
        result = {
          ...result,
          vertical_rate_fpm: -4200,
          altitude_ft: Math.max(1000, result.altitude_ft - 3000),
        };
        break;
      }

      case 'fuel_low': {
        result = { ...result, fuel_remaining_kg: 120 };
        break;
      }

      case 'telemetry_gap': {
        // Stop reporting entirely. The platform notices the silence and ages the
        // aircraft to stale, then lost — absence of data as information.
        return null;
      }

      case 'worker_failure':
      case 'poison_event':
        // Handled by the API directly; nothing to change in telemetry.
        break;
    }
  }

  return result;
}
