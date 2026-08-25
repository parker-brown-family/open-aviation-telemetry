/**
 * The training plan behind this architecture.
 *
 * Building the stack taught the shape of it; these close the gap between having
 * built something on a service and being able to operate it when it misbehaves
 * at 2am. Ordered the way it is worth doing rather than the way the services
 * appear in the diagram — the two you touch first are the two that carry state.
 *
 * Grouped by the skills this system actually asks for, so a course that does not
 * serve one of them has to justify itself, and a skill with no course against it
 * is visible as a gap rather than quietly missing.
 */

export type TrainingArea = 'aws' | 'eks' | 'rds' | 'kafka' | 'rabbitmq' | 'microservices' | 'other';

/**
 * One thing to build, plug in, or stand up.
 *
 * A finished course proves you watched it. These are what the course is for:
 * each one names a change to this repository that cannot be made without the
 * material, and that either works or does not when it is done. Ordered so that
 * the earlier ones are prerequisites for the later ones where that applies.
 */
export interface TrainingStep {
  /** Unique across the whole checklist; the parent id prefixes it. */
  id: string;
  /** The thing to do, phrased as a change with an observable outcome. */
  label: string;
}

export interface TrainingItem {
  id: string;
  area: TrainingArea;
  title: string;
  provider: string;
  url: string;
  /** What this gives you that building the system does not. */
  why: string;
  /** Set where no course covers the area yet, so the gap stays visible. */
  gap?: boolean;
  /** What to build with it. Labelled a, b, c… in the order given. */
  steps: TrainingStep[];
}

/** The letter a step is shown under: a, b, c… */
export function stepLabel(index: number): string {
  return String.fromCharCode(97 + (index % 26));
}

export const AREA_LABEL: Record<TrainingArea, string> = {
  aws: 'AWS',
  eks: 'EKS',
  rds: 'RDS',
  kafka: 'Kafka',
  rabbitmq: 'RabbitMQ',
  microservices: 'Microservices',
  other: 'Other',
};

/** In the order they are worth working through. */
export const TRAINING_ITEMS: TrainingItem[] = [
  {
    id: 'eks-badge',
    area: 'eks',
    title: 'Amazon EKS — Knowledge Badge Readiness Path',
    provider: 'AWS Skill Builder',
    url: 'https://explore.skillbuilder.aws/learn/public/learning_plan/view/1931/amazon-eks-knowledge-badge-readiness-path',
    why: 'Deploying to EKS and operating EKS are different skills. Node groups, IRSA, cluster networking and upgrades — and what to do when a pod cannot reach a broker.',
    steps: [
      {
        id: 'eks-badge:a',
        label: 'Stand the Helm umbrella chart up on a real EKS cluster, not just a local one',
      },
      {
        id: 'eks-badge:b',
        label: 'Move every workload onto EKS Pod Identity and delete the static access keys',
      },
      {
        id: 'eks-badge:c',
        label: 'Run the migration as a pre-upgrade Job hook and watch it block a bad deploy',
      },
      {
        id: 'eks-badge:d',
        label: 'Drain a node while the consumer is mid-partition, and prove no telemetry was lost',
      },
    ],
  },
  {
    id: 'rds-postgres-core',
    area: 'rds',
    title: 'PostgreSQL for Aurora and RDS — Core Concepts',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/learning-plan/X523RHDM8P/postgresql-for-amazon-aurora-and-rds--core-concepts-learning-plan/GTSFUXJV8F',
    why: 'The operating model around the database rather than the SQL inside it: parameter groups, backups, failover behaviour, connection limits. What decides whether a write path stays up.',
    steps: [
      {
        id: 'rds-postgres-core:a',
        label: 'Provision the RDS instance from the Terraform module and point the API at it',
      },
      {
        id: 'rds-postgres-core:b',
        label:
          'Set max_connections in the parameter group against the pod count, and hit the limit on purpose',
      },
      {
        id: 'rds-postgres-core:c',
        label: 'Take a snapshot, restore it to a new instance, and run the API against the restore',
      },
      {
        id: 'rds-postgres-core:d',
        label: 'Force a failover and measure how long the write path is actually down',
      },
    ],
  },
  {
    id: 'rds-postgres-advanced',
    area: 'rds',
    title: 'PostgreSQL for Aurora and RDS — Advanced Concepts badge',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/learning-plan/VZ3TF49CG6/postgresql-for-amazon-aurora-and-amazon-rds--advanced-concepts-knowledge-badge-readiness-path/5U9VV8BN4M',
    why: 'Tuning, partitioning and replication. A telemetry table takes one row per report per airframe per interval, which is where those three stop being academic.',
    steps: [
      {
        id: 'rds-postgres-advanced:a',
        label: 'Partition the telemetry table by report time and confirm the planner prunes',
      },
      {
        id: 'rds-postgres-advanced:b',
        label: 'Add the index the near-datum query needs; compare EXPLAIN before and after',
      },
      {
        id: 'rds-postgres-advanced:c',
        label: 'Add a read replica and route the history endpoint to it',
      },
      {
        id: 'rds-postgres-advanced:d',
        label: 'Load the table to ten million rows and re-time the dashboard stats query',
      },
    ],
  },
  {
    id: 'cloud-practitioner',
    area: 'aws',
    title: 'AWS Cloud Practitioner Essentials',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/learn/94T2BEN85A/aws-cloud-practitioner-essentials/8D79F3AVR7',
    why: 'The cheap sweep for vocabulary gaps — service families, IAM boundaries, billing shape — so nothing that goes on a whiteboard is unfamiliar.',
    steps: [
      {
        id: 'cloud-practitioner:a',
        label: 'Price the demo estate in the AWS calculator and put the number in the README',
      },
      {
        id: 'cloud-practitioner:b',
        label: 'Tag every Terraform resource so the cost breakdown comes out per workload',
      },
      {
        id: 'cloud-practitioner:c',
        label: 'Set a budget alarm before the first real apply, not after the first bill',
      },
    ],
  },
  {
    id: 'solutions-architect-associate',
    area: 'microservices',
    title: 'AWS Certified Solutions Architect – Associate, exam prep',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/learning-plan/UYRXS2DF85/exam-prep-plan-aws-certified-solutions-architect--associate-saac03--english/U991QUF9C3',
    why: 'The one that maps onto running services at scale: sizing, failure isolation, multi-AZ, and the trade-offs behind an architecture like this one.',
    steps: [
      {
        id: 'solutions-architect-associate:a',
        label: 'Write the multi-AZ failure story for each component in the Architecture explorer',
      },
      {
        id: 'solutions-architect-associate:b',
        label: 'Add the second availability zone to the Terraform VPC module and re-apply',
      },
      {
        id: 'solutions-architect-associate:c',
        label: 'Record an ADR for what is lost, and for how long, when one AZ goes',
      },
      {
        id: 'solutions-architect-associate:d',
        label: 'Load-test the ingest path and find where it first bends',
      },
    ],
  },
  {
    id: 'developer-associate',
    area: 'aws',
    title: 'AWS Certified Developer – Associate',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/search?searchText=aws-certified-developer-associate',
    why: 'SDK-level detail: retries, idempotency, credential handling. The failure modes you only meet in code.',
    steps: [
      {
        id: 'developer-associate:a',
        label: 'Replace the hand-rolled retry with the SDK adaptive retry mode',
      },
      {
        id: 'developer-associate:b',
        label: 'Prove the idempotency ledger holds under a real duplicate-delivery test',
      },
      {
        id: 'developer-associate:c',
        label: 'Move every credential into Secrets Manager and rotate one without downtime',
      },
    ],
  },
  {
    id: 'msk',
    area: 'kafka',
    title: 'Amazon MSK material',
    provider: 'AWS Skill Builder — no single path yet',
    url: 'https://skillbuilder.aws/search?searchText=amazon+msk',
    why: 'MSK carries the telemetry stream here and the API publishes to it before acknowledging a report, so the build teaches the shape. Partitioning, consumer-group rebalancing and retention are the parts it does not.',
    gap: true,
    steps: [
      { id: 'msk:a', label: 'Point the API at MSK Serverless instead of the local broker' },
      { id: 'msk:b', label: 'Raise the partition count and watch the consumer group rebalance' },
      {
        id: 'msk:c',
        label: 'Choose a retention period deliberately and write down why that number',
      },
      {
        id: 'msk:d',
        label: 'Kill a consumer mid-batch and confirm at-least-once delivery still holds',
      },
    ],
  },
  {
    id: 'amazon-mq',
    area: 'rabbitmq',
    title: 'Amazon MQ material',
    provider: 'AWS Skill Builder — no single path yet',
    url: 'https://skillbuilder.aws/search?searchText=amazon+mq',
    why: 'Amazon MQ carries the report queue over AMQP. Broker sizing, durability settings and dead-letter handling are what a queue asks of you once it is real.',
    gap: true,
    steps: [
      { id: 'amazon-mq:a', label: 'Point the report worker at Amazon MQ over AMQP' },
      {
        id: 'amazon-mq:b',
        label: 'Size the broker against the queue depth the burst profile actually produces',
      },
      {
        id: 'amazon-mq:c',
        label: 'Turn on durability and confirm a queued report survives a broker restart',
      },
      { id: 'amazon-mq:d', label: 'Alarm on dead-letter depth, so a stuck queue pages someone' },
    ],
  },
  {
    id: 'microservices-whitepaper',
    area: 'microservices',
    title: 'Implementing Microservices on AWS',
    provider: 'AWS whitepaper',
    url: 'https://docs.aws.amazon.com/whitepapers/latest/microservices-on-aws/microservices-on-aws.html',
    why: 'Decoupling a monolith is experience; this is the AWS-specific half — service discovery, data consistency across services, and where the seams belong.',
    steps: [
      {
        id: 'microservices-whitepaper:a',
        label: 'Name the seam each service owns, and the data it deliberately does not share',
      },
      {
        id: 'microservices-whitepaper:b',
        label: 'Add the near-datum spatial endpoint from ADR-0012',
      },
      {
        id: 'microservices-whitepaper:c',
        label: 'Replace the fixed poll with server-sent events and measure the difference',
      },
    ],
  },
];

/** Storage key for what has been finished. Namespaced so nothing else collides. */
export const TRAINING_STORAGE_KEY = 'oat.training.launched.v1';
