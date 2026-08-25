import type { Logger } from './logger.js';

export interface ShutdownOptions {
  log: Logger;
  /** Hard deadline before the process exits regardless. */
  timeoutMs?: number;
}

/**
 * Registers a graceful shutdown for SIGTERM and SIGINT.
 *
 * On a rolling update Kubernetes sends SIGTERM and removes the pod from
 * endpoints at roughly the same moment — those are concurrent, not ordered. A
 * process that exits immediately on SIGTERM drops whatever it was doing: an
 * in-flight HTTP request, a Kafka batch that has not been committed, a job that
 * has not been acknowledged.
 *
 * Handlers run in registration order, so callers should register the thing that
 * accepts new work first — stop consuming, then finish what is in hand, then
 * close connections.
 *
 * The timeout exists because a graceful shutdown that never completes is worse
 * than an abrupt one: the pod hangs until terminationGracePeriodSeconds runs
 * out and the deployment crawls.
 */
export function shutdownOn(
  handlers: Array<() => Promise<void>>,
  { log, timeoutMs = 20_000 }: ShutdownOptions,
): void {
  let shuttingDown = false;

  const run = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');

    const timer = setTimeout(() => {
      log.error({ timeoutMs }, 'graceful shutdown timed out, exiting');
      process.exit(1);
    }, timeoutMs);
    timer.unref();

    try {
      for (const handler of handlers) {
        await handler();
      }
      log.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void run('SIGTERM'));
  process.on('SIGINT', () => void run('SIGINT'));
}
