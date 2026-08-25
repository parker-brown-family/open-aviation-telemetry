import { z } from 'zod';
import type { DemoState } from '@oat/shared';
import { HealthServer, Metrics, createLogger, shutdownOn } from '@oat/service-kit';
import { advance, createAircraft, mulberry32, toTelemetry, type SimAircraft } from './aircraft.js';
import { applyInjections } from './injections.js';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8083),
  API_BASE_URL: z.string().default('http://localhost:8080'),
  /** Seed for the fleet generator. Same seed, same fleet, every run. */
  SEED: z.coerce.number().int().default(20260825),
  /** How often demo state is re-read from the API. */
  CONTROL_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2000),
  /** Simultaneous in-flight POSTs. Caps the load the simulator can put on the API. */
  MAX_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(25),
});

const METRIC = {
  reportsSent: 'reports_sent',
  reportsFailed: 'reports_failed',
  reportsSuppressed: 'reports_suppressed',
  controlPolls: 'control_polls',
  controlPollFailures: 'control_poll_failures',
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends an array of tasks with a bounded number in flight at once. */
async function runBounded<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      const task = tasks[index];
      if (task) await task();
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const parsedConfig = ConfigSchema.safeParse(process.env);
  if (!parsedConfig.success) {
    throw new Error(
      `Invalid configuration:\n${parsedConfig.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  const config = parsedConfig.data;

  const log = createLogger({
    service: 'simulator',
    level: config.LOG_LEVEL,
    env: config.NODE_ENV,
    pretty: config.NODE_ENV === 'development',
  });
  const metrics = new Metrics();

  let fleet: SimAircraft[] = [];
  let generation = 0;
  let running = true;
  let lastTickAt = Date.now();

  /**
   * What the control loop has most recently learned from the API, in one place.
   *
   * Grouped rather than kept as loose variables because two loops read it
   * concurrently: whatever the telemetry loop sees is one consistent snapshot,
   * not a mix of an old profile with a new injection list.
   */
  const control: { state: DemoState | null; apiReachable: boolean } = {
    state: null,
    apiReachable: false,
  };

  const rand = mulberry32(config.SEED);

  /**
   * Rebuilds the fleet to match the requested size.
   *
   * Growing keeps the existing aircraft where they are, so raising the fleet
   * size mid-demonstration adds traffic rather than teleporting everything.
   * A generation change rebuilds from scratch, which is what reset means.
   */
  const reconcileFleet = (target: number, targetGeneration: number): void => {
    if (targetGeneration !== generation) {
      log.info({ generation: targetGeneration }, 'demo generation changed, rebuilding fleet');
      fleet = [];
      generation = targetGeneration;
    }
    while (fleet.length < target) {
      fleet.push(createAircraft(fleet.length, rand));
    }
    if (fleet.length > target) {
      fleet = fleet.slice(0, target);
    }
  };

  /** Reads demo state from the API. This is the simulator's only control channel. */
  const pollControl = async (): Promise<void> => {
    metrics.increment(METRIC.controlPolls);
    try {
      const response = await fetch(`${config.API_BASE_URL}/api/v1/demo/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`demo status returned ${response.status}`);
      const body = (await response.json()) as { state: DemoState };
      control.state = body.state;
      control.apiReachable = true;
      reconcileFleet(body.state.running ? body.state.fleet_size : 0, body.state.generation);
    } catch (err) {
      control.apiReachable = false;
      metrics.increment(METRIC.controlPollFailures);
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'could not read demo state, will retry',
      );
    }
  };

  const send = async (aircraft: SimAircraft, timestamp: string): Promise<void> => {
    const report = applyInjections(
      toTelemetry(aircraft, timestamp),
      control.state?.active_injections ?? [],
      Date.now(),
    );

    if (!report) {
      metrics.increment(METRIC.reportsSuppressed);
      return;
    }

    try {
      const response = await fetch(`${config.API_BASE_URL}/api/v1/telemetry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          ...report,
          identity: {
            callsign: aircraft.callsign,
            registration: aircraft.registration,
            type_icao: aircraft.type.icao,
            operator: aircraft.operator,
          },
        }),
      });

      if (response.ok) {
        metrics.increment(METRIC.reportsSent);
      } else {
        metrics.increment(METRIC.reportsFailed);
        // 503 here means the stream is down. The simulator does not retry: the
        // next tick produces a fresher position anyway, and piling up retries
        // against a struggling API is exactly the wrong response.
        log.warn({ status: response.status, aircraft_id: report.aircraft_id }, 'ingest rejected');
      }
    } catch (err) {
      metrics.increment(METRIC.reportsFailed);
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'ingest request failed');
    }
  };

  const health = new HealthServer({
    port: config.HEALTH_PORT,
    service: 'simulator',
    log,
    checkReady: async () => ({
      ready: control.apiReachable,
      dependencies: {
        api: { ready: control.apiReachable, base_url: config.API_BASE_URL },
        demo: {
          running: control.state?.running ?? false,
          profile: control.state?.profile ?? null,
          fleet_size: fleet.length,
          generation,
        },
      },
    }),
    metricsText: () => metrics.toPrometheus(),
  });
  await health.start();

  shutdownOn(
    [
      // Stop both loops first so no new telemetry is generated, then close the
      // probe listener.
      async () => {
        running = false;
      },
      () => health.close(),
    ],
    { log },
  );

  // The control loop runs independently of the telemetry loop, so a slow or
  // unreachable API cannot stop the simulator from noticing when it comes back.
  void (async () => {
    while (running) {
      await pollControl();
      await sleep(config.CONTROL_POLL_MS);
    }
  })();

  log.info({ api: config.API_BASE_URL, seed: config.SEED }, 'simulator started');

  while (running) {
    const intervalMs = control.state?.interval_ms ?? 3000;

    if (!control.state?.running || fleet.length === 0) {
      await sleep(Math.min(intervalMs, 1000));
      continue;
    }

    const now = Date.now();
    const dtSeconds = Math.min(30, Math.max(0.1, (now - lastTickAt) / 1000));
    lastTickAt = now;
    const timestamp = new Date(now).toISOString();

    fleet = fleet.map((aircraft) => advance(aircraft, dtSeconds, rand));
    metrics.setGauge('fleet_size', fleet.length);

    const started = Date.now();
    await runBounded(
      fleet.map((aircraft) => () => send(aircraft, timestamp)),
      config.MAX_CONCURRENCY,
    );
    const elapsed = Date.now() - started;
    metrics.observeLatency(elapsed);

    // Hold the requested cadence. If a whole round took longer than the interval,
    // the next one starts immediately rather than trying to catch up.
    await sleep(Math.max(0, intervalMs - elapsed));
  }
}

main().catch((err) => {
  console.error('simulator failed to start:', err);
  process.exit(1);
});
