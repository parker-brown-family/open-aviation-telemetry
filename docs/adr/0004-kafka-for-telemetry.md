# ADR-0004: Kafka for the telemetry stream, partitioned by aircraft

**Status:** Accepted

## Context

Telemetry arrives continuously: one report per aircraft every few seconds, and
in the burst profile four per second across a hundred airframes. Something has
to carry those reports from the ingest API to whatever processes them.

The requirements that actually constrain the choice:

- Ingest must not slow down because a downstream consumer is slow.
- Reports for one airframe must be processed in order, because several derived
  signals — vertical rate, telemetry gaps, phase transitions — depend on the
  previous reading.
- Reports for _different_ airframes have no ordering relationship, so serialising
  the whole fleet would be a waste.
- A second consumer should be addable later without the producer changing.

## Decision

Publish telemetry to a Kafka topic, `aircraft.telemetry.v1`, **keyed by
`aircraft_id`**. On AWS this is Amazon MSK Serverless.

The key is the load-bearing part. Kafka assigns a partition by hashing the key,
so every report for one airframe lands on one partition, and a partition is
consumed by exactly one member of a consumer group. That yields ordering per
aircraft and concurrency across the fleet from a single decision.

It also makes something else safe: the stream processor keeps the last reading
per aircraft in memory. That is only correct because one consumer owns that
airframe's whole ordered history. Change the partition key and that cache
silently becomes wrong — which is why the key is an architectural decision and
not an implementation detail.

## Alternatives considered

**Amazon SQS.** Simpler to run, cheaper at this volume, and the pragmatic
default for a queue on AWS. Rejected because a message is gone once consumed:
no replay, no independent second consumer, and no ordering guarantee unless you
use a FIFO queue, whose throughput ceiling and message-group semantics are a
poor fit for continuous per-entity streams.

**Amazon Kinesis Data Streams.** Closest AWS-native match — shards behave much
like partitions and the ordering guarantee is the same. It would be a reasonable
choice. Kafka was picked because the API is portable and the operational
vocabulary (consumer groups, offsets, lag, rebalancing) is the one worth being
able to discuss.

**No broker at all.** Write to PostgreSQL and analyse on read. Genuinely simpler,
and correct for a smaller system. Rejected because it couples every future
consumer to this database's schema, makes replay impossible, and puts analysis
on the ingest path.

**MSK provisioned rather than serverless.** More control and cheaper at sustained
high throughput. Rejected because it turns the project into a broker-sizing
exercise — instance types, storage, rebalancing — which is not what it is trying
to demonstrate.

## Consequences

- Ingest returns as soon as the event is durably accepted; analysis happens
  downstream and can be slow without anyone noticing.
- Consumer replicas beyond the partition count sit idle. Scaling the processing
  tier past three means adding partitions first.
- At-least-once delivery means duplicates are normal, so the consumer claims each
  `event_id` in a ledger table before processing and history carries a natural
  key on `(aircraft_id, timestamp)`. Both are needed: the ledger stops
  reprocessing, the constraint stops a duplicate row if it somehow does.
- A message that can never be processed goes to `aircraft.telemetry.v1.dlq` with
  the reason in headers, rather than being retried forever and blocking the
  partition behind it.
- Kafka is one more thing to run. Locally that is a container; on AWS it is a
  managed service with an IAM policy.

## Related

- [ADR-0005](0005-rabbitmq-for-work-items.md) — why there is also a queue
- [ADR-0008](0008-stream-before-projection.md) — publish order
