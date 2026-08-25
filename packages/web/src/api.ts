import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Alert,
  AircraftState,
  DemoProfileName,
  DemoState,
  ReportRecord,
  ScenarioDescriptor,
  ScenarioName,
  TelemetryReport,
} from '@oat/shared';

/**
 * The API base URL is injected at build time so the same bundle can be pointed
 * at a local API, a cluster ingress, or a different origin entirely. Empty means
 * "same origin", which is what the dev proxy and the nginx container both use.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      detail = body.message ?? body.error ?? detail;
    } catch {
      // Body was not JSON; the status text is the best we have.
    }
    throw new ApiError(detail, response.status);
  }

  return (await response.json()) as T;
}

export interface FleetStats {
  aircraft_total: number;
  aircraft_active: number;
  aircraft_stale: number;
  aircraft_lost: number;
  telemetry_rows: number;
  telemetry_last_minute: number;
  alerts_total: number;
  alerts_critical_last_hour: number;
  reports_pending: number;
  reports_completed: number;
  reports_failed: number;
}

export interface Stats {
  measured: true;
  captured_at: string;
  fleet: FleetStats;
  stream: {
    topic: string;
    consumer_group: string;
    connected: boolean;
    lag: { total_lag: number; partitions: { partition: number; lag: number }[] } | null;
  };
  jobs: {
    queue: string;
    connected: boolean;
    depth: { pending: number; dead_lettered: number } | null;
  };
  api: {
    uptime_seconds: number;
    counters: Record<string, number>;
    gauges: Record<string, number>;
    request_latency_ms: { count: number; p50: number; p95: number; p99: number };
  };
  thresholds: Record<string, number>;
}

export interface InfrastructureComponent {
  id: string;
  label: string;
  aws_service: string;
  status: 'healthy' | 'degraded' | 'unknown' | 'not_deployed';
  facts: Record<string, string | number>;
  note?: string;
}

export interface InfrastructureSnapshot {
  data_source: 'mock' | 'aws';
  simulated: boolean;
  disclaimer: string;
  region: string;
  captured_at: string;
  components: InfrastructureComponent[];
}

export interface DemoStatus {
  state: DemoState;
  profiles: Record<
    string,
    { name: string; description: string; fleet_size: number; interval_ms: number }
  >;
  scenarios: Record<ScenarioName, ScenarioDescriptor>;
}

export const api = {
  stats: () => request<Stats>('/api/v1/stats'),
  infrastructure: () => request<InfrastructureSnapshot>('/api/v1/infrastructure'),

  aircraft: () => request<{ count: number; aircraft: AircraftState[] }>('/api/v1/aircraft'),
  aircraftById: (id: string) =>
    request<AircraftState>(`/api/v1/aircraft/${encodeURIComponent(id)}`),
  history: (id: string, limit = 120) =>
    request<{ count: number; telemetry: TelemetryReport[] }>(
      `/api/v1/aircraft/${encodeURIComponent(id)}/telemetry?limit=${limit}`,
    ),

  alerts: (limit = 50) =>
    request<{ count: number; alerts: Alert[] }>(`/api/v1/alerts?limit=${limit}`),

  reports: (limit = 25) =>
    request<{ count: number; reports: ReportRecord[] }>(`/api/v1/reports?limit=${limit}`),
  report: (id: string) => request<ReportRecord>(`/api/v1/reports/${id}`),
  requestReport: (aircraftId: string, windowMinutes = 60) =>
    request<{ report_id: string; status: string }>(
      `/api/v1/aircraft/${encodeURIComponent(aircraftId)}/reports`,
      {
        method: 'POST',
        body: JSON.stringify({ kind: 'flight_summary', window_minutes: windowMinutes }),
      },
    ),

  demoStatus: () => request<DemoStatus>('/api/v1/demo/status'),
  demoStart: (profile: DemoProfileName) =>
    request<DemoState>('/api/v1/demo/start', { method: 'POST', body: JSON.stringify({ profile }) }),
  demoStop: () => request<DemoState>('/api/v1/demo/stop', { method: 'POST' }),
  demoReset: () => request<DemoState>('/api/v1/demo/reset', { method: 'POST' }),
  scenario: (name: ScenarioName) =>
    request<{
      scenario: string;
      applied: string;
      expect: string;
      report_id?: string;
      watch?: string;
    }>(`/api/v1/demo/scenario/${name}`, { method: 'POST' }),
};

export interface PollState<T> {
  data: T | null;
  error: string | null;
  /** True until the first response arrives; distinguishes "loading" from "empty". */
  loading: boolean;
  refresh: () => void;
}

/**
 * Polls an endpoint on an interval.
 *
 * Polling rather than websockets is a deliberate choice for this project: the
 * dashboard tolerates a second of staleness, and polling survives a pod restart,
 * a load-balancer reconnect and a laptop lid closing without any reconnection
 * logic. A live air-traffic display would justify the complexity of a push
 * channel; a fleet summary does not.
 */
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs = 2000): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Held in a ref so changing the fetcher identity between renders does not
  // restart the interval on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        const result = await fetcherRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    const timer = setInterval(() => void run(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs, tick]);

  return { data, error, loading, refresh };
}
