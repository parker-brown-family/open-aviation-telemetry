import { z } from 'zod';

/**
 * Configuration is read from the environment once, at startup, and validated.
 *
 * A service that starts with a typo in an environment variable and only fails
 * on the first request that needs it is much harder to operate than one that
 * refuses to start at all. Kubernetes handles the second case for you: the pod
 * never becomes ready, the rollout halts, and the previous version keeps serving.
 */
const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Set for RDS, where the server certificate chains to the Amazon RDS CA. */
  DATABASE_SSL: z.enum(['disable', 'require']).default('disable'),

  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('telemetry-api'),
  /**
   * plaintext for local Kafka; aws-msk-iam for MSK, where the broker
   * authenticates the pod's IAM role rather than a password.
   */
  KAFKA_AUTH: z.enum(['plaintext', 'aws-msk-iam']).default('plaintext'),
  AWS_REGION: z.string().default('ca-central-1'),

  RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),

  /**
   * Where infrastructure telemetry comes from. 'mock' serves a clearly-labelled
   * static picture of the AWS estate so the Architecture Explorer works without
   * an AWS account; 'aws' would read CloudWatch and the EKS API for real.
   */
  INFRASTRUCTURE_PROVIDER: z.enum(['mock', 'aws']).default('mock'),

  CORS_ORIGIN: z.string().default('*'),
  /** Run pending migrations at boot. Disable when a Kubernetes Job owns migration. */
  RUN_MIGRATIONS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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
