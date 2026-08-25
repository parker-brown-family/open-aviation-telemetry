import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Probe endpoint. The consumer has no inbound traffic but Kubernetes still needs to ask. */
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8081),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
  DATABASE_SSL: z.enum(['disable', 'require']).default('disable'),

  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('telemetry-consumer'),
  KAFKA_AUTH: z.enum(['plaintext', 'aws-msk-iam']).default('plaintext'),
  AWS_REGION: z.string().default('ca-central-1'),

  /**
   * How many messages kafkajs hands over before waiting. Raising it improves
   * throughput and worsens the amount of work replayed after a crash.
   */
  MAX_IN_FLIGHT: z.coerce.number().int().min(1).max(1000).default(50),
  /** Airframes held in the derived-state cache before the oldest is evicted. */
  STATE_CACHE_SIZE: z.coerce.number().int().min(100).max(100_000).default(5000),
});

export type Config = Omit<z.infer<typeof ConfigSchema>, 'KAFKA_BROKERS'> & {
  KAFKA_BROKERS: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return {
    ...parsed.data,
    KAFKA_BROKERS: parsed.data.KAFKA_BROKERS.split(',')
      .map((b) => b.trim())
      .filter(Boolean),
  };
}
