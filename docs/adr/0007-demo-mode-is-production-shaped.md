# ADR-0007: The demo drives the real system

**Status:** Accepted

## Context

The project has a demo console with buttons: start the simulation, inject an
engine anomaly, make a report worker fail. The cheap way to build that is for
each button to write the outcome directly — insert an alert row, mark a report
failed — and the dashboard would look identical.

## Decision

Every demo control acts through the real path. No control writes a derived
outcome.

- **Start** sets a row in `demo_state`. The simulator reads it and begins posting
  telemetry to `POST /api/v1/telemetry`, the same endpoint any producer uses.
- **Inject an engine anomaly** records an injection. The simulator changes the
  temperature _it reports_. That reading is validated, published to Kafka,
  consumed by the stream processor, evaluated by the same pure rules as every
  other reading, and becomes an alert.
- **Poison event** publishes a genuinely malformed message to the real topic. The
  consumer's quarantine path handles it.
- **Worker failure** enqueues a real job carrying a flag that makes the worker
  throw. RabbitMQ retries it through the delay queue and dead-letters it.

The one concession is `inject_failure` on a report job: a flag whose only purpose
is to make the worker fail. It is not reachable from normal application code, and
it makes the retry path demonstrable rather than described.

## Why

A demo that draws the outcome proves nothing. If the alert on screen was written
by the button, the dashboard is a mock-up with a database behind it, and the
first question — "so is that actually going through Kafka?" — has no good answer.

There is a second benefit that turned out to matter more than expected: because
the demo drives the real path, the demo _is_ an integration test. The smoke test
and the end-to-end suite use the same endpoints, and the scenarios have caught
real bugs.

## Consequences

- Demo state lives in PostgreSQL, not in the API process, because several API
  replicas would otherwise give the simulator different answers depending on
  which pod it reached.
- A demo control can fail for real reasons — injecting a poison event returns 503
  if the stream is down — and the console shows that rather than hiding it.
- Fault injection is slower to build than drawing the outcome, and the scenarios
  take seconds rather than being instant. Both are the point.

## Related

- [ADR-0006](0006-synthetic-telemetry.md) — where the data comes from
- [ADR-0010](0010-honest-data-provenance.md) — saying what is measured
