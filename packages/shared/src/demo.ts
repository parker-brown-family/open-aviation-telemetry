/**
 * Demo control contract.
 *
 * The demo drives the *real* system: the simulator posts to the real API, which
 * writes to the real database and produces to the real broker. Nothing on the
 * dashboard is a fixture. See docs/adr/0007-demo-mode-is-production-shaped.md.
 */

export interface DemoProfile {
  name: string;
  description: string;
  fleet_size: number;
  /** Delay between position reports per airframe. */
  interval_ms: number;
}

export const DEMO_PROFILES = {
  calm: {
    name: 'Calm',
    description: 'Ten aircraft reporting every three seconds. The baseline picture.',
    fleet_size: 10,
    interval_ms: 3000,
  },
  busy: {
    name: 'Busy',
    description: 'One hundred aircraft at a one-second cadence — a realistic regional fleet.',
    fleet_size: 100,
    interval_ms: 1000,
  },
  burst: {
    name: 'Burst',
    description:
      'One hundred aircraft at four reports per second. Pushes consumer lag up so recovery is visible.',
    fleet_size: 100,
    interval_ms: 250,
  },
} as const satisfies Record<string, DemoProfile>;

export type DemoProfileName = keyof typeof DEMO_PROFILES;

export const DEMO_PROFILE_NAMES = Object.keys(DEMO_PROFILES) as DemoProfileName[];

export function isDemoProfileName(value: string): value is DemoProfileName {
  return Object.prototype.hasOwnProperty.call(DEMO_PROFILES, value);
}

/**
 * Fault injections. Each one exists to make a specific architectural behaviour
 * observable during a walkthrough, rather than to be described in the abstract.
 */
export const SCENARIOS = [
  'engine_anomaly',
  'rapid_descent',
  'fuel_low',
  'telemetry_gap',
  'worker_failure',
  'poison_event',
] as const;

export type ScenarioName = (typeof SCENARIOS)[number];

export interface ScenarioDescriptor {
  name: string;
  demonstrates: string;
  expected: string;
  /** How long the injection stays active before clearing itself. */
  duration_ms: number;
}

export const SCENARIO_DETAIL: Record<ScenarioName, ScenarioDescriptor> = {
  engine_anomaly: {
    name: 'Engine over-temperature',
    demonstrates: 'Stream processing turning raw telemetry into a derived alert.',
    expected: 'Affected aircraft report rising engine temperature; critical alerts appear.',
    duration_ms: 90_000,
  },
  rapid_descent: {
    name: 'Rapid descent',
    demonstrates: 'A rule that needs vertical rate, not just position.',
    expected: 'One aircraft descends faster than 3000 fpm and raises a critical alert.',
    duration_ms: 60_000,
  },
  fuel_low: {
    name: 'Low fuel',
    demonstrates: 'An optional telemetry field participating in detection.',
    expected: 'Fuel remaining drops below the advisory limit and raises a warning.',
    duration_ms: 90_000,
  },
  telemetry_gap: {
    name: 'Telemetry gap',
    demonstrates: 'Absence of data being treated as information.',
    expected: 'Selected aircraft stop reporting, go stale, then lost.',
    duration_ms: 180_000,
  },
  worker_failure: {
    name: 'Report worker failure',
    demonstrates: 'RabbitMQ retry and dead-lettering under a failing consumer.',
    expected: 'The next report job fails, retries three times, then lands in the DLQ.',
    duration_ms: 120_000,
  },
  poison_event: {
    name: 'Poison event',
    demonstrates: 'A malformed event that can never succeed, quarantined instead of retried.',
    expected: 'An unparseable event is published; the consumer routes it to the Kafka DLQ.',
    duration_ms: 1000,
  },
};

export interface ActiveInjection {
  scenario: ScenarioName;
  aircraft_ids: string[];
  started_at: string;
  expires_at: string;
}

export interface DemoState {
  running: boolean;
  profile: DemoProfileName;
  fleet_size: number;
  interval_ms: number;
  started_at: string | null;
  active_injections: ActiveInjection[];
  /**
   * Bumped on reset. The simulator watches this and rebuilds its fleet when it
   * changes, which is how a stateless simulator stays in step with the API
   * without a second control channel.
   */
  generation: number;
}

export function initialDemoState(): DemoState {
  return {
    running: false,
    profile: 'calm',
    fleet_size: DEMO_PROFILES.calm.fleet_size,
    interval_ms: DEMO_PROFILES.calm.interval_ms,
    started_at: null,
    active_injections: [],
    generation: 1,
  };
}

export function injectionActive(state: DemoState, scenario: ScenarioName, nowMs: number): boolean {
  return state.active_injections.some(
    (i) => i.scenario === scenario && Date.parse(i.expires_at) > nowMs,
  );
}

export function injectionFor(
  state: DemoState,
  scenario: ScenarioName,
  nowMs: number,
): ActiveInjection | undefined {
  return state.active_injections.find(
    (i) => i.scenario === scenario && Date.parse(i.expires_at) > nowMs,
  );
}

export function pruneExpired(state: DemoState, nowMs: number): DemoState {
  return {
    ...state,
    active_injections: state.active_injections.filter((i) => Date.parse(i.expires_at) > nowMs),
  };
}
