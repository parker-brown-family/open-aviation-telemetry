import { Kafka, Partitioners, type Consumer, type Producer } from 'kafkajs';
import { CONSUMER_GROUPS, TOPICS } from '@oat/shared';
import {
  claimEvent,
  createPool,
  insertAlertSuppressed,
  insertHistory,
  updateFlightPhase,
} from '@oat/data';
import {
  HealthServer,
  Metrics,
  buildKafkaOptions,
  createLogger,
  shutdownOn,
} from '@oat/service-kit';
import { loadConfig } from './config.js';
import { RecentStateCache, derive, isNewerThanCached, parseEnvelope } from './processor.js';

const METRIC = {
  consumed: 'events_consumed',
  duplicates: 'events_duplicate',
  quarantined: 'events_quarantined',
  historyRows: 'history_rows_written',
  alertsRaised: 'alerts_raised',
  processingErrors: 'processing_errors',
  staleSkipped: 'events_out_of_order_skipped',
} as const;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger({
    service: 'telemetry-consumer',
    level: config.LOG_LEVEL,
    env: config.NODE_ENV,
    pretty: config.NODE_ENV === 'development',
  });

  const metrics = new Metrics();
  const cache = new RecentStateCache(config.STATE_CACHE_SIZE);

  const db = createPool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    ssl: config.DATABASE_SSL,
    applicationName: 'telemetry-consumer',
  });

  const kafka = new Kafka(
    await buildKafkaOptions({
      clientId: config.KAFKA_CLIENT_ID,
      brokers: config.KAFKA_BROKERS,
      auth: config.KAFKA_AUTH,
      region: config.AWS_REGION,
    }),
  );

  const consumer: Consumer = kafka.consumer({
    groupId: CONSUMER_GROUPS.telemetryProcessors,
    // Long enough to survive a GC pause or a slow database, short enough that a
    // genuinely dead consumer's partitions get reassigned promptly.
    sessionTimeout: 30_000,
    heartbeatInterval: 3000,
  });

  // A separate producer for the dead-letter topic. Quarantining a message is
  // itself a publish, and it must not share fate with consumption.
  const dlqProducer: Producer = kafka.producer({
    allowAutoTopicCreation: true,
    createPartitioner: Partitioners.DefaultPartitioner,
  });

  let consumerConnected = false;

  /**
   * Sends a message that can never be processed to the dead-letter topic.
   *
   * The original bytes are preserved verbatim and the reason is attached as
   * headers, so the message can be inspected — and, once the bug that produced
   * it is fixed, replayed — without guesswork about what actually arrived.
   */
  const quarantine = async (
    raw: Buffer | null,
    reason: string,
    detail: string,
    key: Buffer | null,
  ): Promise<void> => {
    metrics.increment(METRIC.quarantined);
    log.error({ reason, detail }, 'quarantining unprocessable message');
    await dlqProducer.send({
      topic: TOPICS.telemetryDlq,
      messages: [
        {
          key: key ?? null,
          value: raw ?? Buffer.from(''),
          headers: {
            failure_reason: reason,
            failure_detail: detail.slice(0, 1000),
            quarantined_at: new Date().toISOString(),
            original_topic: TOPICS.telemetry,
          },
        },
      ],
    });
  };

  await dlqProducer.connect();
  await consumer.connect();
  consumerConnected = true;
  await consumer.subscribe({ topic: TOPICS.telemetry, fromBeginning: false });

  log.info(
    { topic: TOPICS.telemetry, group: CONSUMER_GROUPS.telemetryProcessors },
    'consumer subscribed',
  );

  await consumer.run({
    partitionsConsumedConcurrently: 3,
    eachMessage: async ({ message, partition }) => {
      const started = process.hrtime.bigint();
      metrics.increment(METRIC.consumed);

      const parsed = parseEnvelope(message.value);
      if (!parsed.ok) {
        // Not retried: the bytes will not change, so retrying would block this
        // partition forever behind one bad message.
        await quarantine(message.value, parsed.reason, parsed.detail, message.key);
        return;
      }

      const { envelope } = parsed;
      const report = envelope.payload;

      try {
        // At-least-once delivery means this event may have been processed
        // already — after a rebalance, or a crash between processing and
        // committing. The ledger insert is the deduplication point.
        const isNew = await claimEvent(db, envelope.event_id);
        if (!isNew) {
          metrics.increment(METRIC.duplicates);
          log.debug({ event_id: envelope.event_id }, 'replayed event skipped');
          return;
        }

        const cached = cache.get(report.aircraft_id);

        if (isNewerThanCached(report, cached)) {
          const { flight_phase, anomalies } = derive(report, cached);

          if (await insertHistory(db, report)) {
            metrics.increment(METRIC.historyRows);
          }

          await updateFlightPhase(db, report.aircraft_id, flight_phase);

          for (const anomaly of anomalies) {
            const alertId = await insertAlertSuppressed(db, {
              aircraft_id: report.aircraft_id,
              ...anomaly,
            });
            if (alertId) {
              metrics.increment(METRIC.alertsRaised);
              log.warn(
                {
                  alert_id: alertId,
                  aircraft_id: report.aircraft_id,
                  kind: anomaly.kind,
                  severity: anomaly.severity,
                },
                anomaly.message,
              );
            }
          }

          cache.set(report.aircraft_id, report);
        } else {
          // An older reading arriving after a newer one. History still records
          // it; derived state does not regress.
          metrics.increment(METRIC.staleSkipped);
          await insertHistory(db, report);
        }

        metrics.setGauge('state_cache_entries', cache.size);
        metrics.observeLatency(Number(process.hrtime.bigint() - started) / 1_000_000);
      } catch (err) {
        // A transient failure — the database is down, say. Rethrowing makes
        // kafkajs retry the batch rather than commit past it, so nothing is
        // silently lost. This is the opposite of the quarantine case above.
        metrics.increment(METRIC.processingErrors);
        log.error(
          { err, event_id: envelope.event_id, aircraft_id: report.aircraft_id, partition },
          'processing failed, message will be retried',
        );
        throw err;
      }
    },
  });

  const health = new HealthServer({
    port: config.HEALTH_PORT,
    service: 'telemetry-consumer',
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
      return {
        ready: database && consumerConnected,
        dependencies: {
          database: { ready: database, error: databaseError },
          kafka: { ready: consumerConnected },
          consumer_group: CONSUMER_GROUPS.telemetryProcessors,
          state_cache_entries: cache.size,
        },
      };
    },
    metricsText: () => metrics.toPrometheus(),
  });
  await health.start();

  // Order matters: stop consuming first so no new work arrives, then close the
  // producer and the pool once in-flight processing has drained.
  shutdownOn(
    [
      async () => {
        consumerConnected = false;
        await consumer.disconnect();
      },
      () => dlqProducer.disconnect(),
      () => health.close(),
      () => db.end(),
    ],
    { log },
  );
}

main().catch((err) => {
  console.error('telemetry-consumer failed to start:', err);
  process.exit(1);
});
