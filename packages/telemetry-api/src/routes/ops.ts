import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CONSUMER_GROUPS,
  DEMO_PROFILES,
  SCENARIOS,
  SCENARIO_DETAIL,
  THRESHOLDS,
  TOPICS,
  isDemoProfileName,
  type ReportJob,
  type ScenarioName,
} from '@oat/shared';
import type { AppContext } from '../context.js';
import { getInfrastructureSnapshot } from '../infrastructure.js';
import { createReport, fleetStats, listAircraft, resetFleetData } from '@oat/data';
import {
  clearScenario,
  injectScenario,
  readDemoState,
  resetDemo,
  startDemo,
  stopDemo,
} from '../demo-state.js';

export async function registerOpsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { config, db, kafka, rabbit, metrics, log } = ctx;

  // -------------------------------------------------------------------------
  // Probes
  //
  // Liveness and readiness answer different questions, and conflating them is a
  // classic way to turn a brief broker outage into a cluster-wide restart storm.
  //
  //   /health  — is this process alive? Only fails if the process is wedged.
  //              A failure here makes Kubernetes KILL the pod.
  //   /ready   — can this process serve traffic right now? Fails when a
  //              dependency is unreachable. A failure here only removes the pod
  //              from the load balancer, and it recovers on its own.
  //
  // So a Kafka outage must never fail /health.
  // -------------------------------------------------------------------------

  app.get('/health', { schema: { summary: 'Liveness probe', tags: ['ops'] } }, async () => ({
    status: 'ok',
    service: 'telemetry-api',
    uptime_seconds: metrics.uptimeSeconds(),
  }));

  app.get(
    '/ready',
    { schema: { summary: 'Readiness probe', tags: ['ops'] } },
    async (_request, reply) => {
      let database = false;
      let databaseError: string | null = null;
      try {
        await db.query('SELECT 1');
        database = true;
      } catch (err) {
        databaseError = err instanceof Error ? err.message : String(err);
      }

      const dependencies = {
        database: { ready: database, error: databaseError },
        kafka: { ready: kafka.isReady(), error: kafka.lastError() },
        rabbitmq: { ready: rabbit.isReady(), error: rabbit.lastError() },
      };

      // The database is required to answer any request at all. The brokers are
      // required to accept writes, so the API is not ready without them either —
      // but it stays alive and reconnects rather than crash-looping.
      const ready = database && kafka.isReady() && rabbit.isReady();
      return reply.status(ready ? 200 : 503).send({ ready, dependencies });
    },
  );

  app.get(
    '/metrics',
    { schema: { summary: 'Prometheus metrics', tags: ['ops'] } },
    async (_request, reply) =>
      reply
        .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
        .send(metrics.toPrometheus()),
  );

  // -------------------------------------------------------------------------
  // Aggregate view for the dashboard
  // -------------------------------------------------------------------------

  app.get(
    '/api/v1/stats',
    {
      schema: {
        summary: 'Fleet, pipeline and API statistics',
        description:
          'Every figure here is measured from the running system: counts from ' +
          'PostgreSQL, consumer lag from Kafka, queue depth from RabbitMQ, request ' +
          'counters from this process.',
        tags: ['ops'],
      },
    },
    async () => {
      const [fleet, lag, queue] = await Promise.all([
        fleetStats(db),
        kafka.consumerLag(TOPICS.telemetry, CONSUMER_GROUPS.telemetryProcessors),
        rabbit.queueDepth(),
      ]);

      return {
        measured: true,
        captured_at: new Date().toISOString(),
        fleet,
        stream: {
          topic: TOPICS.telemetry,
          consumer_group: CONSUMER_GROUPS.telemetryProcessors,
          connected: kafka.isReady(),
          lag,
        },
        jobs: {
          queue: 'aircraft.report.generate',
          connected: rabbit.isReady(),
          depth: queue,
        },
        api: metrics.toJSON(),
        thresholds: THRESHOLDS,
      };
    },
  );

  app.get(
    '/api/v1/infrastructure',
    {
      schema: {
        summary: 'AWS infrastructure picture',
        description:
          'Returns simulated=true when the figures are static placeholders rather ' +
          'than a reading of a live AWS account. Check that flag before believing it.',
        tags: ['ops'],
      },
    },
    async () => getInfrastructureSnapshot(config),
  );

  // -------------------------------------------------------------------------
  // Demo control
  // -------------------------------------------------------------------------

  app.get(
    '/api/v1/demo/status',
    { schema: { summary: 'Current demo state', tags: ['demo'] } },
    async () => {
      const state = await readDemoState(db);
      return {
        state,
        profiles: DEMO_PROFILES,
        scenarios: SCENARIO_DETAIL,
      };
    },
  );

  app.post(
    '/api/v1/demo/start',
    { schema: { summary: 'Start the simulator at a profile', tags: ['demo'] } },
    async (request, reply) => {
      const body = z.object({ profile: z.string().default('calm') }).safeParse(request.body ?? {});
      if (!body.success || !isDemoProfileName(body.data.profile)) {
        return reply.status(400).send({
          error: 'invalid_profile',
          allowed: Object.keys(DEMO_PROFILES),
        });
      }
      const state = await startDemo(db, body.data.profile);
      log.info({ profile: body.data.profile }, 'demo started');
      return state;
    },
  );

  app.post(
    '/api/v1/demo/stop',
    { schema: { summary: 'Stop the simulator', tags: ['demo'] } },
    async () => {
      const state = await stopDemo(db);
      log.info('demo stopped');
      return state;
    },
  );

  app.post(
    '/api/v1/demo/reset',
    {
      schema: {
        summary: 'Stop the demo and delete all fleet data',
        description:
          'Truncates aircraft, telemetry, alerts and reports, then bumps the generation counter.',
        tags: ['demo'],
      },
    },
    async () => {
      await resetFleetData(db);
      const state = await resetDemo(db);
      log.warn({ generation: state.generation }, 'demo reset — fleet data cleared');
      return state;
    },
  );

  /**
   * Fault injection.
   *
   * Two shapes of scenario:
   *   * Telemetry-shaped ones are recorded as injections. The simulator reads
   *     demo state and changes what it reports, so the anomaly arrives through
   *     the real ingest path and the real stream.
   *   * Infrastructure-shaped ones act immediately here, because there is no
   *     telemetry that would cause them — a poison event has to be published
   *     directly, and a failing job has to be enqueued directly.
   */
  app.post(
    '/api/v1/demo/scenario/:scenario',
    { schema: { summary: 'Inject a failure scenario', tags: ['demo'] } },
    async (request, reply) => {
      const params = z.object({ scenario: z.enum(SCENARIOS) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'unknown_scenario', allowed: SCENARIOS });
      }
      const scenario: ScenarioName = params.data.scenario;

      if (scenario === 'poison_event') {
        try {
          await kafka.publishPoison();
        } catch (err) {
          return reply.status(503).send({
            error: 'stream_unavailable',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        log.warn('poison event published for demonstration');
        return {
          scenario,
          applied: 'immediate',
          expect: SCENARIO_DETAIL[scenario].expected,
          watch: `Kafka topic ${TOPICS.telemetryDlq}`,
        };
      }

      if (scenario === 'worker_failure') {
        const fleet = await listAircraft(db, 50);
        const target = fleet[0];
        if (!target) {
          return reply.status(409).send({
            error: 'no_aircraft',
            message: 'Start the demo first so there is an aircraft to report on.',
          });
        }

        const reportId = randomUUID();
        await createReport(db, {
          reportId,
          aircraftId: target.aircraft_id,
          kind: 'flight_summary',
          windowMinutes: 60,
        });

        const job: ReportJob = {
          job_id: randomUUID(),
          report_id: reportId,
          aircraft_id: target.aircraft_id,
          kind: 'flight_summary',
          requested_at: new Date().toISOString(),
          window_minutes: 60,
          inject_failure: true,
        };

        try {
          await rabbit.enqueueReport(job);
        } catch (err) {
          return reply.status(503).send({
            error: 'queue_unavailable',
            message: err instanceof Error ? err.message : String(err),
          });
        }

        log.warn({ report_id: reportId }, 'failing report job enqueued for demonstration');
        return {
          scenario,
          applied: 'immediate',
          report_id: reportId,
          aircraft_id: target.aircraft_id,
          expect: SCENARIO_DETAIL[scenario].expected,
          watch: `/api/v1/reports/${reportId}`,
        };
      }

      // Telemetry-shaped scenarios: pick a few active aircraft and let the
      // simulator produce the anomalous readings.
      const fleet = await listAircraft(db, 200);
      if (fleet.length === 0) {
        return reply.status(409).send({
          error: 'no_aircraft',
          message: 'Start the demo first so there are aircraft to affect.',
        });
      }
      const count = scenario === 'telemetry_gap' ? Math.max(1, Math.floor(fleet.length * 0.1)) : 2;
      const targets = fleet.slice(0, count).map((a) => a.aircraft_id);

      const state = await injectScenario(db, scenario, targets);
      log.warn({ scenario, targets }, 'scenario injected');
      return {
        scenario,
        applied: 'injected',
        aircraft_ids: targets,
        expect: SCENARIO_DETAIL[scenario].expected,
        state,
      };
    },
  );

  app.delete(
    '/api/v1/demo/scenario/:scenario',
    { schema: { summary: 'Clear an injected scenario', tags: ['demo'] } },
    async (request, reply) => {
      const params = z.object({ scenario: z.enum(SCENARIOS) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'unknown_scenario', allowed: SCENARIOS });
      }
      return clearScenario(db, params.data.scenario);
    },
  );
}
