import {
  AIRCRAFT_TYPES,
  AIRPORTS,
  DEMO_PROFILES,
  OPERATORS,
  SCENARIO_DETAIL,
  THRESHOLDS,
  bearingDeg,
  destinationPoint,
  distanceNm,
  type Alert,
  type AircraftState,
  type ReportRecord,
  type TelemetryReport,
} from '@oat/shared';
import type { DemoStatus, InfrastructureSnapshot, Stats } from './api.js';

/**
 * The bundled sample dataset.
 *
 * This exists for one reason: the client is published as a static page with no
 * API behind it, and an empty dashboard teaches a visitor nothing about the
 * architecture. So the page renders a coherent fleet built from the same
 * reference data — the same airports, aircraft types and thresholds — that the
 * simulator uses.
 *
 * It is NOT live data and it is NOT a recording of a production system. Every
 * screen that shows it says so, permanently, via the data-source banner. See
 * data-source.tsx.
 *
 * Deterministic, so the published page looks the same on every visit.
 */

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = seeded(20260825);
const NOW = Date.parse('2026-08-25T18:32:00.000Z');
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
const registration = (): string =>
  `C-${rand() < 0.5 ? 'F' : 'G'}${LETTERS[Math.floor(rand() * 26)]}${LETTERS[Math.floor(rand() * 26)]}${LETTERS[Math.floor(rand() * 26)]}`;

interface Built {
  aircraft: AircraftState;
  history: TelemetryReport[];
}

/** Builds one airframe partway along a real leg between two of the reference airports. */
function buildAircraft(index: number): Built {
  const type = pick(AIRCRAFT_TYPES);
  const origin = pick(AIRPORTS);
  let destination = pick(AIRPORTS);
  while (destination.iata === origin.iata) destination = pick(AIRPORTS);

  const legNm = distanceNm(origin, destination);
  const progress = 0.15 + rand() * 0.7;
  const heading = bearingDeg(origin, destination);
  const position = destinationPoint(origin, heading, legNm * progress);

  const id = registration();
  const operator = pick(OPERATORS);
  // A couple of airframes are deliberately hot so the alert list is not empty.
  const hot = index === 2 || index === 7;

  const makeReport = (stepsBack: number): TelemetryReport => {
    const backNm = legNm * 0.02 * stepsBack;
    const p = destinationPoint(position, (heading + 180) % 360, backNm);
    return {
      aircraft_id: id,
      timestamp: iso(-stepsBack * 30_000),
      position: {
        latitude: Number(p.latitude.toFixed(5)),
        longitude: Number(p.longitude.toFixed(5)),
      },
      altitude_ft: type.cruise_altitude_ft - Math.round(stepsBack * 40),
      groundspeed_kts: type.cruise_speed_kts - Math.round(rand() * 12),
      heading_deg: Number(heading.toFixed(1)),
      vertical_rate_fpm: 0,
      engine: {
        temperature_c: hot
          ? Number((THRESHOLDS.engineTempCriticalC + 4 - stepsBack * 1.2).toFixed(1))
          : Number((88 + rand() * 6).toFixed(1)),
        rpm: type.nominal_rpm,
      },
      fuel_remaining_kg: Number((type.fuel_capacity_kg * (0.35 + rand() * 0.4)).toFixed(1)),
      source: 'simulated',
    };
  };

  const history = Array.from({ length: 24 }, (_, i) => makeReport(i));
  const latest = history[0] ?? null;

  return {
    aircraft: {
      aircraft_id: id,
      callsign: `${operator.slice(0, 3).toUpperCase()}${100 + index}`,
      registration: id,
      type_icao: type.icao,
      operator,
      status: 'active',
      flight_phase: 'cruise',
      first_seen: iso(-45 * 60_000),
      last_seen: iso(-2000),
      latest,
    },
    history,
  };
}

const built = Array.from({ length: 14 }, (_, i) => buildAircraft(i));
const aircraft = built.map((b) => b.aircraft);
const history: Record<string, TelemetryReport[]> = Object.fromEntries(
  built.map((b) => [b.aircraft.aircraft_id, b.history]),
);

const hotAircraft = [aircraft[2], aircraft[7]].filter((a): a is AircraftState => Boolean(a));

const alerts: Alert[] = hotAircraft.flatMap((a, i) => [
  {
    alert_id: `00000000-0000-4000-8000-00000000000${i}`,
    aircraft_id: a.aircraft_id,
    kind: 'engine_overtemp',
    severity: 'critical',
    message: `Engine temperature ${a.latest?.engine.temperature_c.toFixed(1)}C exceeds critical limit ${THRESHOLDS.engineTempCriticalC}C`,
    detail: {
      temperature_c: a.latest?.engine.temperature_c ?? 0,
      limit_c: THRESHOLDS.engineTempCriticalC,
    },
    created_at: iso(-120_000 - i * 40_000),
    acknowledged_at: null,
  },
  {
    alert_id: `00000000-0000-4000-8000-0000000000a${i}`,
    aircraft_id: a.aircraft_id,
    kind: 'fuel_low',
    severity: 'warning',
    message: `Fuel remaining 180 kg below ${THRESHOLDS.fuelLowKg} kg`,
    detail: { fuel_remaining_kg: 180, limit_kg: THRESHOLDS.fuelLowKg },
    created_at: iso(-420_000 - i * 60_000),
    acknowledged_at: null,
  },
]);

const reports: ReportRecord[] = [
  {
    report_id: '11111111-1111-4111-8111-111111111111',
    aircraft_id: aircraft[0]?.aircraft_id ?? 'C-GABC',
    kind: 'flight_summary',
    status: 'completed',
    attempts: 1,
    requested_at: iso(-300_000),
    completed_at: iso(-296_000),
    error: null,
    payload: {
      aircraft_id: aircraft[0]?.aircraft_id ?? 'C-GABC',
      window_minutes: 60,
      samples: 118,
      first_sample_at: iso(-3_540_000),
      last_sample_at: iso(-300_000),
      distance_nm: 342.7,
      max_altitude_ft: 24000,
      max_groundspeed_kts: 361,
      avg_groundspeed_kts: 338.4,
      max_engine_temp_c: 97.2,
      alerts_in_window: 0,
      generated_at: iso(-296_000),
    },
  },
  {
    report_id: '22222222-2222-4222-8222-222222222222',
    aircraft_id: aircraft[1]?.aircraft_id ?? 'C-GXYZ',
    kind: 'flight_summary',
    status: 'failed',
    attempts: 3,
    requested_at: iso(-600_000),
    completed_at: iso(-585_000),
    error:
      'failed after 3 attempts: Injected failure: report generation was asked to fail for demonstration.',
    payload: null,
  },
];

const stats: Stats = {
  measured: true,
  captured_at: iso(0),
  fleet: {
    aircraft_total: aircraft.length,
    aircraft_active: aircraft.length,
    aircraft_stale: 0,
    aircraft_lost: 0,
    telemetry_rows: 4820,
    telemetry_last_minute: 280,
    alerts_total: alerts.length,
    alerts_critical_last_hour: alerts.filter((a) => a.severity === 'critical').length,
    reports_pending: 0,
    reports_completed: 1,
    reports_failed: 1,
  },
  stream: {
    topic: 'aircraft.telemetry.v1',
    consumer_group: 'telemetry-processors',
    connected: true,
    lag: {
      total_lag: 12,
      partitions: [
        { partition: 0, lag: 4 },
        { partition: 1, lag: 5 },
        { partition: 2, lag: 3 },
      ],
    },
  },
  jobs: {
    queue: 'aircraft.report.generate',
    connected: true,
    depth: { pending: 0, dead_lettered: 1 },
  },
  api: {
    uptime_seconds: 2714,
    counters: {
      http_requests: 5382,
      http_errors: 0,
      telemetry_accepted: 4820,
      telemetry_rejected: 0,
      kafka_events_published: 4820,
      reports_requested: 2,
    },
    gauges: {},
    request_latency_ms: { count: 5382, p50: 3.1, p95: 11.4, p99: 24.8 },
  },
  thresholds: THRESHOLDS as unknown as Record<string, number>,
};

const infrastructure: InfrastructureSnapshot = {
  data_source: 'mock',
  simulated: true,
  disclaimer:
    'SIMULATED. No AWS account is attached to this page. These infrastructure figures ' +
    'are static placeholders that describe what the Terraform in this repository would ' +
    'create, not a reading of deployed resources.',
  region: 'ca-central-1',
  captured_at: iso(0),
  components: [
    {
      id: 'eks',
      label: 'Kubernetes cluster',
      aws_service: 'Amazon EKS',
      status: 'not_deployed',
      facts: {
        cluster_name: 'oat-demo',
        kubernetes_version: '1.31',
        desired_nodes: 2,
        availability_zones: 2,
      },
      note: 'Defined in infra/terraform/modules/eks.',
    },
    {
      id: 'rds',
      label: 'Relational database',
      aws_service: 'Amazon RDS for PostgreSQL',
      status: 'not_deployed',
      facts: {
        engine_version: '16.4',
        instance_class: 'db.t4g.micro',
        publicly_accessible: 'false',
      },
      note: 'Local runs use a PostgreSQL container.',
    },
    {
      id: 'msk',
      label: 'Event stream',
      aws_service: 'Amazon MSK Serverless',
      status: 'not_deployed',
      facts: { auth: 'IAM (SASL/OAUTHBEARER)', topic: 'aircraft.telemetry.v1' },
      note: 'Local runs use a Kafka container in KRaft mode.',
    },
    {
      id: 'mq',
      label: 'Job queue',
      aws_service: 'Amazon MQ for RabbitMQ',
      status: 'not_deployed',
      facts: { deployment_mode: 'SINGLE_INSTANCE (demo) / CLUSTER_MULTI_AZ (production)' },
      note: 'Local runs use a RabbitMQ container.',
    },
    {
      id: 'ecr',
      label: 'Container registry',
      aws_service: 'Amazon ECR',
      status: 'not_deployed',
      facts: { repositories: 5, scan_on_push: 'true' },
    },
    {
      id: 'cloudwatch',
      label: 'Logs and metrics',
      aws_service: 'Amazon CloudWatch',
      status: 'not_deployed',
      facts: { log_groups: 5, retention_days: 14 },
      note: 'Services emit structured JSON logs and Prometheus metrics regardless of where they run.',
    },
  ],
};

const demoStatus: DemoStatus = {
  state: {
    running: true,
    profile: 'calm',
    fleet_size: aircraft.length,
    interval_ms: DEMO_PROFILES.calm.interval_ms,
    started_at: iso(-2_700_000),
    active_injections: [],
    generation: 1,
  },
  profiles: DEMO_PROFILES,
  scenarios: SCENARIO_DETAIL,
};

export const SAMPLE = {
  aircraft,
  history,
  alerts,
  reports,
  stats,
  infrastructure,
  demoStatus,
} as const;
