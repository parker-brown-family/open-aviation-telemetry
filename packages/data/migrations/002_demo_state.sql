-- Demo control state.
--
-- This lives in PostgreSQL rather than in the API process on purpose. The API
-- runs as several replicas behind a load balancer, so in-process demo state
-- would mean the simulator gets a different answer depending on which pod it
-- happened to reach. One row in the database is the cheapest correct shared
-- state, and it survives a pod restart mid-demonstration.
--
-- The CHECK constraint enforces the singleton: there is exactly one demo.

CREATE TABLE IF NOT EXISTS demo_state (
    id                smallint PRIMARY KEY DEFAULT 1,
    running           boolean     NOT NULL DEFAULT false,
    profile           text        NOT NULL DEFAULT 'calm',
    fleet_size        integer     NOT NULL DEFAULT 10,
    interval_ms       integer     NOT NULL DEFAULT 3000,
    started_at        timestamptz,
    generation        integer     NOT NULL DEFAULT 1,
    active_injections jsonb       NOT NULL DEFAULT '[]'::jsonb,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT demo_state_singleton CHECK (id = 1)
);

INSERT INTO demo_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
