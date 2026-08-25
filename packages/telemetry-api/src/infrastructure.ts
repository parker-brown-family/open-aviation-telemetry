import type { Config } from './config.js';

/**
 * Where the infrastructure panel gets its numbers.
 *
 * IMPORTANT, and surfaced in the UI rather than buried here: when the provider
 * is 'mock', every value below is invented. It is a labelled placeholder that
 * lets the Architecture Explorer render the shape of the AWS estate without an
 * AWS account attached.
 *
 * Everything else in this project — fleet counts, telemetry rates, alert counts,
 * queue depth, consumer lag — is measured, not mocked. Mixing the two without
 * saying which is which is how a demo turns into a false claim, so the
 * distinction is carried in the payload itself as `simulated` and `data_source`
 * and rendered as a banner on the page.
 */

export type ComponentStatus = 'healthy' | 'degraded' | 'unknown' | 'not_deployed';

export interface InfrastructureComponent {
  id: string;
  label: string;
  aws_service: string;
  status: ComponentStatus;
  /** Free-form facts to display. Units belong in the key. */
  facts: Record<string, string | number>;
  note?: string;
}

export interface InfrastructureSnapshot {
  data_source: 'mock' | 'aws';
  /** True when the numbers below are invented rather than measured. */
  simulated: boolean;
  disclaimer: string;
  region: string;
  captured_at: string;
  components: InfrastructureComponent[];
}

const MOCK_DISCLAIMER =
  'SIMULATED. These infrastructure figures are static placeholders shipped with the ' +
  'repository so the architecture view works without an AWS account. Fleet, telemetry, ' +
  'alert, queue and consumer-lag figures elsewhere in this application are measured from ' +
  'the running system.';

function mockSnapshot(config: Config): InfrastructureSnapshot {
  return {
    data_source: 'mock',
    simulated: true,
    disclaimer: MOCK_DISCLAIMER,
    region: config.AWS_REGION,
    captured_at: new Date().toISOString(),
    components: [
      {
        id: 'eks',
        label: 'Kubernetes cluster',
        aws_service: 'Amazon EKS',
        status: 'not_deployed',
        facts: {
          cluster_name: 'oat-demo',
          kubernetes_version: '1.31',
          managed_node_groups: 1,
          desired_nodes: 2,
          availability_zones: 2,
        },
        note: 'Defined in infra/terraform/modules/eks. Not applied in this environment.',
      },
      {
        id: 'rds',
        label: 'Relational database',
        aws_service: 'Amazon RDS for PostgreSQL',
        status: 'not_deployed',
        facts: {
          engine_version: '16.4',
          instance_class: 'db.t4g.micro',
          multi_az: 'false (demo) / true (production)',
          storage_gb: 20,
          publicly_accessible: 'false',
        },
        note: 'The running application uses a local PostgreSQL container in this environment.',
      },
      {
        id: 'msk',
        label: 'Event stream',
        aws_service: 'Amazon MSK Serverless',
        status: 'not_deployed',
        facts: {
          cluster_name: 'oat-demo-telemetry',
          auth: 'IAM (SASL/OAUTHBEARER)',
          topic: 'aircraft.telemetry.v1',
        },
        note: 'The running application uses a local Kafka broker in this environment.',
      },
      {
        id: 'mq',
        label: 'Job queue',
        aws_service: 'Amazon MQ for RabbitMQ',
        status: 'not_deployed',
        facts: {
          broker_name: 'oat-demo-jobs',
          deployment_mode: 'SINGLE_INSTANCE (demo) / CLUSTER_MULTI_AZ (production)',
          instance_type: 'mq.t3.micro',
        },
        note: 'The running application uses a local RabbitMQ container in this environment.',
      },
      {
        id: 'ecr',
        label: 'Container registry',
        aws_service: 'Amazon ECR',
        status: 'not_deployed',
        facts: { repositories: 5, scan_on_push: 'true', immutable_tags: 'true' },
      },
      {
        id: 'cloudwatch',
        label: 'Logs and metrics',
        aws_service: 'Amazon CloudWatch',
        status: 'not_deployed',
        facts: { log_groups: 5, retention_days: 14 },
        note: 'Services already emit structured JSON logs and Prometheus metrics locally.',
      },
    ],
  };
}

/**
 * The real implementation would call the EKS, RDS, Kafka and CloudWatch APIs
 * using the pod's own IAM role via EKS Pod Identity — no credentials in the
 * image, no credentials in the environment.
 *
 * It is deliberately left unimplemented rather than faked behind an 'aws' flag,
 * so that selecting INFRASTRUCTURE_PROVIDER=aws without the work being done
 * produces an honest error instead of mock data wearing a real label.
 */
function awsSnapshotUnavailable(config: Config): InfrastructureSnapshot {
  return {
    data_source: 'aws',
    simulated: false,
    disclaimer:
      'INFRASTRUCTURE_PROVIDER=aws is selected but the live AWS reader is not implemented. ' +
      'No data is being shown rather than mock data being shown as real. ' +
      'See docs/aws-deployment.md.',
    region: config.AWS_REGION,
    captured_at: new Date().toISOString(),
    components: [],
  };
}

export function getInfrastructureSnapshot(config: Config): InfrastructureSnapshot {
  return config.INFRASTRUCTURE_PROVIDER === 'aws'
    ? awsSnapshotUnavailable(config)
    : mockSnapshot(config);
}
