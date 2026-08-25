# ADR-0005: RabbitMQ for jobs, alongside Kafka rather than instead of it

**Status:** Accepted

## Context

Requesting a flight summary means reading a window of telemetry history,
computing distances and maxima over it, and storing the result. It is unbounded
work: fine for a hundred samples, slow for fifty thousand. On the request path
it becomes a timeout.

Kafka is already in the system, so the obvious question is why not use it.

## Decision

Use RabbitMQ for report generation — Amazon MQ for RabbitMQ on AWS — and keep
Kafka for telemetry events.

The distinction is not "two brokers because we can". It is that the two carry
different things:

|               | Kafka                           | RabbitMQ                             |
| ------------- | ------------------------------- | ------------------------------------ |
| Carries       | A fact: _this happened_         | A command: _do this_                 |
| Readers       | Any number, independently       | Exactly one, once                    |
| After reading | Still there, replayable         | Acknowledged and gone                |
| On failure    | Consumer retries from an offset | Message redelivered or dead-lettered |
| Unit of scale | Partitions                      | Consumers                            |

Telemetry is a fact. A report request is a command. Report generation needs
per-message acknowledgement, per-message retry with a delay, and a place for
messages that have exhausted their attempts. Kafka has none of those as
primitives — you can build them, and building them means writing a retry
scheduler and a poison-message store by hand on top of an offset-based log.

## How retry works here

RabbitMQ has no native delayed retry without a plugin, so the topology does it:

```
aircraft.jobs (direct)
  └─ report.generate ──▶ aircraft.report.generate
                           │ rejected, no requeue
                           ▼
                         aircraft.jobs.dlx (fanout)
                           └─▶ aircraft.report.generate.dlq

aircraft.report.generate.retry   (5s TTL, no consumer)
  └─ expires ──▶ aircraft.jobs / report.generate
```

A failed job is republished to the retry queue, sits there for five seconds with
nothing consuming it, and is then dead-lettered by the broker back onto the main
queue. The attempt count travels in a message header, so three attempts means
three attempts overall rather than three per worker. On the third failure the
message is rejected without requeue and the queue's dead-letter exchange puts it
somewhere a human can look at it.

`prefetch=1` means a worker takes one job, finishes it, then takes another. With
several replicas that gives natural load balancing: a slow job occupies one
worker instead of a queue of pre-assigned work stuck behind it.

## Alternatives considered

**Amazon SQS with a redrive policy.** Does the same job with materially less to
operate, and on AWS alone it is the more sensible choice — no broker instance, no
version upgrades, no clustering decision. Rejected here because the routing model
is thinner and because running both brokers side by side is what makes the
Kafka-versus-queue distinction concrete rather than a paragraph.

**Kafka with a `report.requests` topic.** Removes a component. Rejected because
every queue feature would have to be rebuilt: per-message acknowledgement,
delayed retry, a dead-letter destination, and a way for one slow job not to block
the partition behind it.

**AWS Lambda.** A genuinely good fit for this shape of work and it would remove
the idle cost of a worker. Rejected because it would mix two runtimes into a
project whose point is one consistent Kubernetes deployment model.

**Do it synchronously.** Simplest, and correct until the first aircraft with a
long history. Rejected on that basis.

## Consequences

- Two brokers to run and understand. That is a real cost, accepted because the
  distinction is the thing being demonstrated.
- A report request returns 202 with a URL to poll; the client never waits.
- Retry and dead-lettering are observable from the demo console, so the failure
  path can be shown rather than described.
- A single-instance Amazon MQ broker has no redundancy — losing the AZ loses the
  queue until it is restored. Production sets `CLUSTER_MULTI_AZ`, which is a
  variable in the Terraform.

## Related

- [ADR-0004](0004-kafka-for-telemetry.md) — the stream
