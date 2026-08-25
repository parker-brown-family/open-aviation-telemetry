import { createLogger as createServiceLogger, type Logger } from '@oat/service-kit';
import type { Config } from './config.js';

export type { Logger };

export function createLogger(config: Config, service: string): Logger {
  return createServiceLogger({
    service,
    level: config.LOG_LEVEL,
    env: config.NODE_ENV,
    pretty: config.NODE_ENV === 'development',
  });
}
