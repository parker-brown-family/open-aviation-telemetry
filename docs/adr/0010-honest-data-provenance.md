# ADR-0010: The client always states where its numbers came from

**Status:** Accepted

## Context

The web client runs in two very different situations.

Locally, against the full stack, everything it shows is measured: fleet counts
from PostgreSQL, consumer lag from Kafka's admin API, queue depth from RabbitMQ,
request latency from the API process.

Published as a static page — under a subdirectory of an existing website, with no
API behind it — none of that is available. An empty dashboard teaches a visitor
nothing about the architecture, so the page ships with a sample dataset.

Those two situations must never look the same.

## Decision

Data provenance is part of the product, not a footnote.

**A permanent banner.** The client probes the API on load and reports one of
three states: `probing`, `live` (naming the base URL it connected to), or
`sample` (stating plainly that nothing on the page is being measured). It cannot
be dismissed, because everything below it is only meaningful in that context.

**Writes fail rather than pretend.** In sample mode the demo controls are
disabled and the client's write methods reject. A Start button that appears to
work while nothing happens is exactly what this is meant to prevent.

**The API labels its own mocks.** `GET /api/v1/infrastructure` returns
`simulated: true` and a disclaimer when its figures are static placeholders
rather than a reading of a live AWS account. The flag is in the payload, not just
the UI, so any consumer sees it.

**Real and simulated are never mixed silently.** On the architecture page the AWS
estate panel carries the disclaimer; the fleet and pipeline figures beside it do
not, because they are measured.

**It is tested.** There are component tests asserting the banner appears offline,
that a non-2xx response is treated as no API rather than a live one, that writes
reject, and an end-to-end test asserting the infrastructure endpoint labels
itself. A regression here is a correctness bug.

## Why

A dashboard showing plausible fabricated numbers without saying so is worse than
one showing nothing. It makes a claim about a running system that is not true,
and the person reading it has no way to know.

For a project whose purpose is to be shown to people evaluating engineering
judgement, that is not a small thing. The AWS infrastructure panel is genuinely
mocked — there is no AWS account attached — and the honest move is to say so
prominently rather than let a plausible-looking panel imply otherwise.

## Consequences

- The client works with or without a backend, and behaves differently on purpose.
- Anyone can tell which mode they are in without reading documentation.
- Wiring up the real AWS reader means implementing `awsSnapshotUnavailable` in
  `packages/telemetry-api/src/infrastructure.ts`. Until then, selecting
  `INFRASTRUCTURE_PROVIDER=aws` returns no data and says why — rather than
  serving mock data under a real label.

## Related

- [ADR-0007](0007-demo-mode-is-production-shaped.md) — the demo drives the real system
