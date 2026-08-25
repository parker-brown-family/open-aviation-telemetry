import { describe, expect, it } from 'vitest';
import { THRESHOLDS, detectAnomalies, highestSeverity } from './anomaly.js';
import { TelemetryReportSchema, type TelemetryReport } from './telemetry.js';

function report(overrides: Record<string, unknown> = {}): TelemetryReport {
  return TelemetryReportSchema.parse({
    aircraft_id: 'C-GABC',
    timestamp: '2026-08-25T18:32:00.000Z',
    position: { latitude: 49.887, longitude: -119.496 },
    altitude_ft: 12500,
    groundspeed_kts: 242,
    heading_deg: 78,
    vertical_rate_fpm: 0,
    engine: { temperature_c: 92, rpm: 2350 },
    ...overrides,
  });
}

const kinds = (r: TelemetryReport, previous: TelemetryReport | null = null): string[] =>
  detectAnomalies(r, { previous }).map((a) => a.kind);

describe('detectAnomalies', () => {
  it('finds nothing wrong with a nominal cruise report', () => {
    expect(detectAnomalies(report())).toHaveLength(0);
  });

  it('raises a warning at the advisory engine temperature and critical above the limit', () => {
    const warn = detectAnomalies(report({ engine: { temperature_c: 125, rpm: 2350 } }));
    expect(warn).toHaveLength(1);
    expect(warn[0]?.severity).toBe('warning');

    const crit = detectAnomalies(report({ engine: { temperature_c: 145, rpm: 2350 } }));
    expect(crit[0]?.severity).toBe('critical');
  });

  it('treats the critical threshold itself as critical, not warning', () => {
    const at = detectAnomalies(
      report({ engine: { temperature_c: THRESHOLDS.engineTempCriticalC, rpm: 2350 } }),
    );
    expect(at[0]?.severity).toBe('critical');
  });

  it('only applies the RPM band once airborne, so ground idle is not an alert', () => {
    expect(
      kinds(report({ altitude_ft: 100, engine: { temperature_c: 60, rpm: 700 } })),
    ).not.toContain('engine_rpm_out_of_band');
    expect(kinds(report({ altitude_ft: 9000, engine: { temperature_c: 60, rpm: 700 } }))).toContain(
      'engine_rpm_out_of_band',
    );
  });

  it('flags a descent steeper than the limit', () => {
    expect(kinds(report({ vertical_rate_fpm: -3200 }))).toContain('rapid_descent');
    expect(kinds(report({ vertical_rate_fpm: -2900 }))).not.toContain('rapid_descent');
  });

  it('flags high speed at low altitude', () => {
    expect(kinds(report({ altitude_ft: 800, groundspeed_kts: 300 }))).toContain(
      'low_altitude_high_speed',
    );
  });

  it('ignores fuel when the field is absent rather than assuming zero', () => {
    expect(kinds(report())).not.toContain('fuel_low');
    expect(kinds(report({ fuel_remaining_kg: 150 }))).toContain('fuel_low');
    expect(kinds(report({ fuel_remaining_kg: 900 }))).not.toContain('fuel_low');
  });

  it('detects a telemetry gap only when a previous report exists', () => {
    const previous = report({ timestamp: '2026-08-25T18:28:00.000Z' });
    expect(kinds(report(), previous)).toContain('telemetry_gap');
    expect(kinds(report(), null)).not.toContain('telemetry_gap');
  });

  it('does not flag a normal reporting interval as a gap', () => {
    const previous = report({ timestamp: '2026-08-25T18:31:57.000Z' });
    expect(kinds(report(), previous)).not.toContain('telemetry_gap');
  });

  it('reports several independent anomalies from one sample', () => {
    const found = kinds(
      report({
        altitude_ft: 900,
        groundspeed_kts: 320,
        vertical_rate_fpm: -4000,
        engine: { temperature_c: 150, rpm: 2350 },
      }),
    );
    expect(found).toContain('engine_overtemp');
    expect(found).toContain('rapid_descent');
    expect(found).toContain('low_altitude_high_speed');
  });

  it('is pure — the same input always produces the same output', () => {
    const sample = report({ engine: { temperature_c: 145, rpm: 3000 } });
    expect(detectAnomalies(sample)).toEqual(detectAnomalies(sample));
  });
});

describe('highestSeverity', () => {
  it('returns null for a clean fleet', () => {
    expect(highestSeverity([])).toBeNull();
  });

  it('promotes critical above warning regardless of ordering', () => {
    const anomalies = detectAnomalies(
      report({ engine: { temperature_c: 150, rpm: 3000 }, altitude_ft: 9000 }),
    );
    expect(highestSeverity(anomalies)).toBe('critical');
  });
});
