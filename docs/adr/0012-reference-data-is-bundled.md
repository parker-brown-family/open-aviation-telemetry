# ADR-0012: Reference data is bundled, not fetched — and what the API-shaped version would be

**Status:** Accepted

## Context

The fleet displays can now be centred on any of several airports rather than
always on Kelowna. That raised a fair question: the airport list is data, and
this project exists to demonstrate a service architecture — so should the list
come from the API?

It is a tempting yes. There is already an API, a database, and a deployment
story; adding `GET /api/v1/airports` would take an afternoon and would look like
more architecture on the page.

It would also be wrong, and the reason is worth writing down, because knowing
when _not_ to add a service is the harder half of the skill this repository is
meant to demonstrate.

## What this data actually is

|             | Airport reference data                                                    |
| ----------- | ------------------------------------------------------------------------- |
| Volume      | 12 records, under 4 KB                                                    |
| Change rate | Effectively never. Airports do not move; a code changes maybe once a year |
| Variance    | Identical for every user, every session, every request                    |
| When needed | Before first paint — the scope cannot project anything without it         |

Those four rows are the entire argument. This is not "data the system holds", it
is _a constant the system is compiled against_, and it happens to be shaped like
a table.

## Decision

**Reference data — airports, aircraft types, alert thresholds, operators — ships
in the bundle.** It lives in `packages/shared/src/reference.ts` and is imported
by the client, the simulator, the stream processor, and the API alike.

That shared import is doing real work beyond saving a request: the alerts page
prints its detection rules from the same `THRESHOLDS` constant the processor
evaluates, so the documentation cannot drift from the implementation. A fetched
copy would reintroduce exactly the drift the shared module removes.

## Why not an API

Putting a 4 KB never-changing constant behind API Gateway → Lambda → DynamoDB
means:

- **A round trip before first paint.** The scope cannot draw its graticule until
  the response lands. On a cold Lambda that is a blank panel for a second or
  more, to deliver bytes that could have been in the JavaScript already parsed.
- **A new failure mode for something that cannot fail today.** Bundled data is
  available whenever the page is. Fetched data introduces a loading state, an
  error state, and a decision about what to render when the airport list is
  unavailable — three new branches guarding a value that never changes.
- **A cache that becomes the real system.** The obvious fix is a long TTL at the
  edge. With a sensible TTL the origin serves approximately no traffic, at which
  point the Lambda, the table and the IAM role exist to populate a CDN with a
  file — which is what a static asset already is, without the moving parts.

Cost is not the argument. At this volume every option is free. The argument is
that each added component has to earn its failure modes, and this one cannot.

## What would change the answer

Bundling is right _because of the four properties above_, not as a general
principle. Any of these would flip it:

- **Volume.** The full OurAirports dataset is ~80,000 rows. That does not belong
  in a bundle, and the right answer becomes a queryable endpoint with a search
  parameter — because the client needs a _subset chosen at runtime_.
- **Change rate.** NOTAMs, runway closures and TFRs are reference-shaped but
  change hourly. Anything with an operational expiry must be fetched.
- **Per-user variance.** The moment the list depends on who is asking — an
  operator's own bases, a subscription tier — it stops being a constant.

The honest middle ground for a dataset that is large but static is **S3 +
CloudFront with a content-hashed key**: the client fetches a versioned artifact,
caches it for a year, and a new dataset is a new key. That is the reference-data
distribution pattern, and it is a genuinely useful thing to know. It is still
not warranted for twelve airports.

## The question next to it, which _is_ API-shaped

Re-centring the display makes a much better endpoint obvious, and it is worth
naming here because it is the one worth building:

```
GET /api/v1/aircraft?near=CYYC&radius_nm=300
```

"Which aircraft are near this datum" has every property the airport list lacks.
The answer changes every few seconds, so it cannot be precomputed or cached for
long. It grows with fleet size, so it needs a bounding-box pre-filter before the
haversine refinement, and an index behind that. It needs input validation, a
bounded radius, and pagination once the fleet is large. It has a latency budget
worth measuring and a cost profile worth reasoning about.

That is a real endpoint with real engineering in it. The airport list is a
constant.

## Consequences

- Adding a datum is a data change in `AIRPORTS`, deployed with the bundle.
  Nothing needs to be migrated, seeded, or invalidated.
- The selectable list is derived from the existing `major` flag rather than
  duplicated, so the two cannot disagree.
- The displays work with no API attached, which is the state the published page
  is permanently in — consistent with
  [ADR-0010](0010-honest-data-provenance.md).
- If this project ever grows a real airport dataset, this decision is expected
  to be revisited against the three criteria above rather than defended.
