import { describe, expect, it } from 'vitest';
import {
  TelemetryReportSchema,
  deriveFlightPhase,
  deriveStatus,
  type TelemetryReport,
} from './telemetry.js';

const base = {
  aircraft_id: 'C-GABC',
  timestamp: '2026-08-25T18:32:00.000Z',
  position: { latitude: 49.887, longitude: -119.496 },
  altitude_ft: 12500,
  groundspeed_kts: 242,
  heading_deg: 78,
  engine: { temperature_c: 92, rpm: 2350 },
};

function report(overrides: Partial<TelemetryReport> = {}): TelemetryReport {
  return { ...TelemetryReportSchema.parse(base), ...overrides };
}

describe('TelemetryReportSchema', () => {
  it('accepts the documented wire payload and applies defaults', () => {
    const parsed = TelemetryReportSchema.parse(base);
    expect(parsed.aircraft_id).toBe('C-GABC');
    expect(parsed.vertical_rate_fpm).toBe(0);
    expect(parsed.source).toBe('simulated');
  });

  it('rejects a latitude outside the valid range', () => {
    const bad = { ...base, position: { latitude: 91, longitude: 0 } };
    expect(TelemetryReportSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a lowercase aircraft id so ids stay canonical across the system', () => {
    const bad = { ...base, aircraft_id: 'c-gabc' };
    expect(TelemetryReportSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a timestamp without a timezone offset', () => {
    const bad = { ...base, timestamp: '2026-08-25T18:32:00' };
    expect(TelemetryReportSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an implausible altitude', () => {
    expect(TelemetryReportSchema.safeParse({ ...base, altitude_ft: 90000 }).success).toBe(false);
  });
});

describe('deriveFlightPhase', () => {
  it('reports parked when stopped on the ground', () => {
    expect(deriveFlightPhase(report({ altitude_ft: 20, groundspeed_kts: 0 }))).toBe('parked');
  });

  it('reports taxi when moving slowly on the ground', () => {
    expect(deriveFlightPhase(report({ altitude_ft: 20, groundspeed_kts: 22 }))).toBe('taxi');
  });

  it('reports climb on a positive vertical rate', () => {
    expect(deriveFlightPhase(report({ vertical_rate_fpm: 1400 }))).toBe('climb');
  });

  it('separates high-altitude descent from low-altitude approach', () => {
    expect(deriveFlightPhase(report({ altitude_ft: 22000, vertical_rate_fpm: -1200 }))).toBe(
      'descent',
    );
    expect(deriveFlightPhase(report({ altitude_ft: 4000, vertical_rate_fpm: -1200 }))).toBe(
      'approach',
    );
  });

  it('reports cruise when level at altitude', () => {
    expect(deriveFlightPhase(report({ altitude_ft: 24000, vertical_rate_fpm: 0 }))).toBe('cruise');
  });
});

describe('deriveStatus', () => {
  const t0 = Date.parse('2026-08-25T18:00:00.000Z');

  it('is active within the reporting interval', () => {
    expect(deriveStatus('2026-08-25T17:59:30.000Z', t0)).toBe('active');
  });

  it('goes stale after two missed intervals', () => {
    expect(deriveStatus('2026-08-25T17:57:00.000Z', t0)).toBe('stale');
  });

  it('is lost after ten minutes of silence', () => {
    expect(deriveStatus('2026-08-25T17:45:00.000Z', t0)).toBe('lost');
  });
});
