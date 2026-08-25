# ADR-0009: Document some production concerns instead of implementing them

**Status:** Accepted

## Context

There is a long list of things a production aviation telemetry platform would
need that this project does not have: multi-region failover, enterprise identity,
Kafka tuning, queue-depth-based autoscaling, a full alerting hierarchy, data
retention tiering.

Two failure modes are available. Build all of it, and the project never finishes
and nobody can read it. Build none of it and say nothing, and it looks like the
concerns were not considered.

## Decision

Implement what demonstrates a decision. Document what would be needed, where it
would go, and why it is not here.

Documented rather than built:

**Multi-region.** The architecture is single-region. Multi-region would need
cross-region replication for RDS, a MirrorMaker topology or a second stream, and
a routing decision at the edge. The interesting question is what "failover" means
for a telemetry stream that is still arriving, and that is a design conversation,
not a config change.

**Authentication and authorisation.** There is no user model. Every read endpoint
is open and the demo controls are unauthenticated, which is correct for a
reference implementation with synthetic data and wrong for anything else. It
would go at the API boundary — Cognito or an OIDC provider in front of the ALB,
and per-operator scoping on the fleet queries.

**Queue-depth autoscaling.** The report worker autoscaler is deliberately turned
off rather than configured on CPU. CPU is the wrong signal for a queue worker:
a worker blocked on I/O looks idle while the queue grows. The right signal is
queue depth, which needs KEDA or a custom metrics adapter. Configuring it wrongly
would be worse than leaving it off, because it would look like it worked.

**Kafka tuning.** Three partitions, defaults elsewhere. Real tuning — partition
count from throughput targets, retention from replay requirements, batching from
latency budgets — needs a workload to measure.

**Alerting hierarchy.** Two CloudWatch alarms on the database. A real on-call
setup needs severity tiers, routing, escalation and runbooks, and inventing that
without an on-call rotation to serve produces alarms nobody acts on.

**Data retention.** Telemetry history grows without bound. Production would
partition by time and tier old partitions out, or move history to Timestream.

## Why

There is a difference between not knowing something matters and deciding not to
build it yet. The first is a gap; the second is scoping. Writing them down is
what makes the difference visible.

It is also honest about a real risk: a reference implementation that quietly
skips the hard parts can read as a claim that the hard parts do not exist.

## Consequences

- The README and the Architecture Explorer say what is not implemented.
- The Terraform exposes the production-shaped settings as variables — `multi_az`,
  `nat_gateway_count`, `rabbitmq_deployment_mode`, `deletion_protection`,
  `skip_final_snapshot` — with the demo values and their cost written next to
  them. Turning them on is a tfvars change, not a rewrite.
- Anyone reading this repository as a template for real work has a list of what
  to add.
