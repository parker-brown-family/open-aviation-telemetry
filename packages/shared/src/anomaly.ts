import type { AlertKind, AlertSeverity } from './alerts.js';
import type { TelemetryReport } from './telemetry.js';

/**
 * Detection thresholds live in one exported object so the Architecture Explorer
 * can render the exact numbers the processor is using. Documentation that reads
 * from the implementation cannot drift away from it.
 */
export const THRESHOLDS = {
  engineTempWarningC: 120,
  engineTempCriticalC: 140,
  engineRpmMin: 1800,
  engineRpmMax: 2700,
  /** RPM band only applies once airborne; ground idle is legitimately low. */
  airborneAltitudeFt: 500,
  rapidDescentFpm: -3000,
  lowAltitudeFt: 1000,
  highSpeedKts: 250,
  fuelLowKg: 200,
  telemetryGapMs: 120_000,
} as const;

export interface DetectedAnomaly {
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
  detail: Record<string, unknown>;
}

export interface AnomalyContext {
  /** The previous accepted report for this airframe, if any. */
  previous: TelemetryReport | null;
}

/**
 * Pure anomaly detection: same input, same output, no clock and no I/O.
 *
 * That purity is what lets the stream processor, the API and the test suite all
 * agree on what counts as an alert — and it means a reviewer can read the rules
 * without tracing through Kafka.
 */
export function detectAnomalies(
  report: TelemetryReport,
  ctx: AnomalyContext = { previous: null },
): DetectedAnomaly[] {
  const found: DetectedAnomaly[] = [];
  const airborne = report.altitude_ft > THRESHOLDS.airborneAltitudeFt;

  const temp = report.engine.temperature_c;
  if (temp >= THRESHOLDS.engineTempCriticalC) {
    found.push({
      kind: 'engine_overtemp',
      severity: 'critical',
      message: `Engine temperature ${temp.toFixed(1)}C exceeds critical limit ${THRESHOLDS.engineTempCriticalC}C`,
      detail: { temperature_c: temp, limit_c: THRESHOLDS.engineTempCriticalC },
    });
  } else if (temp >= THRESHOLDS.engineTempWarningC) {
    found.push({
      kind: 'engine_overtemp',
      severity: 'warning',
      message: `Engine temperature ${temp.toFixed(1)}C above advisory limit ${THRESHOLDS.engineTempWarningC}C`,
      detail: { temperature_c: temp, limit_c: THRESHOLDS.engineTempWarningC },
    });
  }

  if (airborne) {
    const { rpm } = report.engine;
    if (rpm < THRESHOLDS.engineRpmMin || rpm > THRESHOLDS.engineRpmMax) {
      found.push({
        kind: 'engine_rpm_out_of_band',
        severity: 'warning',
        message: `Engine RPM ${Math.round(rpm)} outside airborne band ${THRESHOLDS.engineRpmMin}-${THRESHOLDS.engineRpmMax}`,
        detail: { rpm, min: THRESHOLDS.engineRpmMin, max: THRESHOLDS.engineRpmMax },
      });
    }
  }

  if (report.vertical_rate_fpm <= THRESHOLDS.rapidDescentFpm) {
    found.push({
      kind: 'rapid_descent',
      severity: 'critical',
      message: `Descent rate ${Math.round(report.vertical_rate_fpm)} fpm exceeds ${Math.abs(THRESHOLDS.rapidDescentFpm)} fpm`,
      detail: {
        vertical_rate_fpm: report.vertical_rate_fpm,
        limit_fpm: THRESHOLDS.rapidDescentFpm,
      },
    });
  }

  if (
    report.altitude_ft < THRESHOLDS.lowAltitudeFt &&
    report.groundspeed_kts > THRESHOLDS.highSpeedKts
  ) {
    found.push({
      kind: 'low_altitude_high_speed',
      severity: 'warning',
      message: `${Math.round(report.groundspeed_kts)} kts at ${Math.round(report.altitude_ft)} ft`,
      detail: { altitude_ft: report.altitude_ft, groundspeed_kts: report.groundspeed_kts },
    });
  }

  if (report.fuel_remaining_kg !== undefined && report.fuel_remaining_kg < THRESHOLDS.fuelLowKg) {
    found.push({
      kind: 'fuel_low',
      severity: 'warning',
      message: `Fuel remaining ${Math.round(report.fuel_remaining_kg)} kg below ${THRESHOLDS.fuelLowKg} kg`,
      detail: { fuel_remaining_kg: report.fuel_remaining_kg, limit_kg: THRESHOLDS.fuelLowKg },
    });
  }

  if (ctx.previous) {
    const gapMs = Date.parse(report.timestamp) - Date.parse(ctx.previous.timestamp);
    if (gapMs > THRESHOLDS.telemetryGapMs) {
      found.push({
        kind: 'telemetry_gap',
        severity: 'info',
        message: `No telemetry for ${Math.round(gapMs / 1000)}s`,
        detail: { gap_ms: gapMs, limit_ms: THRESHOLDS.telemetryGapMs },
      });
    }
  }

  return found;
}

/** The most severe level present, or null when the fleet is clean. */
export function highestSeverity(anomalies: readonly DetectedAnomaly[]): AlertSeverity | null {
  if (anomalies.some((a) => a.severity === 'critical')) return 'critical';
  if (anomalies.some((a) => a.severity === 'warning')) return 'warning';
  if (anomalies.length > 0) return 'info';
  return null;
}
