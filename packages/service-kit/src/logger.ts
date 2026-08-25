import { pino, type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

export interface LoggerOptions {
  service: string;
  level?: string;
  env?: string;
  pretty?: boolean;
}

/**
 * Structured JSON logs, always.
 *
 * CloudWatch Logs Insights can filter and aggregate on a JSON field directly;
 * it cannot usefully do either on a sentence. The cost is that raw logs are
 * unpleasant to read by eye, which is what the pretty transport is for in
 * development only — it is never enabled in a deployed environment, where the
 * log collector wants the machine-readable form.
 */
export function createLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level ?? 'info',
    base: { service: options.service, env: options.env ?? 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'DATABASE_URL',
        'RABBITMQ_URL',
      ],
      censor: '[redacted]',
    },
    ...(options.pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
      : {}),
  });
}
