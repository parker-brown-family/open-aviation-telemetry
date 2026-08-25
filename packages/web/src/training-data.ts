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
  },
  {
    id: 'rds-postgres-core',
    area: 'rds',
    title: 'PostgreSQL for Aurora and RDS — Core Concepts',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/learning-plan/X523RHDM8P/postgresql-for-amazon-aurora-and-rds--core-concepts-learning-plan/GTSFUXJV8F',
    why: 'The operating model around the database rather than the SQL inside it: parameter groups, backups, failover behaviour, connection limits. What decides whether a write path stays up.',
  },
  {
    id: 'rds-postgres-advanced',
    area: 'rds',
    title: 'PostgreSQL for Aurora and RDS — Advanced Concepts badge',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/learning-plan/VZ3TF49CG6/postgresql-for-amazon-aurora-and-amazon-rds--advanced-concepts-knowledge-badge-readiness-path/5U9VV8BN4M',
    why: 'Tuning, partitioning and replication. A telemetry table takes one row per report per airframe per interval, which is where those three stop being academic.',
  },
  {
    id: 'cloud-practitioner',
    area: 'aws',
    title: 'AWS Cloud Practitioner Essentials',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/learn/94T2BEN85A/aws-cloud-practitioner-essentials/8D79F3AVR7',
    why: 'The cheap sweep for vocabulary gaps — service families, IAM boundaries, billing shape — so nothing that goes on a whiteboard is unfamiliar.',
  },
  {
    id: 'solutions-architect-associate',
    area: 'microservices',
    title: 'AWS Certified Solutions Architect – Associate, exam prep',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/learning-plan/UYRXS2DF85/exam-prep-plan-aws-certified-solutions-architect--associate-saac03--english/U991QUF9C3',
    why: 'The one that maps onto running services at scale: sizing, failure isolation, multi-AZ, and the trade-offs behind an architecture like this one.',
  },
  {
    id: 'developer-associate',
    area: 'aws',
    title: 'AWS Certified Developer – Associate',
    provider: 'AWS Skill Builder',
    url: 'https://skillbuilder.aws/search?searchText=aws-certified-developer-associate',
    why: 'SDK-level detail: retries, idempotency, credential handling. The failure modes you only meet in code.',
  },
  {
    id: 'msk',
    area: 'kafka',
    title: 'Amazon MSK material',
    provider: 'AWS Skill Builder — no single path yet',
    url: 'https://skillbuilder.aws/search?searchText=amazon+msk',
    why: 'MSK carries the telemetry stream here and the API publishes to it before acknowledging a report, so the build teaches the shape. Partitioning, consumer-group rebalancing and retention are the parts it does not.',
    gap: true,
  },
  {
    id: 'amazon-mq',
    area: 'rabbitmq',
    title: 'Amazon MQ material',
    provider: 'AWS Skill Builder — no single path yet',
    url: 'https://skillbuilder.aws/search?searchText=amazon+mq',
    why: 'Amazon MQ carries the report queue over AMQP. Broker sizing, durability settings and dead-letter handling are what a queue asks of you once it is real.',
    gap: true,
  },
  {
    id: 'microservices-whitepaper',
    area: 'microservices',
    title: 'Implementing Microservices on AWS',
    provider: 'AWS whitepaper',
    url: 'https://docs.aws.amazon.com/whitepapers/latest/microservices-on-aws/microservices-on-aws.html',
    why: 'Decoupling a monolith is experience; this is the AWS-specific half — service discovery, data consistency across services, and where the seams belong.',
  },
];

/** Storage key for what has been finished. Namespaced so nothing else collides. */
export const TRAINING_STORAGE_KEY = 'oat.training.launched.v1';
