# ADR-0008: Publish to the stream before writing the projection

**Status:** Accepted

## Context

Ingesting one telemetry report does two things: publishes an event to Kafka, and
updates the current-state row that the fleet view reads. They cannot be made
atomic — one is a broker, the other a database, and there is no transaction
across both.

So one of them happens first, and the failure modes differ.

## Decision

Publish to Kafka first. Then write the projection, best-effort.

If the publish fails, the API returns 503 and the report is not accepted; the
producer retries. If the projection write fails afterwards, the request still
returns 202, the failure is logged and counted, and the next report repairs the
row.

## Why this order

The stream is the system of record. `telemetry_latest` is a projection of it, and
a projection that is briefly stale is a much smaller problem than an event that
was never published.

Database-first has the worse failure: the database records a report that no
consumer will ever see. Nothing downstream ever knows it happened — no history
row, no alert evaluation, no replay. That inconsistency does not heal, because
nothing is left to notice it.

Stream-first fails safely in both directions:

| Failure                      | Outcome                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Kafka publish fails          | 503, nothing written, producer retries. No loss.                                                         |
| Projection write fails       | Event is in the stream. History and alerts still happen via the consumer. The next report fixes the row. |
| Producer retries after a 503 | A new event id, but history's `(aircraft_id, timestamp)` constraint absorbs the duplicate.               |

## What this is not

This is not a transactional outbox, which is the fully correct answer: write the
event to an outbox table in the same transaction as the state change, and have a
relay publish it. That gives exactly-once handoff between the database and the
broker.

It is not implemented here because it needs a relay process, an outbox table and
ordering guarantees in the relay — real complexity for a guarantee this system
does not need, since the projection is self-healing and history is deduplicated.

Recording that trade-off is the point of this ADR. If the projection ever became
authoritative for something that could not be recomputed, the outbox is where
this design should go next.

## Consequences

- The API's contract is "your event has been accepted into the stream", which is
  what the 202 means.
- A projection failure is invisible to the client and visible in the
  `projection_failures` counter, which is where it belongs.
- The ingest path is short: validate, publish, project, return. Nothing slow is
  on it.

## Related

- [ADR-0004](0004-kafka-for-telemetry.md) — the stream
