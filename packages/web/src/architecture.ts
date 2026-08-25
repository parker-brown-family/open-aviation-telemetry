import { CONSUMER_GROUPS, MAX_JOB_ATTEMPTS, RABBIT, THRESHOLDS, TOPICS } from '@oat/shared';

/**
 * Content for the Architecture Explorer.
 *
 * Where a value is a real constant — a topic name, a queue name, a retry count,
 * an alert threshold — it is imported from the shared contracts rather than
 * typed out here. Documentation that reads from the implementation cannot drift
 * away from it, and a reviewer who checks one of these numbers against the code
 * will find they match.
 */

export interface ArchNode {
  id: string;
  label: string;
  awsService: string;
  localEquivalent: string;
  /** Position on the diagram, in the 0..100 coordinate space of the SVG. */
  x: number;
  y: number;
  group: 'edge' | 'compute' | 'data' | 'messaging' | 'platform';
  what: string;
  why: string;
  alternative: string;
  failure: string;
  scaling: string;
  security: string;
  /** Files a reader should open to see this component implemented. */
  source: string[];
}

export interface ArchEdge {
  from: string;
  to: string;
  label: string;
  kind: 'sync' | 'async' | 'read';
}

export const ARCH_NODES: ArchNode[] = [
  {
    id: 'client',
    label: 'Web client',
    awsService: 'S3 + CloudFront, or any static host',
    localEquivalent: 'Vite dev server',
    x: 8,
    y: 20,
    group: 'edge',
    what: 'A React single-page application: fleet dashboard, alerts, this explorer, and the demo console.',
    why:
      'The client is a static bundle with no server-side rendering, so it can be hosted anywhere — ' +
      'a CDN, an nginx container in the cluster, or a subdirectory of an existing site. ' +
      'That is what makes it publishable independently of whether the backend is running.',
    alternative:
      'Server-side rendering would improve first paint and SEO. Neither matters for an ' +
      'authenticated operations console, and SSR would tie the client to a Node runtime ' +
      'it does not otherwise need.',
    failure:
      'If the API is unreachable the client says so in the header and falls back to a bundled ' +
      'sample dataset rather than showing an empty page or, worse, plausible numbers with no ' +
      'indication that nothing is live.',
    scaling: 'Static assets. Scaling is a CDN concern, not an application one.',
    security:
      'No credentials in the bundle. The API base URL is injected at build time. ' +
      'Anything requiring authorisation would be enforced at the API, never in the client.',
    source: ['packages/web/src/data-source.tsx', 'packages/web/src/api.ts'],
  },
  {
    id: 'alb',
    label: 'Ingress',
    awsService: 'AWS Load Balancer Controller (ALB)',
    localEquivalent: 'Direct port mapping',
    x: 24,
    y: 20,
    group: 'edge',
    what: 'Terminates TLS and routes external traffic to the API service inside the cluster.',
    why:
      'An ALB provisioned from a Kubernetes Ingress keeps the routing rules next to the ' +
      'workload they describe, so a new route ships with the deployment that needs it.',
    alternative:
      'A Network Load Balancer would be cheaper and faster but moves TLS termination and ' +
      'path routing into the application. An API Gateway would add request-level features ' +
      'this system does not use.',
    failure:
      'The load balancer health-checks /ready. A pod whose database or broker is unreachable ' +
      'reports not-ready and is removed from the target group without being killed.',
    scaling:
      'Managed and horizontally scaled by AWS. Capacity is not a decision this project has to ' +
      'make; target registration follows the pods as they scale.',
    security:
      'The only public entry point. Everything behind it — database, brokers, pods — sits in ' +
      'private subnets with no route to the internet except through a NAT gateway.',
    source: ['charts/open-aviation-telemetry/templates/ingress.yaml'],
  },
  {
    id: 'api',
    label: 'Telemetry API',
    awsService: 'Amazon EKS (Deployment)',
    localEquivalent: 'Node container',
    x: 44,
    y: 20,
    group: 'compute',
    what:
      'Validates incoming telemetry, publishes it to the event stream, updates the current-state ' +
      'projection, and serves every read the dashboard needs.',
    why:
      'Ingest is deliberately short: validate, publish, project, return 202. Anything that could ' +
      'be slow — history, anomaly analysis over a window, report generation — happens downstream, ' +
      'so a slow analytic path can never slow down an aircraft reporting its position.',
    alternative:
      'Writing straight to the database and analysing on read would remove Kafka entirely and ' +
      'be simpler. It also couples every future consumer to this database and makes replay ' +
      'impossible, which is the trade being made here.',
    failure:
      'Stateless, so any replica can serve any request and a lost pod costs nothing. If Kafka is ' +
      'unavailable, ingest returns 503 rather than accepting a report it cannot publish — the ' +
      'aircraft retries, and no telemetry is silently dropped.',
    scaling:
      'Horizontal. CPU-bound on JSON validation, so the Horizontal Pod Autoscaler tracks CPU.',
    security:
      'Runs as a non-root user in a read-only container. Database credentials come from Secrets ' +
      'Manager; AWS access comes from the pod’s own IAM role via EKS Pod Identity, so there ' +
      'are no static AWS keys anywhere in the image or the environment.',
    source: ['packages/telemetry-api/src/routes/fleet.ts', 'packages/telemetry-api/src/app.ts'],
  },
  {
    id: 'kafka',
    label: 'Event stream',
    awsService: 'Amazon MSK Serverless',
    localEquivalent: 'Kafka in KRaft mode',
    x: 64,
    y: 8,
    group: 'messaging',
    what: `Topic ${TOPICS.telemetry}, partitioned by aircraft_id. Consumer group ${CONSUMER_GROUPS.telemetryProcessors}.`,
    why:
      'Telemetry is a stream of facts, not a queue of commands. Kafka keeps them, replays them, ' +
      'and lets a second consumer be added later without the producer knowing. Partitioning by ' +
      'aircraft_id gives ordering per airframe and parallelism across the fleet at the same time.',
    alternative:
      'SQS is simpler to operate and cheaper at this volume, but a message is gone once consumed: ' +
      'no replay, no second independent consumer, no ordering guarantee per aircraft. ' +
      'Kinesis is the closer AWS-native match; Kafka was chosen because the skill is portable.',
    failure:
      'A message that can never be processed — malformed JSON, a schema violation — is published ' +
      `to ${TOPICS.telemetryDlq} with the failure reason in headers, so one bad message cannot ` +
      'block the partition behind it. A transient failure is retried instead, and the offset is ' +
      'not committed past it.',
    scaling:
      'Partitions are the unit of parallelism: consumer instances up to the partition count share ' +
      'the load. MSK Serverless scales broker capacity without a capacity decision up front.',
    security:
      'IAM authentication over SASL/OAUTHBEARER. There is no password — the pod’s IAM role is ' +
      'the credential and the token is minted per connection.',
    source: ['packages/shared/src/events.ts', 'packages/service-kit/src/kafka.ts'],
  },
  {
    id: 'consumer',
    label: 'Stream processor',
    awsService: 'Amazon EKS (Deployment)',
    localEquivalent: 'Node container',
    x: 84,
    y: 8,
    group: 'compute',
    what:
      'Consumes telemetry events, deduplicates replays, appends history, derives flight phase, ' +
      'and raises alerts from the detection rules.',
    why:
      'Analysis belongs off the request path. It can also be scaled, restarted and deployed ' +
      'independently of the API, which matters because the two have completely different ' +
      'load profiles.',
    alternative:
      'Kinesis Data Analytics or Flink would offer real windowing and stateful stream operators. ' +
      'The rules here are per-sample with one prior reading, so a plain consumer is enough — ' +
      'and much easier to test.',
    failure:
      'At-least-once delivery means events can arrive twice. Every event id is claimed in a ' +
      'ledger table before processing, and history has a natural key on (aircraft_id, timestamp), ' +
      'so a replay is a no-op rather than a duplicate.',
    scaling:
      'Add replicas up to the partition count. Beyond that, add partitions. In-memory per-aircraft ' +
      'state is safe precisely because one partition has exactly one consumer.',
    security: 'No inbound traffic. Only egress to the broker and the database.',
    source: [
      'packages/telemetry-consumer/src/main.ts',
      'packages/telemetry-consumer/src/processor.ts',
    ],
  },
  {
    id: 'rabbit',
    label: 'Job queue',
    awsService: 'Amazon MQ for RabbitMQ',
    localEquivalent: 'RabbitMQ container',
    x: 64,
    y: 34,
    group: 'messaging',
    what: `Queue ${RABBIT.reportQueue}, with a ${RABBIT.retryDelayMs}ms delay queue and a dead-letter queue.`,
    why:
      'Report generation is a command: do this specific thing once, tell me when it is done. ' +
      'That wants acknowledgements, per-message retry and a dead-letter destination — queue ' +
      'semantics, not log semantics. Using Kafka for it would mean rebuilding all three by hand.',
    alternative:
      'SQS with a redrive policy does the same job with less to operate, and would be the ' +
      'pragmatic choice on AWS alone. RabbitMQ is here because the routing model is richer and ' +
      'because running both brokers side by side makes the distinction concrete.',
    failure:
      `A failed job is republished to the delay queue and returns to the main queue after ` +
      `${RABBIT.retryDelayMs}ms. After ${MAX_JOB_ATTEMPTS} attempts it is dead-lettered and kept ` +
      'for inspection rather than dropped. A malformed job skips retrying entirely — the bytes ' +
      'will not change.',
    scaling: 'Add worker replicas. With prefetch=1 the broker balances work across them naturally.',
    security:
      'Credentials from Secrets Manager, TLS in transit, private subnets only. ' +
      'Production would use a three-node cluster across availability zones rather than the ' +
      'single instance used for a demo.',
    source: ['packages/service-kit/src/rabbit.ts', 'packages/shared/src/jobs.ts'],
  },
  {
    id: 'worker',
    label: 'Report worker',
    awsService: 'Amazon EKS (Deployment)',
    localEquivalent: 'Node container',
    x: 84,
    y: 34,
    group: 'compute',
    what: 'Consumes report jobs, builds a flight summary from telemetry history, and stores it.',
    why:
      'Report generation is unbounded work over a time window. On the request path it would be a ' +
      'timeout; on a worker it is a job with a status the client can poll.',
    alternative:
      'AWS Lambda fits this shape well and would remove the idle cost. It was not used here ' +
      'because the point of the project is to show one Kubernetes deployment model applied ' +
      'consistently, not to mix two runtimes.',
    failure:
      'A job is acknowledged only after its result is durably written. A worker that crashes ' +
      'mid-report leaves the message unacknowledged, so the broker redelivers it to another worker.',
    scaling: 'Add replicas. Queue depth is the signal to scale on, not CPU.',
    security: 'No inbound traffic. Egress to the broker and the database only.',
    source: ['packages/report-worker/src/main.ts', 'packages/report-worker/src/summary.ts'],
  },
  {
    id: 'rds',
    label: 'PostgreSQL',
    awsService: 'Amazon RDS for PostgreSQL',
    localEquivalent: 'PostgreSQL container',
    x: 64,
    y: 62,
    group: 'data',
    what: 'Current fleet state, telemetry history, alerts, reports, the idempotency ledger and demo state.',
    why:
      'The data is relational and the queries are relational: joins, aggregates over a window, ' +
      'uniqueness constraints. A single well-indexed PostgreSQL instance handles this workload ' +
      'comfortably and one storage engine is one thing to operate, back up and reason about.',
    alternative:
      'DynamoDB would scale writes further and suit the write-heavy telemetry path, but the ' +
      'dashboard’s aggregate queries would then have to be maintained as precomputed views. ' +
      'Timestream is the natural fit for the history table specifically, and would be the first ' +
      'thing to split out if retention became the binding constraint.',
    failure:
      'Multi-AZ in production: a failover promotes the standby and the connection pool reconnects. ' +
      'A projection write failing on the ingest path does not fail the request, because the event ' +
      'is already in the stream and the next report repairs the projection.',
    scaling:
      'Vertical first, then read replicas for the dashboard queries. The write path is a single ' +
      'row per report, which is cheap.',
    security:
      'Private subnets, no public accessibility, security group restricted to the pods’ ' +
      'security group, credentials in Secrets Manager, encryption at rest and in transit.',
    source: ['packages/data/src/repository.ts', 'packages/data/migrations/001_init.sql'],
  },
  {
    id: 'observability',
    label: 'Logs and metrics',
    awsService: 'Amazon CloudWatch',
    localEquivalent: 'Container logs and /metrics',
    x: 44,
    y: 62,
    group: 'platform',
    what:
      'Structured JSON logs from every service, Prometheus metrics on /metrics, and probe ' +
      'endpoints on /health and /ready.',
    why:
      'Every service logs JSON with a request id, so one telemetry report can be followed across ' +
      'the API, the stream processor and the worker with a single query. Liveness and readiness ' +
      'are kept separate on purpose: readiness failing removes a pod from service, liveness ' +
      'failing kills it, and conflating the two turns a brief broker outage into a restart storm.',
    alternative:
      'A managed Prometheus and Grafana stack gives better dashboards and query ergonomics. ' +
      'CloudWatch is here because it needs no extra infrastructure to operate.',
    failure:
      'Observability failing must never take the application with it. Metrics are in-process ' +
      'counters with no external dependency, and log shipping is the agent’s problem.',
    scaling: 'Log volume is the cost driver; retention is set explicitly rather than left forever.',
    security: 'Log redaction strips authorisation headers, cookies and connection strings.',
    source: ['packages/service-kit/src/metrics.ts', 'packages/service-kit/src/health-server.ts'],
  },
  {
    id: 'eks',
    label: 'Cluster',
    awsService: 'Amazon EKS',
    localEquivalent: 'Docker Compose',
    x: 24,
    y: 62,
    group: 'platform',
    what:
      'Runs all four services as Deployments with readiness and liveness probes, resource ' +
      'requests and limits, rolling updates and horizontal autoscaling.',
    why:
      'The workloads are long-running and heterogeneous: one serves HTTP, two consume from ' +
      'brokers, one generates load. Kubernetes gives all four the same deployment, restart, ' +
      'scaling and rollout model rather than four different ones.',
    alternative:
      'ECS on Fargate would be materially simpler to operate for four services and is the right ' +
      'answer for many teams. EKS is used here because Kubernetes is the target skill and because ' +
      'the manifests are portable off AWS.',
    failure:
      'A pod that fails liveness is restarted; a node that fails is drained and replaced; a ' +
      'rollout that never becomes ready is halted with the previous version still serving.',
    scaling: 'Horizontal Pod Autoscaler per deployment; managed node group scales the nodes.',
    security:
      'One IAM role per application via EKS Pod Identity, so a compromised service has only its ' +
      'own permissions. Non-root containers, dropped capabilities, no static AWS credentials.',
    source: ['infra/terraform/modules/eks/main.tf', 'charts/open-aviation-telemetry'],
  },
  {
    id: 'terraform',
    // Short label, longer description on the service line: SVG does not wrap
    // text, so "Infrastructure as code" as a label overflows into the box
    // beside it.
    label: 'Terraform',
    awsService: 'Infrastructure as code',
    localEquivalent: 'Not applicable — this describes the AWS environment only.',
    x: 8,
    y: 62,
    group: 'platform',
    what: 'Every AWS resource: VPC, subnets, EKS, RDS, MSK, Amazon MQ, ECR, IAM, CloudWatch.',
    why:
      'Terraform is the single owner of deployed infrastructure. The AWS CDK stack in this ' +
      'repository is a reference implementation for comparison only and manages nothing, ' +
      'because two tools owning the same resource is how state files start fighting.',
    alternative:
      'CDK generates CloudFormation and gives real language constructs, which is genuinely nicer ' +
      'for complex logic. Terraform was chosen for its explicit plan and its portability; ' +
      'infra/cdk-reference exists so the comparison is concrete rather than theoretical.',
    failure:
      'A plan is reviewed before every apply. State is remote with locking so two applies cannot ' +
      'race. Nothing is created by hand in the console, so nothing drifts silently.',
    scaling: 'Modules per concern, one environment directory per environment.',
    security:
      'No secrets in state or variables; generated credentials go to Secrets Manager. ' +
      'State bucket encrypted, versioned and private.',
    source: ['infra/terraform', 'infra/cdk-reference'],
  },
];

export const ARCH_EDGES: ArchEdge[] = [
  { from: 'client', to: 'alb', label: 'HTTPS', kind: 'sync' },
  { from: 'alb', to: 'api', label: 'HTTP', kind: 'sync' },
  { from: 'api', to: 'kafka', label: 'publish telemetry', kind: 'async' },
  { from: 'kafka', to: 'consumer', label: 'consume', kind: 'async' },
  { from: 'api', to: 'rabbit', label: 'enqueue job', kind: 'async' },
  { from: 'rabbit', to: 'worker', label: 'consume', kind: 'async' },
  { from: 'api', to: 'rds', label: 'project + read', kind: 'read' },
  { from: 'consumer', to: 'rds', label: 'history + alerts', kind: 'read' },
  { from: 'worker', to: 'rds', label: 'read + write report', kind: 'read' },
];

export interface TourStep {
  title: string;
  nodeId: string;
  body: string;
}

/**
 * The guided walkthrough: one telemetry report, followed end to end.
 *
 * Ordered so each step answers the question the previous one raises.
 */
export const TOUR: TourStep[] = [
  {
    title: 'An aircraft reports its position',
    nodeId: 'api',
    body:
      'A report arrives at POST /api/v1/telemetry and is validated against a schema shared with ' +
      'every other service. An invalid report is rejected here with the specific field that ' +
      'failed, and never enters the system.',
  },
  {
    title: 'The event is published before anything else',
    nodeId: 'kafka',
    body:
      'The report is published to aircraft.telemetry.v1, keyed by aircraft_id. The stream is the ' +
      'system of record: if the database write that follows fails, the event still exists and the ' +
      'projection repairs itself on the next report.',
  },
  {
    title: 'Current state is updated, then the request returns',
    nodeId: 'rds',
    body:
      'One row per airframe is updated in place — guarded so an out-of-order report cannot ' +
      'overwrite a newer position. The API returns 202 at this point. Nothing slow has happened yet.',
  },
  {
    title: 'The stream processor picks the event up',
    nodeId: 'consumer',
    body:
      'A separate deployment consumes the topic. It claims the event id in a ledger first, so a ' +
      'redelivery after a rebalance is skipped rather than double-counted.',
  },
  {
    title: 'Telemetry becomes derived state',
    nodeId: 'consumer',
    body:
      `History is appended, flight phase is derived, and the detection rules run — engine over ` +
      `${THRESHOLDS.engineTempWarningC}C, descent past ${Math.abs(THRESHOLDS.rapidDescentFpm)} fpm, ` +
      'and the rest. Alerts are suppressed for a minute per aircraft per kind so a sustained ' +
      'condition raises one alert, not one per report.',
  },
  {
    title: 'A report is requested — and does not block',
    nodeId: 'rabbit',
    body:
      'Requesting a flight summary writes a pending row and enqueues a job. The API returns 202 ' +
      'with a URL to poll. Generation happens on a worker, where taking ten seconds is fine.',
  },
  {
    title: 'The worker does the work, and can fail safely',
    nodeId: 'worker',
    body:
      `The worker builds the summary and acknowledges only once it is stored. A failure is ` +
      `retried ${MAX_JOB_ATTEMPTS} times through a delay queue, then dead-lettered for inspection. ` +
      'You can watch this happen from the demo console.',
  },
  {
    title: 'Everything is observable',
    nodeId: 'observability',
    body:
      'Each service emits structured logs, Prometheus metrics and separate liveness and readiness ' +
      'probes. Consumer lag and queue depth on the dashboard are read from the brokers, not ' +
      'estimated.',
  },
  {
    title: 'And all of it is described in code',
    nodeId: 'terraform',
    body:
      'Terraform defines every AWS resource; Helm defines every workload. Nothing was clicked ' +
      'into existence, so the environment can be destroyed and recreated on demand.',
  },
];

export const NODE_BY_ID = new Map(ARCH_NODES.map((n) => [n.id, n]));

/**
 * Short service names, used in the diagram only.
 *
 * The full name belongs in the detail panel, where there is room to read it:
 * "Amazon RDS for PostgreSQL" is more useful than "Amazon RDS". In a 15-unit
 * box it is simply too wide, and SVG text neither wraps nor clips — it draws
 * across the next box.
 *
 * Authored short forms rather than an ellipsis: "Amazon RDS" reads as a
 * deliberate abbreviation, "Amazon RDS for Postgre…" reads as a bug. Where a
 * node has no entry the full name is used, and the fit test will fail if that
 * name is too long — so a new node cannot silently overflow.
 */
export const DIAGRAM_SERVICE: Record<string, string> = {
  client: 'Static host',
  alb: 'ALB ingress',
  api: 'Amazon EKS',
  kafka: 'Amazon MSK',
  consumer: 'Amazon EKS',
  rabbit: 'Amazon MQ',
  worker: 'Amazon EKS',
  rds: 'Amazon RDS',
  observability: 'CloudWatch',
  eks: 'Amazon EKS',
  terraform: 'Infra as code',
};

/** The service line as drawn in the diagram box. */
export const diagramService = (node: ArchNode): string =>
  DIAGRAM_SERVICE[node.id] ?? node.awsService;
