import {
  DEMO_PROFILES,
  SCENARIO_DETAIL,
  type ActiveInjection,
  type DemoProfileName,
  type DemoState,
  type ScenarioName,
} from '@oat/shared';
import type { Db } from '@oat/data';

/**
 * Reads and writes the single demo_state row.
 *
 * Every mutation is a full-row UPDATE against id = 1, which means concurrent
 * demo commands resolve to a last-writer-wins outcome rather than a partially
 * applied one. For a control surface driven by one person clicking buttons that
 * is the right trade: simple, and impossible to leave in a torn state.
 */

interface DemoRow {
  running: boolean;
  profile: string;
  fleet_size: number;
  interval_ms: number;
  started_at: Date | null;
  generation: number;
  active_injections: ActiveInjection[];
}

function toState(row: DemoRow): DemoState {
  return {
    running: row.running,
    profile: row.profile as DemoProfileName,
    fleet_size: row.fleet_size,
    interval_ms: row.interval_ms,
    started_at: row.started_at ? row.started_at.toISOString() : null,
    generation: row.generation,
    active_injections: Array.isArray(row.active_injections) ? row.active_injections : [],
  };
}

export async function readDemoState(db: Db): Promise<DemoState> {
  const { rows } = await db.query<DemoRow>('SELECT * FROM demo_state WHERE id = 1');
  const row = rows[0];
  if (!row) throw new Error('demo_state row missing — has migration 002 run?');

  const state = toState(row);
  // Expired injections are pruned on read rather than by a timer, so there is
  // no background job to keep alive and no clock skew between replicas.
  const now = Date.now();
  const live = state.active_injections.filter((i) => Date.parse(i.expires_at) > now);
  if (live.length !== state.active_injections.length) {
    await db.query(
      'UPDATE demo_state SET active_injections = $1::jsonb, updated_at = now() WHERE id = 1',
      [JSON.stringify(live)],
    );
  }
  return { ...state, active_injections: live };
}

export async function startDemo(db: Db, profile: DemoProfileName): Promise<DemoState> {
  const p = DEMO_PROFILES[profile];
  await db.query(
    `UPDATE demo_state
        SET running = true, profile = $1, fleet_size = $2, interval_ms = $3,
            started_at = COALESCE(started_at, now()), updated_at = now()
      WHERE id = 1`,
    [profile, p.fleet_size, p.interval_ms],
  );
  return readDemoState(db);
}

export async function stopDemo(db: Db): Promise<DemoState> {
  await db.query('UPDATE demo_state SET running = false, updated_at = now() WHERE id = 1');
  return readDemoState(db);
}

/**
 * Stops the demo, clears injections and bumps the generation counter. The
 * simulator notices the new generation and rebuilds its fleet from scratch,
 * which is what makes reset produce a genuinely clean run rather than the same
 * aircraft with a gap in their history.
 */
export async function resetDemo(db: Db): Promise<DemoState> {
  await db.query(
    `UPDATE demo_state
        SET running = false, started_at = NULL, active_injections = '[]'::jsonb,
            generation = generation + 1, updated_at = now()
      WHERE id = 1`,
  );
  return readDemoState(db);
}

export async function injectScenario(
  db: Db,
  scenario: ScenarioName,
  aircraftIds: string[],
): Promise<DemoState> {
  const now = Date.now();
  const detail = SCENARIO_DETAIL[scenario];
  const injection: ActiveInjection = {
    scenario,
    aircraft_ids: aircraftIds,
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + detail.duration_ms).toISOString(),
  };

  const current = await readDemoState(db);
  // Re-triggering a scenario replaces the previous injection rather than
  // stacking a second one with a different aircraft set.
  const next = [...current.active_injections.filter((i) => i.scenario !== scenario), injection];

  await db.query(
    'UPDATE demo_state SET active_injections = $1::jsonb, updated_at = now() WHERE id = 1',
    [JSON.stringify(next)],
  );
  return readDemoState(db);
}

export async function clearScenario(db: Db, scenario: ScenarioName): Promise<DemoState> {
  const current = await readDemoState(db);
  const next = current.active_injections.filter((i) => i.scenario !== scenario);
  await db.query(
    'UPDATE demo_state SET active_injections = $1::jsonb, updated_at = now() WHERE id = 1',
    [JSON.stringify(next)],
  );
  return readDemoState(db);
}
