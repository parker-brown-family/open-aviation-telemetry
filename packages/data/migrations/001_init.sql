-- Schema for the aircraft telemetry platform.
--
-- Design notes:
--   * telemetry_latest is a single row per airframe, updated in place. It is what
--     the fleet view reads, so that view never scans history.
--   * telemetry_history is append-only, with a natural key on (aircraft_id, ts) so
--     replayed Kafka events collide instead of duplicating.
--   * processed_events is the idempotency ledger for at-least-once delivery.

CREATE TABLE IF NOT EXISTS aircraft (
    aircraft_id   text PRIMARY KEY,
    callsign      text,
    registration  text,
    type_icao     text,
    operator      text,
    flight_phase  text        NOT NULL DEFAULT 'unknown',
    first_seen    timestamptz NOT NULL DEFAULT now(),
    last_seen     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry_latest (
    aircraft_id          text PRIMARY KEY REFERENCES aircraft (aircraft_id) ON DELETE CASCADE,
    ts                   timestamptz      NOT NULL,
    latitude             double precision NOT NULL,
    longitude            double precision NOT NULL,
    altitude_ft          double precision NOT NULL,
    groundspeed_kts      double precision NOT NULL,
    heading_deg          double precision NOT NULL,
    vertical_rate_fpm    double precision NOT NULL DEFAULT 0,
    engine_temperature_c double precision NOT NULL,
    engine_rpm           double precision NOT NULL,
    fuel_remaining_kg    double precision,
    source               text             NOT NULL DEFAULT 'simulated',
    received_at          timestamptz      NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry_history (
    id                   bigserial PRIMARY KEY,
    aircraft_id          text             NOT NULL,
    ts                   timestamptz      NOT NULL,
    latitude             double precision NOT NULL,
    longitude            double precision NOT NULL,
    altitude_ft          double precision NOT NULL,
    groundspeed_kts      double precision NOT NULL,
    heading_deg          double precision NOT NULL,
    vertical_rate_fpm    double precision NOT NULL DEFAULT 0,
    engine_temperature_c double precision NOT NULL,
    engine_rpm           double precision NOT NULL,
    fuel_remaining_kg    double precision,
    source               text             NOT NULL DEFAULT 'simulated',
    recorded_at          timestamptz      NOT NULL DEFAULT now(),
    CONSTRAINT telemetry_history_natural_key UNIQUE (aircraft_id, ts)
);

CREATE INDEX IF NOT EXISTS telemetry_history_aircraft_ts_idx
    ON telemetry_history (aircraft_id, ts DESC);

CREATE TABLE IF NOT EXISTS alerts (
    alert_id        uuid PRIMARY KEY,
    aircraft_id     text        NOT NULL,
    kind            text        NOT NULL,
    severity        text        NOT NULL,
    message         text        NOT NULL,
    detail          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz
);

CREATE INDEX IF NOT EXISTS alerts_created_at_idx ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_dedupe_idx ON alerts (aircraft_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
    report_id      uuid PRIMARY KEY,
    aircraft_id    text        NOT NULL,
    kind           text        NOT NULL,
    status         text        NOT NULL,
    attempts       integer     NOT NULL DEFAULT 0,
    window_minutes integer     NOT NULL DEFAULT 60,
    requested_at   timestamptz NOT NULL DEFAULT now(),
    completed_at   timestamptz,
    error          text,
    payload        jsonb
);

CREATE INDEX IF NOT EXISTS reports_aircraft_idx ON reports (aircraft_id, requested_at DESC);

-- The idempotency ledger. A replayed Kafka event whose id is already here is
-- acknowledged and skipped, so at-least-once delivery cannot double-count.
CREATE TABLE IF NOT EXISTS processed_events (
    event_id     uuid PRIMARY KEY,
    processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processed_events_processed_at_idx
    ON processed_events (processed_at);
