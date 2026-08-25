import { buildApp } from './app.js';
import { KafkaPublisher, RabbitPublisher } from './brokers.js';
import { loadConfig } from './config.js';
import { createPool, runMigrations } from '@oat/data';
import { createLogger } from './logger.js';
import { Metrics } from './metrics.js';

/**
 * Process entrypoint: wire the dependencies, start listening, and shut down
 * cleanly when Kubernetes asks.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config, 'telemetry-api');

  const db = createPool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    ssl: config.DATABASE_SSL,
    applicationName: 'telemetry-api',
  });
  if (config.RUN_MIGRATIONS) {
    await runMigrations(db, log);
  }

  const metrics = new Metrics();
  const kafka = new KafkaPublisher(config, log);
  const rabbit = new RabbitPublisher(config, log);

  // Non-blocking: the API starts serving /health immediately and reports itself
  // unready until the brokers are up. See the probe comments in routes/ops.ts.
  kafka.start();
  rabbit.start();

  const app = await buildApp({ config, log, db, kafka, rabbit, metrics });

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info({ port: config.PORT }, 'telemetry-api listening');

  /**
   * Graceful shutdown.
   *
   * On a rolling update Kubernetes sends SIGTERM and removes the pod from
   * endpoints at the same time — those are concurrent, not ordered. Closing the
   * HTTP server first lets in-flight requests finish; the brokers and the pool
   * close after, so nothing is torn down underneath a request that is still
   * running. Without this, every deploy drops a handful of requests.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');

    const timeout = setTimeout(() => {
      log.error('graceful shutdown timed out, exiting');
      process.exit(1);
    }, 15_000);
    timeout.unref();

    try {
      await app.close();
      await Promise.all([kafka.close(), rabbit.close()]);
      await db.end();
      log.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // Nothing is wired up yet, so there is no logger to use.
  console.error('telemetry-api failed to start:', err);
  process.exit(1);
});
