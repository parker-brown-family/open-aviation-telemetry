import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type {
  Alert,
  AlertKind,
  AlertSeverity,
  AircraftState,
  FlightSummary,
  ReportKind,
  ReportRecord,
  ReportStatus,
  TelemetryReport,
} from '@oat/shared';
import { deriveFlightPhase, deriveStatus } from '@oat/shared';

const { Pool } = pg;

/**
 * One data layer, shared by the API, the stream processor and the worker.
 *
 * These three services are one bounded context over one database — the split is
 * by *workload* (synchronous request handling, stream processing, background
 * jobs), not by domain. Giving each its own copy of this SQL would guarantee
 * they drift; see docs/adr/0003-postgresql-on-rds.md.
 *
 * PostgreSQL is reached through hand-written SQL rather than an ORM. The queries
 * here are the interesting part of the data layer — the upsert-on-conflict, the
 * natural-key insert that absorbs replays, the alert suppression window — and an
 * ORM would hide exactly those decisions behind generated SQL.
 */
export type Db = pg.Pool;

/** The minimum a caller has to provide to log migration progress. */
export interface MigrationLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

export interface PoolOptions {
  connectionString: string;
  max?: number;
  /** 'require' for RDS, 'disable' for a local container. */
  ssl?: 'require' | 'disable';
  /** Shows up in pg_stat_activity, which is how you tell which service is holding a connection. */
  applicationName: string;
}

export function createPool(options: PoolOptions): Db {
  return new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    // RDS presents a certificate from the Amazon RDS CA. In a hardened
    // deployment the CA bundle is mounted and rejectUnauthorized stays true;
    // see docs/aws-deployment.md.
    ssl: options.ssl === 'require' ? { rejectUnauthorized: false } : false,
    application_name: options.applicationName,
  });
}

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

/**
 * Applies any migration file not yet recorded, in filename order, each inside a
 * transaction with the ledger write. A crash mid-migration therefore leaves the
 * schema and the ledger consistent with each other.
 *
 * Running this in-process is a deliberate simplification for a single-writer
 * reference deployment. The Helm chart runs it instead as a pre-upgrade Job so
 * that N replicas do not race; see charts/open-aviation-telemetry/templates/migration-job.yaml.
 */
export async function runMigrations(db: Db, log: MigrationLogger): Promise<void> {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log.info({ migration: file }, 'applied migration');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface AircraftRow {
  aircraft_id: string;
  callsign: string | null;
  registration: string | null;
  type_icao: string | null;
  operator: string | null;
  flight_phase: string;
  first_seen: Date;
  last_seen: Date;
  ts: Date | null;
  latitude: number | null;
  longitude: number | null;
  altitude_ft: number | null;
  groundspeed_kts: number | null;
  heading_deg: number | null;
  vertical_rate_fpm: number | null;
  engine_temperature_c: number | null;
  engine_rpm: number | null;
  fuel_remaining_kg: number | null;
  source: string | null;
}

function toAircraftState(row: AircraftRow, nowMs: number): AircraftState {
  const latest: TelemetryReport | null =
    row.ts === null
      ? null
      : {
          aircraft_id: row.aircraft_id,
          timestamp: row.ts.toISOString(),
          position: { latitude: Number(row.latitude), longitude: Number(row.longitude) },
          altitude_ft: Number(row.altitude_ft),
          groundspeed_kts: Number(row.groundspeed_kts),
          heading_deg: Number(row.heading_deg),
          vertical_rate_fpm: Number(row.vertical_rate_fpm ?? 0),
          engine: {
            temperature_c: Number(row.engine_temperature_c),
            rpm: Number(row.engine_rpm),
          },
          ...(row.fuel_remaining_kg === null
            ? {}
            : { fuel_remaining_kg: Number(row.fuel_remaining_kg) }),
          source: (row.source ?? 'simulated') as TelemetryReport['source'],
        };

  return {
    aircraft_id: row.aircraft_id,
    callsign: row.callsign,
    registration: row.registration,
    type_icao: row.type_icao,
    operator: row.operator,
    status: deriveStatus(row.last_seen.toISOString(), nowMs),
    flight_phase: row.flight_phase as AircraftState['flight_phase'],
    first_seen: row.first_seen.toISOString(),
    last_seen: row.last_seen.toISOString(),
    latest,
  };
}

const AIRCRAFT_SELECT = `
  SELECT a.aircraft_id, a.callsign, a.registration, a.type_icao, a.operator,
         a.flight_phase, a.first_seen, a.last_seen,
         t.ts, t.latitude, t.longitude, t.altitude_ft, t.groundspeed_kts,
         t.heading_deg, t.vertical_rate_fpm, t.engine_temperature_c,
         t.engine_rpm, t.fuel_remaining_kg, t.source
    FROM aircraft a
    LEFT JOIN telemetry_latest t ON t.aircraft_id = a.aircraft_id
`;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface AircraftIdentity {
  callsign?: string | null;
  registration?: string | null;
  type_icao?: string | null;
  operator?: string | null;
}

/**
 * Records a report as the current state of an airframe.
 *
 * Deliberately does NOT write history — that is the stream processor's job,
 * downstream of Kafka. The ingest path stays as short as it can be: validate,
 * write current state, publish, return.
 */
export async function upsertLatest(
  db: Db,
  report: TelemetryReport,
  identity: AircraftIdentity = {},
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO aircraft (aircraft_id, callsign, registration, type_icao, operator, flight_phase, last_seen)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (aircraft_id) DO UPDATE
              SET callsign     = COALESCE(EXCLUDED.callsign, aircraft.callsign),
                  registration = COALESCE(EXCLUDED.registration, aircraft.registration),
                  type_icao    = COALESCE(EXCLUDED.type_icao, aircraft.type_icao),
                  operator     = COALESCE(EXCLUDED.operator, aircraft.operator),
                  flight_phase = EXCLUDED.flight_phase,
                  last_seen    = GREATEST(aircraft.last_seen, EXCLUDED.last_seen)`,
      [
        report.aircraft_id,
        identity.callsign ?? null,
        identity.registration ?? null,
        identity.type_icao ?? null,
        identity.operator ?? null,
        deriveFlightPhase(report),
        report.timestamp,
      ],
    );

    // Guard against an out-of-order report overwriting a newer position.
    await client.query(
      `INSERT INTO telemetry_latest (aircraft_id, ts, latitude, longitude, altitude_ft,
                                     groundspeed_kts, heading_deg, vertical_rate_fpm,
                                     engine_temperature_c, engine_rpm, fuel_remaining_kg, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (aircraft_id) DO UPDATE
              SET ts = EXCLUDED.ts, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
                  altitude_ft = EXCLUDED.altitude_ft, groundspeed_kts = EXCLUDED.groundspeed_kts,
                  heading_deg = EXCLUDED.heading_deg, vertical_rate_fpm = EXCLUDED.vertical_rate_fpm,
                  engine_temperature_c = EXCLUDED.engine_temperature_c,
                  engine_rpm = EXCLUDED.engine_rpm, fuel_remaining_kg = EXCLUDED.fuel_remaining_kg,
                  source = EXCLUDED.source, received_at = now()
            WHERE telemetry_latest.ts <= EXCLUDED.ts`,
      [
        report.aircraft_id,
        report.timestamp,
        report.position.latitude,
        report.position.longitude,
        report.altitude_ft,
        report.groundspeed_kts,
        report.heading_deg,
        report.vertical_rate_fpm,
        report.engine.temperature_c,
        report.engine.rpm,
        report.fuel_remaining_kg ?? null,
        report.source,
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Appends to history. The natural key makes a redelivered event a no-op rather
 * than a duplicate row — the second half of at-least-once safety, alongside the
 * processed_events ledger.
 *
 * Returns true when the row was new.
 */
export async function insertHistory(db: Db, report: TelemetryReport): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO telemetry_history (aircraft_id, ts, latitude, longitude, altitude_ft,
                                    groundspeed_kts, heading_deg, vertical_rate_fpm,
                                    engine_temperature_c, engine_rpm, fuel_remaining_kg, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT ON CONSTRAINT telemetry_history_natural_key DO NOTHING`,
    [
      report.aircraft_id,
      report.timestamp,
      report.position.latitude,
      report.position.longitude,
      report.altitude_ft,
      report.groundspeed_kts,
      report.heading_deg,
      report.vertical_rate_fpm,
      report.engine.temperature_c,
      report.engine.rpm,
      report.fuel_remaining_kg ?? null,
      report.source,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Records an event id. Returns false if this event was already processed. */
export async function claimEvent(db: Db, eventId: string): Promise<boolean> {
  const result = await db.query(
    'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING',
    [eventId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** How long an identical alert is suppressed before it can fire again. */
export const ALERT_SUPPRESSION_MS = 60_000;

/**
 * Writes an alert unless the same aircraft already raised the same kind inside
 * the suppression window. Without this, a sustained over-temperature produces
 * one alert per telemetry report and buries every other signal on the page.
 */
export async function insertAlertSuppressed(
  db: Db,
  alert: {
    aircraft_id: string;
    kind: AlertKind;
    severity: AlertSeverity;
    message: string;
    detail: Record<string, unknown>;
  },
): Promise<string | null> {
  const recent = await db.query(
    `SELECT 1 FROM alerts
      WHERE aircraft_id = $1 AND kind = $2
        AND created_at > now() - ($3::bigint * interval '1 millisecond')
      LIMIT 1`,
    [alert.aircraft_id, alert.kind, ALERT_SUPPRESSION_MS],
  );
  if ((recent.rowCount ?? 0) > 0) return null;

  const alertId = randomUUID();
  await db.query(
    `INSERT INTO alerts (alert_id, aircraft_id, kind, severity, message, detail)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      alertId,
      alert.aircraft_id,
      alert.kind,
      alert.severity,
      alert.message,
      JSON.stringify(alert.detail),
    ],
  );
  return alertId;
}

export async function updateFlightPhase(db: Db, aircraftId: string, phase: string): Promise<void> {
  await db.query('UPDATE aircraft SET flight_phase = $2 WHERE aircraft_id = $1', [
    aircraftId,
    phase,
  ]);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listAircraft(db: Db, limit = 500): Promise<AircraftState[]> {
  const { rows } = await db.query<AircraftRow>(
    `${AIRCRAFT_SELECT} ORDER BY a.last_seen DESC LIMIT $1`,
    [limit],
  );
  const now = Date.now();
  return rows.map((r) => toAircraftState(r, now));
}

export async function getAircraft(db: Db, aircraftId: string): Promise<AircraftState | null> {
  const { rows } = await db.query<AircraftRow>(`${AIRCRAFT_SELECT} WHERE a.aircraft_id = $1`, [
    aircraftId,
  ]);
  const row = rows[0];
  return row ? toAircraftState(row, Date.now()) : null;
}

export async function getHistory(
  db: Db,
  aircraftId: string,
  limit = 200,
): Promise<TelemetryReport[]> {
  const { rows } = await db.query(
    `SELECT aircraft_id, ts, latitude, longitude, altitude_ft, groundspeed_kts, heading_deg,
            vertical_rate_fpm, engine_temperature_c, engine_rpm, fuel_remaining_kg, source
       FROM telemetry_history
      WHERE aircraft_id = $1
      ORDER BY ts DESC
      LIMIT $2`,
    [aircraftId, limit],
  );
  return rows.map((r) => ({
    aircraft_id: r.aircraft_id,
    timestamp: r.ts.toISOString(),
    position: { latitude: Number(r.latitude), longitude: Number(r.longitude) },
    altitude_ft: Number(r.altitude_ft),
    groundspeed_kts: Number(r.groundspeed_kts),
    heading_deg: Number(r.heading_deg),
    vertical_rate_fpm: Number(r.vertical_rate_fpm ?? 0),
    engine: { temperature_c: Number(r.engine_temperature_c), rpm: Number(r.engine_rpm) },
    ...(r.fuel_remaining_kg === null ? {} : { fuel_remaining_kg: Number(r.fuel_remaining_kg) }),
    source: (r.source ?? 'simulated') as TelemetryReport['source'],
  }));
}

/** Telemetry inside a time window, oldest first — the input to a flight summary. */
export async function getHistoryWindow(
  db: Db,
  aircraftId: string,
  windowMinutes: number,
): Promise<TelemetryReport[]> {
  const { rows } = await db.query(
    `SELECT aircraft_id, ts, latitude, longitude, altitude_ft, groundspeed_kts, heading_deg,
            vertical_rate_fpm, engine_temperature_c, engine_rpm, fuel_remaining_kg, source
       FROM telemetry_history
      WHERE aircraft_id = $1
        AND ts > now() - ($2::int * interval '1 minute')
      ORDER BY ts ASC`,
    [aircraftId, windowMinutes],
  );
  return rows.map((r) => ({
    aircraft_id: r.aircraft_id,
    timestamp: r.ts.toISOString(),
    position: { latitude: Number(r.latitude), longitude: Number(r.longitude) },
    altitude_ft: Number(r.altitude_ft),
    groundspeed_kts: Number(r.groundspeed_kts),
    heading_deg: Number(r.heading_deg),
    vertical_rate_fpm: Number(r.vertical_rate_fpm ?? 0),
    engine: { temperature_c: Number(r.engine_temperature_c), rpm: Number(r.engine_rpm) },
    ...(r.fuel_remaining_kg === null ? {} : { fuel_remaining_kg: Number(r.fuel_remaining_kg) }),
    source: (r.source ?? 'simulated') as TelemetryReport['source'],
  }));
}

export async function listAlerts(
  db: Db,
  opts: { limit?: number; aircraftId?: string } = {},
): Promise<Alert[]> {
  const limit = opts.limit ?? 100;
  const { rows } = opts.aircraftId
    ? await db.query(
        `SELECT * FROM alerts WHERE aircraft_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [opts.aircraftId, limit],
      )
    : await db.query(`SELECT * FROM alerts ORDER BY created_at DESC LIMIT $1`, [limit]);

  return rows.map((r) => ({
    alert_id: r.alert_id,
    aircraft_id: r.aircraft_id,
    kind: r.kind,
    severity: r.severity,
    message: r.message,
    detail: r.detail ?? {},
    created_at: r.created_at.toISOString(),
    acknowledged_at: r.acknowledged_at ? r.acknowledged_at.toISOString() : null,
  }));
}

export async function countAlertsInWindow(
  db: Db,
  aircraftId: string,
  windowMinutes: number,
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM alerts
      WHERE aircraft_id = $1 AND created_at > now() - ($2::int * interval '1 minute')`,
    [aircraftId, windowMinutes],
  );
  return Number(rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function createReport(
  db: Db,
  args: { reportId: string; aircraftId: string; kind: ReportKind; windowMinutes: number },
): Promise<void> {
  await db.query(
    `INSERT INTO reports (report_id, aircraft_id, kind, status, window_minutes)
          VALUES ($1, $2, $3, 'pending', $4)`,
    [args.reportId, args.aircraftId, args.kind, args.windowMinutes],
  );
}

export async function markReport(
  db: Db,
  reportId: string,
  status: ReportStatus,
  opts: { error?: string | null; payload?: FlightSummary | null; incrementAttempt?: boolean } = {},
): Promise<void> {
  await db.query(
    `UPDATE reports
        SET status       = $2,
            attempts     = attempts + $3,
            error        = $4,
            payload      = $5::jsonb,
            completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN now() ELSE completed_at END
      WHERE report_id = $1`,
    [
      reportId,
      status,
      opts.incrementAttempt ? 1 : 0,
      opts.error ?? null,
      opts.payload ? JSON.stringify(opts.payload) : null,
    ],
  );
}

export async function getReport(db: Db, reportId: string): Promise<ReportRecord | null> {
  const { rows } = await db.query('SELECT * FROM reports WHERE report_id = $1', [reportId]);
  const r = rows[0];
  if (!r) return null;
  return {
    report_id: r.report_id,
    aircraft_id: r.aircraft_id,
    kind: r.kind,
    status: r.status,
    attempts: r.attempts,
    requested_at: r.requested_at.toISOString(),
    completed_at: r.completed_at ? r.completed_at.toISOString() : null,
    error: r.error,
    payload: r.payload,
  };
}

export async function listReports(db: Db, limit = 50): Promise<ReportRecord[]> {
  const { rows } = await db.query('SELECT * FROM reports ORDER BY requested_at DESC LIMIT $1', [
    limit,
  ]);
  return rows.map((r) => ({
    report_id: r.report_id,
    aircraft_id: r.aircraft_id,
    kind: r.kind,
    status: r.status,
    attempts: r.attempts,
    requested_at: r.requested_at.toISOString(),
    completed_at: r.completed_at ? r.completed_at.toISOString() : null,
    error: r.error,
    payload: r.payload,
  }));
}

// ---------------------------------------------------------------------------
// Fleet-level aggregates
// ---------------------------------------------------------------------------

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

/** One round trip for the whole dashboard header, rather than eight. */
export async function fleetStats(db: Db): Promise<FleetStats> {
  const { rows } = await db.query<Record<string, string>>(`
    SELECT
      (SELECT count(*) FROM aircraft)::text AS aircraft_total,
      (SELECT count(*) FROM aircraft WHERE last_seen > now() - interval '120 seconds')::text AS aircraft_active,
      (SELECT count(*) FROM aircraft WHERE last_seen <= now() - interval '120 seconds'
                                       AND last_seen > now() - interval '600 seconds')::text AS aircraft_stale,
      (SELECT count(*) FROM aircraft WHERE last_seen <= now() - interval '600 seconds')::text AS aircraft_lost,
      (SELECT count(*) FROM telemetry_history)::text AS telemetry_rows,
      (SELECT count(*) FROM telemetry_history WHERE recorded_at > now() - interval '60 seconds')::text AS telemetry_last_minute,
      (SELECT count(*) FROM alerts)::text AS alerts_total,
      (SELECT count(*) FROM alerts WHERE severity = 'critical' AND created_at > now() - interval '1 hour')::text AS alerts_critical_last_hour,
      (SELECT count(*) FROM reports WHERE status IN ('pending', 'running'))::text AS reports_pending,
      (SELECT count(*) FROM reports WHERE status = 'completed')::text AS reports_completed,
      (SELECT count(*) FROM reports WHERE status = 'failed')::text AS reports_failed
  `);
  const r = rows[0] ?? {};
  const n = (k: string): number => Number(r[k] ?? 0);
  return {
    aircraft_total: n('aircraft_total'),
    aircraft_active: n('aircraft_active'),
    aircraft_stale: n('aircraft_stale'),
    aircraft_lost: n('aircraft_lost'),
    telemetry_rows: n('telemetry_rows'),
    telemetry_last_minute: n('telemetry_last_minute'),
    alerts_total: n('alerts_total'),
    alerts_critical_last_hour: n('alerts_critical_last_hour'),
    reports_pending: n('reports_pending'),
    reports_completed: n('reports_completed'),
    reports_failed: n('reports_failed'),
  };
}

/** Wipes fleet data for a clean demo run. Never exposed outside the demo routes. */
export async function resetFleetData(db: Db): Promise<void> {
  await db.query(
    'TRUNCATE telemetry_history, telemetry_latest, alerts, reports, processed_events, aircraft RESTART IDENTITY CASCADE',
  );
}
