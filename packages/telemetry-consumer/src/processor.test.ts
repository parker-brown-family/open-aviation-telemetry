import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TelemetryReportSchema, type EventEnvelope, type TelemetryReport } from '@oat/shared';
import { RecentStateCache, derive, isNewerThanCached, parseEnvelope } from './processor.js';

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

function envelope(payload = report()): EventEnvelope {
  return {
    event_id: randomUUID(),
    event_type: 'aircraft.telemetry.reported',
    schema_version: 1,
    occurred_at: '2026-08-25T18:32:01.000Z',
    aircraft_id: payload.aircraft_id,
    payload,
  };
}

describe('parseEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    const result = parseEnvelope(JSON.stringify(envelope()));
    expect(result.ok).toBe(true);
  });

  it('rejects a null message body rather than throwing', () => {
    const result = parseEnvelope(null);
    expect(result).toMatchObject({ ok: false, reason: 'empty_message' });
  });

  it('reports invalid JSON as its own failure reason', () => {
    const result = parseEnvelope('{not json');
    expect(result).toMatchObject({ ok: false, reason: 'invalid_json' });
  });

  it('reports a structurally valid but schema-violating message separately', () => {
    const result = parseEnvelope(
      JSON.stringify({ event_type: 'aircraft.telemetry.reported', broken: true }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'schema_violation' });
    if (!result.ok) expect(result.detail.length).toBeGreaterThan(0);
  });

  it('rejects an envelope whose payload fails telemetry validation', () => {
    const bad = { ...envelope(), payload: { ...report(), altitude_ft: 99999 } };
    const result = parseEnvelope(JSON.stringify(bad));
    expect(result).toMatchObject({ ok: false, reason: 'schema_violation' });
  });

  it('accepts a Buffer as well as a string', () => {
    const result = parseEnvelope(Buffer.from(JSON.stringify(envelope())));
    expect(result.ok).toBe(true);
  });
});

describe('RecentStateCache', () => {
  it('returns null for an unseen airframe', () => {
    expect(new RecentStateCache().get('C-GZZZ')).toBeNull();
  });

  it('returns the last report stored for an airframe', () => {
    const cache = new RecentStateCache();
    const r = report();
    cache.set('C-GABC', r);
    expect(cache.get('C-GABC')).toBe(r);
  });

  it('evicts the least recently updated airframe at capacity', () => {
    const cache = new RecentStateCache(2);
    cache.set('C-GAAA', report({ aircraft_id: 'C-GAAA' }));
    cache.set('C-GBBB', report({ aircraft_id: 'C-GBBB' }));
    cache.set('C-GCCC', report({ aircraft_id: 'C-GCCC' }));

    expect(cache.size).toBe(2);
    expect(cache.get('C-GAAA')).toBeNull();
    expect(cache.get('C-GBBB')).not.toBeNull();
    expect(cache.get('C-GCCC')).not.toBeNull();
  });

  it('treats an update as recent use, so a busy airframe is not evicted', () => {
    const cache = new RecentStateCache(2);
    cache.set('C-GAAA', report({ aircraft_id: 'C-GAAA' }));
    cache.set('C-GBBB', report({ aircraft_id: 'C-GBBB' }));
    cache.set('C-GAAA', report({ aircraft_id: 'C-GAAA' })); // used again
    cache.set('C-GCCC', report({ aircraft_id: 'C-GCCC' })); // evicts C-GBBB, not C-GAAA

    expect(cache.get('C-GAAA')).not.toBeNull();
    expect(cache.get('C-GBBB')).toBeNull();
  });
});

describe('isNewerThanCached', () => {
  it('accepts the first report for an airframe', () => {
    expect(isNewerThanCached(report(), null)).toBe(true);
  });

  it('accepts a later report', () => {
    const older = report({ timestamp: '2026-08-25T18:31:00.000Z' });
    expect(isNewerThanCached(report(), older)).toBe(true);
  });

  it('rejects a report older than the cached one', () => {
    const newer = report({ timestamp: '2026-08-25T18:33:00.000Z' });
    expect(isNewerThanCached(report(), newer)).toBe(false);
  });

  it('accepts an identical timestamp, so a redelivery is not treated as regression', () => {
    expect(isNewerThanCached(report(), report())).toBe(true);
  });
});

describe('derive', () => {
  it('produces a flight phase and no anomalies for a nominal report', () => {
    const result = derive(report(), null);
    expect(result.flight_phase).toBe('cruise');
    expect(result.anomalies).toHaveLength(0);
  });

  it('raises an anomaly when the reading is out of limits', () => {
    const result = derive(report({ engine: { temperature_c: 150, rpm: 2350 } }), null);
    expect(result.anomalies.map((a) => a.kind)).toContain('engine_overtemp');
  });

  it('uses the previous report to detect a telemetry gap', () => {
    const previous = report({ timestamp: '2026-08-25T18:25:00.000Z' });
    const result = derive(report(), previous);
    expect(result.anomalies.map((a) => a.kind)).toContain('telemetry_gap');
  });
});
