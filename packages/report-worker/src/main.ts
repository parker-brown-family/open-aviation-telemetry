import amqp from 'amqplib';
import { z } from 'zod';
import {
  ATTEMPT_HEADER,
  MAX_JOB_ATTEMPTS,
  RABBIT,
  ReportJobSchema,
  type ReportJob,
} from '@oat/shared';
import { countAlertsInWindow, createPool, getHistoryWindow, markReport } from '@oat/data';
import {
  HealthServer,
  Metrics,
  assertJobTopology,
  createLogger,
  shutdownOn,
} from '@oat/service-kit';
import { buildFlightSummary, decideFailureOutcome } from './summary.js';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8082),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
  DATABASE_SSL: z.enum(['disable', 'require']).default('disable'),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),
  /**
   * How many jobs this worker will hold at once.
   *
   * prefetch=1 means a worker takes one job, finishes it, then takes another.
   * With several replicas that produces natural load balancing: a slow job ties
   * up one worker instead of a whole queue of pre-assigned work sitting behind
   * it. Raise it for small fast jobs; keep it at 1 for jobs of uneven cost,
   * which report generation is.
   */
  PREFETCH: z.coerce.number().int().min(1).max(100).default(1),
});

const METRIC = {
  received: 'jobs_received',
  completed: 'jobs_completed',
  retried: 'jobs_retried',
  deadLettered: 'jobs_dead_lettered',
  malformed: 'jobs_malformed',
} as const;

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
    service: 'report-worker',
    level: config.LOG_LEVEL,
    env: config.NODE_ENV,
    pretty: config.NODE_ENV === 'development',
  });
  const metrics = new Metrics();

  const db = createPool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    ssl: config.DATABASE_SSL,
    applicationName: 'report-worker',
  });

  const connection = await amqp.connect(config.RABBITMQ_URL);
  const channel = await connection.createChannel();
  await assertJobTopology(channel);
  await channel.prefetch(config.PREFETCH);

  let connected = true;
  connection.on('close', () => {
    connected = false;
    log.error('rabbitmq connection closed');
  });

  /**
   * Does the actual work of a report job.
   *
   * Reads the telemetry window, counts alerts in it, builds the summary and
   * stores it. Throwing from here is how a job is declared failed — the caller
   * owns the retry policy.
   */
  const runJob = async (job: ReportJob): Promise<void> => {
    if (job.inject_failure) {
      // The deliberate demo failure. It throws before doing any work, so a
      // retried job is genuinely re-attempted from the start.
      throw new Error('Injected failure: report generation was asked to fail for demonstration.');
    }

    const [samples, alertsInWindow] = await Promise.all([
      getHistoryWindow(db, job.aircraft_id, job.window_minutes),
      countAlertsInWindow(db, job.aircraft_id, job.window_minutes),
    ]);

    const summary = buildFlightSummary({
      aircraftId: job.aircraft_id,
      windowMinutes: job.window_minutes,
      samples,
      alertsInWindow,
      generatedAt: new Date().toISOString(),
    });

    await markReport(db, job.report_id, 'completed', { payload: summary, incrementAttempt: true });
    log.info(
      { report_id: job.report_id, aircraft_id: job.aircraft_id, samples: summary.samples },
      'report completed',
    );
  };

  await channel.consume(
    RABBIT.reportQueue,
    (message) => {
      if (!message) return;
      metrics.increment(METRIC.received);

      void (async () => {
        // Attempt count travels with the message. It survives the trip through
        // the retry queue, which is what makes "three attempts" mean three
        // attempts rather than three per worker.
        const previousAttempts = Number(message.properties.headers?.[ATTEMPT_HEADER] ?? 0);
        const attempt = previousAttempts + 1;

        let job: ReportJob;
        try {
          job = ReportJobSchema.parse(JSON.parse(message.content.toString()));
        } catch (err) {
          // Unparseable: no amount of retrying fixes it, so it goes straight to
          // the dead-letter queue.
          metrics.increment(METRIC.malformed);
          log.error({ err }, 'malformed job, dead-lettering without retry');
          channel.nack(message, false, false);
          return;
        }

        const jobLog = log.child({ job_id: job.job_id, report_id: job.report_id, attempt });

        try {
          await markReport(db, job.report_id, 'running');
          await runJob(job);
          metrics.increment(METRIC.completed);
          // Acknowledged only after the work is durably recorded. Acknowledging
          // first would mean a crash mid-report loses the job silently.
          channel.ack(message);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          const outcome = decideFailureOutcome(attempt, MAX_JOB_ATTEMPTS, RABBIT.retryDelayMs);

          if (outcome.action === 'retry') {
            jobLog.warn(
              { err: reason, next_attempt_in_ms: outcome.delayMs },
              'job failed, scheduling retry',
            );
            await markReport(db, job.report_id, 'pending', {
              error: `attempt ${attempt} failed: ${reason}`,
              incrementAttempt: true,
            });

            // Publish to the delay queue, then ack the original. The broker
            // returns it to the main queue when the TTL expires.
            channel.sendToQueue(RABBIT.reportRetryQueue, message.content, {
              persistent: true,
              contentType: 'application/json',
              headers: { ...message.properties.headers, [ATTEMPT_HEADER]: attempt },
            });
            channel.ack(message);
            metrics.increment(METRIC.retried);
            return;
          }

          jobLog.error({ err: reason, attempts: attempt }, 'job exhausted retries, dead-lettering');
          await markReport(db, job.report_id, 'failed', {
            error: `failed after ${attempt} attempts: ${reason}`,
            incrementAttempt: true,
          });
          // Reject without requeue: the queue's dead-letter exchange takes it
          // from here, so the message is preserved for inspection rather than
          // dropped.
          channel.nack(message, false, false);
          metrics.increment(METRIC.deadLettered);
        }
      })();
    },
    { noAck: false },
  );

  log.info({ queue: RABBIT.reportQueue, prefetch: config.PREFETCH }, 'report worker consuming');

  const health = new HealthServer({
    port: config.HEALTH_PORT,
    service: 'report-worker',
    log,
    checkReady: async () => {
      let database = false;
      let databaseError: string | null = null;
      try {
        await db.query('SELECT 1');
        database = true;
      } catch (err) {
        databaseError = err instanceof Error ? err.message : String(err);
      }

      let depth: number | null = null;
      let deadLettered: number | null = null;
      try {
        depth = (await channel.checkQueue(RABBIT.reportQueue)).messageCount;
        deadLettered = (await channel.checkQueue(RABBIT.reportDlq)).messageCount;
      } catch {
        // checkQueue failing means the channel is gone; readiness reflects that
        // through `connected` below.
      }

      return {
        ready: database && connected,
        dependencies: {
          database: { ready: database, error: databaseError },
          rabbitmq: { ready: connected, queue_depth: depth, dead_lettered: deadLettered },
        },
      };
    },
    metricsText: () => metrics.toPrometheus(),
  });
  await health.start();

  shutdownOn(
    [
      // Cancel consumption first so no new job is delivered, then close the
      // channel once the in-flight job has acknowledged.
      async () => {
        connected = false;
        await channel.close();
      },
      () => connection.close(),
      () => health.close(),
      () => db.end(),
    ],
    { log },
  );
}

main().catch((err) => {
  console.error('report-worker failed to start:', err);
  process.exit(1);
});
