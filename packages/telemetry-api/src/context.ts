import type { KafkaPublisher, RabbitPublisher } from './brokers.js';
import type { Config } from './config.js';
import type { Db } from '@oat/data';
import type { Logger } from './logger.js';
import type { Metrics } from './metrics.js';

/**
 * Everything a route handler is allowed to reach for, passed in explicitly.
 *
 * No module-level singletons and no service locator: a test builds a context
 * with a throwaway database and a stub publisher and gets a real app instance,
 * without having to reset global state between cases.
 */
export interface AppContext {
  config: Config;
  log: Logger;
  db: Db;
  kafka: KafkaPublisher;
  rabbit: RabbitPublisher;
  metrics: Metrics;
}
