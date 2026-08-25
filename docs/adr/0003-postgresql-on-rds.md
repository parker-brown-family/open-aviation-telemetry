# ADR-0003: One PostgreSQL database, shared by three services

**Status:** Accepted

## Context

The system stores current fleet state, telemetry history, alerts, generated
reports, an idempotency ledger and demo control state. Three services write to
it: the API, the stream processor and the report worker.

"A shared database between microservices" is a well-known anti-pattern, so the
choice needs stating rather than assuming.

## Decision

One Amazon RDS for PostgreSQL instance, reached through one shared data-access
package (`packages/data`) that all three services import.

## Why this is not the anti-pattern

The anti-pattern is two _bounded contexts_ sharing storage, so that one team's
schema change breaks another team's service, and neither owns the data.

That is not this. The three services are one bounded context split by
**workload** — synchronous request handling, stream processing, background jobs —
not by domain. They are deployed together, versioned together, and share one
vocabulary. Giving each its own database would mean the report worker could not
read the telemetry it is summarising without an API call that exists only to
satisfy a diagram.

The shared data-access package matters for the same reason. Three copies of the
same SQL would drift; one copy cannot.

## Why relational

The queries are relational: aggregates over a time window, a uniqueness
constraint that absorbs replayed events, a join from aircraft to latest
telemetry, ordering by time within an aircraft. All of that is what a relational
database is for, and a single well-indexed PostgreSQL instance handles this
volume comfortably.

One storage engine is also one thing to back up, monitor and reason about.

## Alternatives considered

**DynamoDB.** Would scale the telemetry write path much further and suits the
access pattern for current state. Rejected because the dashboard's aggregate
queries would have to become precomputed views maintained by the application —
real work, in exchange for scale this system does not need.

**Amazon Timestream for history.** The natural fit for the append-only telemetry
table specifically, with retention tiers built in. This is the first thing to
split out if retention became the binding constraint, and it is deliberately not
done now: one storage engine until there is a reason for two.

**Aurora Serverless v2.** Scales to zero-ish and would suit an environment that
is idle most of the time. Rejected as more moving parts than the demo needs.

## Consequences

- A schema migration touches three services, so migrations are additive and run
  as a Helm pre-upgrade Job rather than in-process — several API replicas racing
  to apply the same DDL is exactly the failure a shared database invites.
- The instance is in private subnets, not publicly accessible, with a security
  group that accepts connections from the cluster's workload security group
  rather than from a CIDR range.
- The parameter group sets `rds.force_ssl`, so an unencrypted connection is
  refused rather than merely discouraged.
- Multi-AZ is off for the demo and is a variable. Production turns it on,
  roughly doubling cost for automatic failover.
