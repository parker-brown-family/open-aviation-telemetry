import { describe, expect, it } from 'vitest';
import { TelemetryReportSchema, distanceNm, type TelemetryReport } from '@oat/shared';
import { buildFlightSummary, decideFailureOutcome } from './summary.js';

function sample(overrides: Record<string, unknown> = {}): TelemetryReport {
  return TelemetryReportSchema.parse({
    aircraft_id: 'C-GABC',
    timestamp: '2026-08-25T18:00:00.000Z',
    position: { latitude: 49.9561, longitude: -119.3777 },
    altitude_ft: 10000,
    groundspeed_kts: 200,
    heading_deg: 270,
    vertical_rate_fpm: 0,
    engine: { temperature_c: 90, rpm: 2200 },
    ...overrides,
  });
}

const generatedAt = '2026-08-25T19:00:00.000Z';

describe('buildFlightSummary', () => {
  it('returns a zeroed summary when there is no telemetry in the window', () => {
    const summary = buildFlightSummary({
      aircraftId: 'C-GABC',
      windowMinutes: 60,
      samples: [],
      alertsInWindow: 0,
      generatedAt,
    });

    expect(summary.samples).toBe(0);
    expect(summary.distance_nm).toBe(0);
    expect(summary.first_sample_at).toBeNull();
    expect(summary.last_sample_at).toBeNull();
  });

  it('reports the window bounds from the samples', () => {
    const summary = buildFlightSummary({
      aircraftId: 'C-GABC',
      windowMinutes: 60,
      samples: [
        sample({ timestamp: '2026-08-25T18:00:00.000Z' }),
        sample({ timestamp: '2026-08-25T18:30:00.000Z' }),
      ],
      alertsInWindow: 0,
      generatedAt,
    });

    expect(summary.first_sample_at).toBe('2026-08-25T18:00:00.000Z');
    expect(summary.last_sample_at).toBe('2026-08-25T18:30:00.000Z');
    expect(summary.samples).toBe(2);
  });

  it('computes distance along the track, not straight-line from first to last', () => {
    // A dog-leg: out west, then back east to near the start. Straight-line
    // distance would be close to zero; track distance is the sum of both legs.
    const a = { latitude: 49.9561, longitude: -119.3777 };
    const b = { latitude: 49.9561, longitude: -120.5 };
    const c = { latitude: 49.9561, longitude: -119.4 };

    const summary = buildFlightSummary({
      aircraftId: 'C-GABC',
      windowMinutes: 60,
      samples: [
        sample({ timestamp: '2026-08-25T18:00:00.000Z', position: a }),
        sample({ timestamp: '2026-08-25T18:15:00.000Z', position: b }),
        sample({ timestamp: '2026-08-25T18:30:00.000Z', position: c }),
      ],
      alertsInWindow: 0,
      generatedAt,
    });

    const straightLine = distanceNm(a, c);
    expect(summary.distance_nm).toBeGreaterThan(straightLine * 10);
  });

  it('sorts unordered samples before measuring, so distance is not inflated', () => {
    const a = { latitude: 49.0, longitude: -119.0 };
    const b = { latitude: 50.0, longitude: -119.0 };
    const c = { latitude: 51.0, longitude: -119.0 };

    const inOrder = buildFlightSummary({
      aircraftId: 'C-GABC',
      windowMinutes: 60,
      samples: [
        sample({ timestamp: '2026-08-25T18:00:00.000Z', position: a }),
        sample({ timestamp: '2026-08-25T18:10:00.000Z', position: b }),
        sample({ timestamp: '2026-08-25T18:20:00.000Z', position: c }),
      ],
      alertsInWindow: 0,
      generatedAt,
    });

    const shuffled = buildFlightSummary({
      aircraftId: 'C-GABC',
      windowMinutes: 60,
      samples: [
        sample({ timestamp: '2026-08-25T18:20:00.000Z', position: c }),
        sample({ timestamp: '2026-08-25T18:00:00.000Z', position: a }),
        sample({ timestamp: '2026-08-25T18:10:00.000Z', position: b }),
      ],
      alertsInWindow: 0,
      generatedAt,
    });

    expect(shuffled.distance_nm).toBeCloseTo(inOrder.distance_nm, 2);
  });

  it('takes maxima and the mean across the window', () => {
    const summary = buildFlightSummary({
      aircraftId: 'C-GABC',
      windowMinutes: 60,
      samples: [
        sample({
          altitude_ft: 10000,
          groundspeed_kts: 200,
          engine: { temperature_c: 90, rpm: 2200 },
        }),
        sample({
          timestamp: '2026-08-25T18:10:00.000Z',
          altitude_ft: 24000,
          groundspeed_kts: 300,
          engine: { temperature_c: 118, rpm: 2200 },
        }),
      ],
      alertsInWindow: 3,
      generatedAt,
    });

    expect(summary.max_altitude_ft).toBe(24000);
    expect(summary.max_groundspeed_kts).toBe(300);
    expect(summary.max_engine_temp_c).toBe(118);
    expect(summary.avg_groundspeed_kts).toBeCloseTo(250, 1);
    expect(summary.alerts_in_window).toBe(3);
  });

  it('does not mutate the caller’s sample array', () => {
    const samples = [
      sample({ timestamp: '2026-08-25T18:20:00.000Z' }),
      sample({ timestamp: '2026-08-25T18:00:00.000Z' }),
    ];
    const before = samples.map((s) => s.timestamp);
    buildFlightSummary({
      aircraftId: 'C-GABC',
      windowMinutes: 60,
      samples,
      alertsInWindow: 0,
      generatedAt,
    });
    expect(samples.map((s) => s.timestamp)).toEqual(before);
  });
});

describe('decideFailureOutcome', () => {
  it('retries while attempts remain', () => {
    expect(decideFailureOutcome(1, 3, 5000)).toEqual({
      action: 'retry',
      attempt: 1,
      delayMs: 5000,
    });
    expect(decideFailureOutcome(2, 3, 5000)).toMatchObject({ action: 'retry' });
  });

  it('dead-letters on the final attempt rather than retrying forever', () => {
    expect(decideFailureOutcome(3, 3, 5000)).toEqual({ action: 'dead_letter', attempt: 3 });
  });

  it('dead-letters if the attempt count somehow exceeds the maximum', () => {
    expect(decideFailureOutcome(9, 3, 5000)).toMatchObject({ action: 'dead_letter' });
  });
});
