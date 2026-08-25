import { beforeAll, describe, expect, it } from 'vitest';
import type { AircraftState, Alert, ReportRecord, TelemetryReport } from '@oat/shared';
import {
  BASE_URL,
  TELEMETRY_TOPIC,
  call,
  eventually,
  expectOk,
  telemetry,
  uniqueAircraftId,
} from './helpers.js';

/**
 * End-to-end tests against a running stack.
 *
 * These are the tests that prove the architecture rather than the code: each one
 * asserts something that can only be true if a message actually crossed a broker
 * and a separate process handled it. They talk to the system over HTTP only,
 * with no database or broker client of their own, so there is no way to satisfy
 * an assertion except by the real path running.
 *
 * Start the stack first:  make demo
 * Then:                   make e2e
 */

interface Ready {
  ready: boolean;
  dependencies: Record<string, { ready: boolean; error: string | null }>;
}

interface Stats {
  fleet: { aircraft_total: number; telemetry_rows: number };
  stream: { topic: string; connected: boolean; lag: { total_lag: number } | null };
  jobs: { connected: boolean; depth: { pending: number; dead_lettered: number } | null };
  api: { counters: Record<string, number> };
}

beforeAll(async () => {
  const ready = await eventually<Ready>(
    'the stack to report ready',
    () => expectOk<Ready>('/ready'),
    (r) => r.ready === true,
    { timeoutMs: 90_000, intervalMs: 1000 },
  );
  expect(ready.ready, `stack not ready: ${JSON.stringify(ready.dependencies)}`).toBe(true);
}, 100_000);

describe('service health', () => {
  it('reports every dependency connected', async () => {
    const ready = await expectOk<Ready>('/ready');
    expect(ready.dependencies.database?.ready).toBe(true);
    expect(ready.dependencies.kafka?.ready).toBe(true);
    expect(ready.dependencies.rabbitmq?.ready).toBe(true);
  });

  it('serves an OpenAPI document generated from the routes', async () => {
    const doc = await expectOk<{ paths: Record<string, unknown>; openapi: string }>('/docs/json');
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toContain('/api/v1/telemetry');
    expect(Object.keys(doc.paths)).toContain('/api/v1/aircraft/{aircraft_id}/reports');
  });

  it('exposes Prometheus metrics', async () => {
    const response = await fetch(`${BASE_URL}/metrics`);
    const text = await response.text();
    expect(response.headers.get('content-type')).toMatch(/text\/plain/);
    expect(text).toMatch(/oat_http_requests_total \d+/);
    expect(text).toMatch(/oat_http_request_duration_ms_bucket/);
  });
});

describe('ingest validation', () => {
  it('rejects a malformed report with the offending field named', async () => {
    const { status, body } = await call<{ error: string; issues: { path: string }[] }>(
      '/api/v1/telemetry',
      {
        method: 'POST',
        body: JSON.stringify({
          aircraft_id: 'C-GBAD',
          timestamp: 'not-a-timestamp',
          position: { latitude: 999, longitude: 0 },
        }),
      },
    );

    expect(status).toBe(400);
    expect(body.error).toBe('invalid_telemetry');
    const paths = body.issues.map((i) => i.path);
    expect(paths).toContain('timestamp');
    expect(paths).toContain('position.latitude');
  });

  it('rejects an aircraft id that is not canonical', async () => {
    const { status } = await call('/api/v1/telemetry', {
      method: 'POST',
      body: JSON.stringify(telemetry('lowercase-id')),
    });
    expect(status).toBe(400);
  });

  it('does not create an aircraft for a rejected report', async () => {
    const id = uniqueAircraftId('BAD');
    await call('/api/v1/telemetry', {
      method: 'POST',
      body: JSON.stringify(telemetry(id, { altitude_ft: 99_999 })),
    });

    const { status } = await call(`/api/v1/aircraft/${id}`);
    expect(status).toBe(404);
  });
});

describe('the telemetry pipeline', () => {
  const aircraftId = uniqueAircraftId('PIPE');

  it('accepts a report and returns the published event id', async () => {
    const accepted = await expectOk<{ accepted: boolean; event_id: string; topic: string }>(
      '/api/v1/telemetry',
      {
        method: 'POST',
        body: JSON.stringify({
          ...telemetry(aircraftId),
          identity: { callsign: 'E2E001', type_icao: 'DH8D', operator: 'End To End Air' },
        }),
      },
    );

    expect(accepted.accepted).toBe(true);
    expect(accepted.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(accepted.topic).toBe(TELEMETRY_TOPIC);
  });

  it('projects the aircraft into current state, with its identity', async () => {
    const aircraft = await eventually<AircraftState>(
      'the aircraft to appear in current state',
      () => expectOk<AircraftState>(`/api/v1/aircraft/${aircraftId}`),
      (a) => a.aircraft_id === aircraftId,
    );

    expect(aircraft.callsign).toBe('E2E001');
    expect(aircraft.operator).toBe('End To End Air');
    expect(aircraft.status).toBe('active');
    expect(aircraft.latest?.altitude_ft).toBe(24000);
  });

  it('derives flight phase rather than taking it from the report', async () => {
    // Nothing in the payload says "cruise" — the platform works it out.
    const aircraft = await expectOk<AircraftState>(`/api/v1/aircraft/${aircraftId}`);
    expect(aircraft.flight_phase).toBe('cruise');
  });

  it('writes history, which only the Kafka consumer does', async () => {
    // The API never writes telemetry_history. A row here therefore proves the
    // event crossed the broker and a separate process handled it.
    const history = await eventually<{ count: number; telemetry: TelemetryReport[] }>(
      'history to be written by the stream processor',
      () =>
        expectOk<{ count: number; telemetry: TelemetryReport[] }>(
          `/api/v1/aircraft/${aircraftId}/telemetry`,
        ),
      (h) => h.count > 0,
    );

    expect(history.count).toBeGreaterThan(0);
    expect(history.telemetry[0]?.aircraft_id).toBe(aircraftId);
  });

  it('does not double-count a report sent twice with the same timestamp', async () => {
    const id = uniqueAircraftId('DUP');
    const fixed = telemetry(id, { timestamp: new Date().toISOString() });

    await expectOk('/api/v1/telemetry', { method: 'POST', body: JSON.stringify(fixed) });
    await eventually(
      'the first report to reach history',
      () => expectOk<{ count: number }>(`/api/v1/aircraft/${id}/telemetry`),
      (h) => h.count === 1,
    );

    // Same payload, same timestamp: a retry, not a new observation.
    await expectOk('/api/v1/telemetry', { method: 'POST', body: JSON.stringify(fixed) });

    // Give the consumer time to process it, then confirm nothing was added.
    await new Promise((r) => setTimeout(r, 6000));
    const history = await expectOk<{ count: number }>(`/api/v1/aircraft/${id}/telemetry`);
    expect(history.count).toBe(1);
  });
});

describe('alerting', () => {
  const aircraftId = uniqueAircraftId('ALRT');

  it('raises a critical alert from an out-of-limits reading', async () => {
    await expectOk('/api/v1/telemetry', {
      method: 'POST',
      body: JSON.stringify(telemetry(aircraftId, { engine: { temperature_c: 155, rpm: 2200 } })),
    });

    const alerts = await eventually<{ count: number; alerts: Alert[] }>(
      'an over-temperature alert',
      () =>
        expectOk<{ count: number; alerts: Alert[] }>(`/api/v1/alerts?aircraft_id=${aircraftId}`),
      (a) => a.count > 0,
    );

    const overtemp = alerts.alerts.find((a) => a.kind === 'engine_overtemp');
    expect(overtemp).toBeDefined();
    expect(overtemp?.severity).toBe('critical');
    expect(overtemp?.detail).toMatchObject({ temperature_c: 155 });
  });

  it('suppresses an identical repeated alert rather than one per report', async () => {
    const before = await expectOk<{ count: number }>(`/api/v1/alerts?aircraft_id=${aircraftId}`);

    // Five more over-temperature reports in quick succession.
    for (let i = 0; i < 5; i += 1) {
      await expectOk('/api/v1/telemetry', {
        method: 'POST',
        body: JSON.stringify(telemetry(aircraftId, { engine: { temperature_c: 158, rpm: 2200 } })),
      });
    }
    await new Promise((r) => setTimeout(r, 6000));

    const after = await expectOk<{ count: number }>(`/api/v1/alerts?aircraft_id=${aircraftId}`);
    expect(after.count).toBe(before.count);
  });

  it('does not alert on a nominal report', async () => {
    const id = uniqueAircraftId('OK');
    await expectOk('/api/v1/telemetry', { method: 'POST', body: JSON.stringify(telemetry(id)) });
    await new Promise((r) => setTimeout(r, 5000));

    const alerts = await expectOk<{ count: number }>(`/api/v1/alerts?aircraft_id=${id}`);
    expect(alerts.count).toBe(0);
  });
});

describe('asynchronous report generation', () => {
  const aircraftId = uniqueAircraftId('RPT');

  beforeAll(async () => {
    for (let i = 0; i < 4; i += 1) {
      await expectOk('/api/v1/telemetry', {
        method: 'POST',
        body: JSON.stringify(
          telemetry(aircraftId, {
            timestamp: new Date(Date.now() - (4 - i) * 30_000).toISOString(),
            position: { latitude: 49.9 + i * 0.1, longitude: -119.4 - i * 0.2 },
          }),
        ),
      });
    }
    await eventually(
      'telemetry history for the report window',
      () => expectOk<{ count: number }>(`/api/v1/aircraft/${aircraftId}/telemetry`),
      (h) => h.count >= 4,
    );
  }, 60_000);

  it('returns immediately with a pending report rather than generating inline', async () => {
    const started = Date.now();
    const queued = await expectOk<{ report_id: string; status: string; queue: string }>(
      `/api/v1/aircraft/${aircraftId}/reports`,
      { method: 'POST', body: JSON.stringify({ kind: 'flight_summary', window_minutes: 60 }) },
    );

    expect(queued.status).toBe('pending');
    expect(queued.queue).toBe('aircraft.report.generate');
    // The whole point of the queue: the request does not wait for the work.
    expect(Date.now() - started).toBeLessThan(2000);

    const completed = await eventually<ReportRecord>(
      'the worker to complete the report',
      () => expectOk<ReportRecord>(`/api/v1/reports/${queued.report_id}`),
      (r) => r.status === 'completed' || r.status === 'failed',
    );

    expect(completed.status).toBe('completed');
    expect(completed.payload?.samples).toBeGreaterThanOrEqual(4);
    expect(completed.payload?.distance_nm).toBeGreaterThan(0);
    expect(completed.attempts).toBe(1);
  });

  it('404s for a report that does not exist', async () => {
    const { status } = await call('/api/v1/reports/00000000-0000-4000-8000-000000000000');
    expect(status).toBe(404);
  });

  it('rejects a malformed report id rather than treating it as not found', async () => {
    const { status } = await call('/api/v1/reports/not-a-uuid');
    expect(status).toBe(400);
  });
});

describe('failure handling', () => {
  it('retries a failing job and then dead-letters it', async () => {
    const injected = await expectOk<{ report_id: string; scenario: string }>(
      '/api/v1/demo/scenario/worker_failure',
      { method: 'POST' },
    );
    expect(injected.scenario).toBe('worker_failure');

    const failed = await eventually<ReportRecord>(
      'the job to exhaust its retries',
      () => expectOk<ReportRecord>(`/api/v1/reports/${injected.report_id}`),
      (r) => r.status === 'failed',
      { timeoutMs: 60_000 },
    );

    expect(failed.status).toBe('failed');
    // Three attempts, not one: the delay queue really did return it twice.
    expect(failed.attempts).toBeGreaterThanOrEqual(3);
    expect(failed.error).toMatch(/Injected failure/);
  });

  it('shows the dead-lettered job in the queue depth read from the broker', async () => {
    const stats = await eventually<Stats>(
      'the dead-letter queue to report a message',
      () => expectOk<Stats>('/api/v1/stats'),
      (s) => (s.jobs.depth?.dead_lettered ?? 0) > 0,
    );
    expect(stats.jobs.depth?.dead_lettered).toBeGreaterThan(0);
  });

  it('quarantines a poison event instead of stalling the partition', async () => {
    const before = await expectOk<Stats>('/api/v1/stats');
    await expectOk('/api/v1/demo/scenario/poison_event', { method: 'POST' });

    // The proof that the partition did not stall: a normal report published
    // after the poison message is still processed all the way to history.
    const id = uniqueAircraftId('POISON');
    await expectOk('/api/v1/telemetry', { method: 'POST', body: JSON.stringify(telemetry(id)) });

    const history = await eventually<{ count: number }>(
      'telemetry published after a poison message to still be processed',
      () => expectOk<{ count: number }>(`/api/v1/aircraft/${id}/telemetry`),
      (h) => h.count > 0,
    );
    expect(history.count).toBeGreaterThan(0);
    expect(before.stream.connected).toBe(true);
  });

  it('rejects an unknown scenario name', async () => {
    const { status } = await call('/api/v1/demo/scenario/not-a-scenario', { method: 'POST' });
    expect(status).toBe(400);
  });
});

describe('operational statistics', () => {
  it('reads consumer lag and queue depth from the brokers, not from a guess', async () => {
    const stats = await expectOk<Stats>('/api/v1/stats');

    expect(stats.stream.topic).toBe(TELEMETRY_TOPIC);
    expect(stats.stream.connected).toBe(true);
    expect(stats.stream.lag).not.toBeNull();
    expect(stats.stream.lag?.total_lag).toBeGreaterThanOrEqual(0);

    expect(stats.jobs.connected).toBe(true);
    expect(stats.jobs.depth).not.toBeNull();

    expect(stats.fleet.telemetry_rows).toBeGreaterThan(0);
    expect(stats.api.counters.telemetry_accepted).toBeGreaterThan(0);
  });

  it('labels the infrastructure snapshot as simulated when no AWS account is attached', async () => {
    const infra = await expectOk<{ simulated: boolean; disclaimer: string; data_source: string }>(
      '/api/v1/infrastructure',
    );
    // The honesty contract, asserted: a mock provider must announce itself.
    expect(infra.data_source).toBe('mock');
    expect(infra.simulated).toBe(true);
    expect(infra.disclaimer).toMatch(/SIMULATED/);
  });
});

describe('demo control', () => {
  it('starts, reports and stops the simulator', async () => {
    await expectOk('/api/v1/demo/start', {
      method: 'POST',
      body: JSON.stringify({ profile: 'calm' }),
    });

    const status = await expectOk<{
      state: { running: boolean; profile: string; fleet_size: number };
    }>('/api/v1/demo/status');
    expect(status.state.running).toBe(true);
    expect(status.state.profile).toBe('calm');
    expect(status.state.fleet_size).toBe(10);

    // The simulator should actually put aircraft into the system.
    const fleet = await eventually<{ count: number }>(
      'the simulator to populate the fleet',
      () => expectOk<{ count: number }>('/api/v1/aircraft'),
      (f) => f.count >= 10,
      { timeoutMs: 60_000 },
    );
    expect(fleet.count).toBeGreaterThanOrEqual(10);

    await expectOk('/api/v1/demo/stop', { method: 'POST' });
    const stopped = await expectOk<{ state: { running: boolean } }>('/api/v1/demo/status');
    expect(stopped.state.running).toBe(false);
  }, 90_000);

  it('rejects an unknown profile', async () => {
    const { status } = await call('/api/v1/demo/start', {
      method: 'POST',
      body: JSON.stringify({ profile: 'ludicrous' }),
    });
    expect(status).toBe(400);
  });

  it('accepts a JSON content type with an empty body on an argument-less POST', async () => {
    // A client that always sets content-type: application/json is being
    // reasonable. Fastify's default parser rejects an empty body outright, so
    // the API installs its own — this asserts that it did.
    const { status } = await call('/api/v1/demo/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(status).toBe(200);
  });

  it('returns a specific message on a client error, not a generic one', async () => {
    const { status, body } = await call<{ error: string; message: string }>('/api/v1/demo/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    });
    expect(status).toBe(400);
    // A 4xx is the caller's problem, so the API says what was wrong rather than
    // hiding it behind "internal_error".
    expect(body.error).not.toBe('internal_error');
  });
});
