# Architecture

The decisions behind each component are in the [ADRs](adr/). This document is the
map: what exists, how a request moves through it, and what happens when each part
fails.

## Components

| Component        | Runs as                        | AWS                                  | Locally                   |
| ---------------- | ------------------------------ | ------------------------------------ | ------------------------- |
| Web client       | Static bundle                  | S3 + CloudFront, or nginx in-cluster | nginx container           |
| Telemetry API    | Fastify, stateless             | EKS Deployment behind an ALB         | Container on 8080         |
| Stream processor | Kafka consumer                 | EKS Deployment                       | Container, probes on 8081 |
| Report worker    | RabbitMQ consumer              | EKS Deployment                       | Container, probes on 8082 |
| Simulator        | Load generator, off by default | EKS Deployment                       | Container, probes on 8083 |
| Event stream     | `aircraft.telemetry.v1`        | Amazon MSK Serverless                | Kafka in KRaft mode       |
| Job queue        | `aircraft.report.generate`     | Amazon MQ for RabbitMQ               | RabbitMQ container        |
| Database         | 6 tables                       | Amazon RDS for PostgreSQL            | PostgreSQL container      |

Four shared packages: `shared` (contracts, browser-safe), `data` (SQL and
migrations), `service-kit` (logging, metrics, probes, shutdown, broker setup),
and `web`.

## Ingest, step by step

`POST /api/v1/telemetry`

1. **Validate** against the schema in `packages/shared`. An invalid report is
   rejected with the offending field named, and never reaches the stream or the
   database.
2. **Publish** to Kafka, keyed by `aircraft_id`. If this fails the API returns
   503 and nothing is written — the producer retries.
3. **Project** into `aircraft` and `telemetry_latest`, guarded so an out-of-order
   report cannot overwrite a newer position. Best-effort: a failure here is
   logged and counted but does not fail the request, because the event is already
   in the stream. See [ADR-0008](adr/0008-stream-before-projection.md).
4. **Evaluate inline** so a critical condition appears at the moment it is
   reported rather than one stream hop later. The suppression window in the
   database stops this and the stream processor double-reporting.
5. **Return 202** with the event id.

Nothing slow is on this path.

## Stream processing

Consumer group `telemetry-processors`, three partitions.

1. Parse and validate. A message that cannot be parsed goes to
   `aircraft.telemetry.v1.dlq` with the reason in headers — retrying it would
   block the partition behind it forever.
2. Claim the `event_id` in `processed_events`. Already there means a replay:
   skip it. This is what makes at-least-once delivery survivable.
3. Append to `telemetry_history`, whose natural key on `(aircraft_id, timestamp)`
   absorbs a duplicate that gets past step 2.
4. Derive flight phase and run the anomaly rules, using the previous reading from
   an in-memory per-aircraft cache — safe only because of the partition key.
5. Write alerts, suppressed for 60 seconds per aircraft per kind so a sustained
   condition raises one alert rather than one per report.

A transient failure — the database is down — is rethrown so kafkajs retries the
batch without committing past it. That is the opposite of the quarantine case,
and the distinction is the whole design: _can this ever succeed?_

## Report generation

1. `POST /api/v1/aircraft/{id}/reports` writes a pending row, enqueues a job,
   returns 202 with a URL to poll.
2. A worker takes one job (`prefetch=1`), reads the telemetry window, builds the
   summary, stores it, and acknowledges only then. A crash mid-report leaves the
   message unacknowledged and the broker redelivers it.
3. On failure, the job goes to a delay queue with a 5-second TTL and is
   dead-lettered back to the main queue by the broker. The attempt count travels
   in a header, so three attempts means three overall rather than three per
   worker.
4. After three attempts it is rejected without requeue and the queue's
   dead-letter exchange preserves it for inspection.

## Data model

```
aircraft            one row per airframe: identity, phase, first/last seen
telemetry_latest    one row per airframe, updated in place — what the fleet
                    view reads, so that view never scans history
telemetry_history   append-only, unique on (aircraft_id, ts)
alerts              derived, with a suppression index
reports             status, attempts, error, payload
processed_events    idempotency ledger for at-least-once delivery
demo_state          single row, CHECK (id = 1)
```

Migrations are numbered SQL files applied in order, each inside a transaction
with its ledger write. In a cluster they run as a Helm pre-upgrade Job, not in
the API process — several replicas racing to apply the same DDL is exactly what
that avoids.

## Failure modes

| What fails                    | What happens                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An API pod                    | Stateless; the load balancer routes elsewhere. No impact.                                                                                                                                            |
| Kafka unreachable             | Ingest returns 503 and reports are not accepted. `/health` stays up so pods are not killed; `/ready` goes false so they leave the load balancer; a background loop reconnects with jittered backoff. |
| Stream processor stops        | Ingest and current state keep working. History and alerts stop. Lag climbs visibly. On restart it resumes from its committed offset — nothing is lost.                                               |
| Unparseable event             | Quarantined to the DLQ with the reason. The partition keeps moving.                                                                                                                                  |
| Duplicate event               | Skipped by the ledger; the history constraint is the backstop.                                                                                                                                       |
| RabbitMQ unreachable          | Report requests return 503 and the row stays visibly pending. Telemetry is unaffected.                                                                                                               |
| A report job fails            | Retried three times through the delay queue, then dead-lettered. Visible as `dead_lettered` on the dashboard.                                                                                        |
| Report worker crashes mid-job | The message was never acknowledged, so it is redelivered.                                                                                                                                            |
| Database unreachable          | Everything reports not-ready. Ingest still publishes to the stream, so events are not lost; projections catch up.                                                                                    |
| An AZ fails                   | Nodes and subnets span two AZs. RDS Multi-AZ fails over in production; the demo's single-instance RabbitMQ does not, which is a documented trade.                                                    |

## Scaling

- **API** — horizontal, CPU-bound on JSON validation. HPA at 70% CPU, 2–8 pods.
- **Stream processor** — up to the partition count, then add partitions. Extra
  replicas beyond that sit idle.
- **Report worker** — add replicas; the broker balances with `prefetch=1`. The
  HPA is deliberately off: CPU is the wrong signal for a queue worker, and the
  right one needs KEDA. See [ADR-0009](adr/0009-explain-rather-than-implement.md).
- **Database** — vertical first, then read replicas for dashboard queries. Writes
  are one row per report.
- **Kafka** — MSK Serverless scales broker capacity without a sizing decision.

## Security

No static AWS credentials exist anywhere. Applications assume a per-application
IAM role through EKS Pod Identity; MSK authenticates that role over
SASL/OAUTHBEARER. Database and broker passwords are generated by Terraform into
Secrets Manager, never passed as variables or printed as outputs.

The database and both brokers are in private subnets, and their security groups
reference the cluster's workload security group rather than a CIDR. `rds.force_ssl`
means an unencrypted connection is refused, not merely discouraged. Containers run
non-root with a read-only root filesystem and all capabilities dropped.

Full list, including what is deliberately absent, in [SECURITY.md](../SECURITY.md).

## Observability

Every service emits JSON logs with a request id that propagates across the API,
the processor and the worker, so one telemetry report can be followed with a
single query. Every service exposes Prometheus metrics on `/metrics` and separate
`/health` and `/ready` probes.

The distinction between those two probes is deliberate and is the kind of thing
that only hurts once: **liveness failing kills the pod, readiness failing removes
it from service.** Pointing liveness at a dependency check turns a thirty-second
broker blip into a cluster-wide restart storm.
