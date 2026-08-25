import { logLevel as KafkaLogLevel, type KafkaConfig } from 'kafkajs';

export interface KafkaOptions {
  clientId: string;
  brokers: string[];
  /** plaintext for a local broker; aws-msk-iam for Amazon MSK. */
  auth: 'plaintext' | 'aws-msk-iam';
  region?: string;
}

/**
 * Builds kafkajs client options for the configured authentication mode.
 *
 * Local Kafka is plaintext. MSK authenticates the *caller's IAM role* over
 * SASL/OAUTHBEARER — there is no password anywhere, the pod's own identity is
 * the credential, and the token is minted per connection. That is the whole
 * argument for EKS Pod Identity: nothing to rotate, nothing to leak.
 *
 * The signer package is imported dynamically through a variable specifier so it
 * stays an optional dependency: a local checkout does not need the AWS signer
 * installed just to build, and if it is missing the error names the exact fix
 * rather than failing somewhere inside a connection attempt.
 */
export async function buildKafkaOptions(options: KafkaOptions): Promise<KafkaConfig> {
  const base: KafkaConfig = {
    clientId: options.clientId,
    brokers: options.brokers,
    logLevel: KafkaLogLevel.WARN,
    retry: { initialRetryTime: 300, retries: 8 },
    connectionTimeout: 10_000,
  };

  if (options.auth === 'plaintext') return base;

  type Signer = { generateAuthToken: (o: { region: string }) => Promise<{ token: string }> };
  let signer: Signer;
  try {
    const specifier = 'aws-msk-iam-sasl-signer-js';
    signer = (await import(specifier)) as Signer;
  } catch {
    throw new Error(
      'KAFKA_AUTH=aws-msk-iam requires the aws-msk-iam-sasl-signer-js package. ' +
        'Add it to the service image, or set KAFKA_AUTH=plaintext for a local broker.',
    );
  }

  const region = options.region ?? 'ca-central-1';
  return {
    ...base,
    ssl: true,
    sasl: {
      mechanism: 'oauthbearer',
      oauthBearerProvider: async () => {
        const { token } = await signer.generateAuthToken({ region });
        return { value: token };
      },
    },
  };
}
