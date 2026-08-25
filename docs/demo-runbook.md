# Demo runbook

Eight minutes, walking one telemetry report from an aircraft to a dashboard, and
then breaking things on purpose.

## Before you start

```bash
make demo
make smoke      # proves it works before anyone is watching
```

Have open: the dashboard (<http://localhost:3000>), a terminal, and optionally
the RabbitMQ console (<http://localhost:15672>, `oat` / `oat`).

If you have five minutes rather than eight, do steps 2, 4, 6 and 7.

---

## 1 — What this is (30 seconds)

> "This is an open-source reference architecture for aircraft telemetry. It runs
> on EKS with RDS, MSK and Amazon MQ; the infrastructure is Terraform and the
> workloads are a Helm chart. Everything you're about to see is running locally
> in containers — same code, same brokers, different connection strings."

Say plainly that the aircraft are synthetic, before anyone wonders.

## 2 — The dashboard (1 minute)

Open <http://localhost:3000>.

Point at the tiles: active aircraft, telemetry per minute, consumer lag, queue
depth, critical alerts, API p95.

> "Every number on this page is measured. The lag figure is read from Kafka's
> admin API, the queue depth from RabbitMQ. Nothing here is a display value."

The plan view is not a map with tiles — it is an equirectangular projection into
an SVG. Worth a sentence if asked: no third-party tile provider means nothing to
fail during a demonstration.

## 3 — The architecture explorer (1–2 minutes)

Open **Architecture** and click **Start the tour**.

Step through it. Nine steps, following one report: validation, publish to Kafka,
current-state projection, the consumer picking it up, derived alerts, the report
request, the worker, observability, infrastructure as code.

Then click any box — say **Event stream** — and show the detail panel: what it
is, why it is here, what was considered instead, how it fails, how it scales,
security, and which files implement it.

> "The alternative section is the part I'd want to talk about. SQS would be
> simpler and cheaper for this volume — the reason it isn't SQS is replay and
> per-aircraft ordering."

Scroll to the AWS estate panel and say the quiet part out loud:

> "That panel is labelled simulated, because there's no AWS account attached to
> this laptop. The API returns `simulated: true` in the payload, not just in the
> UI. Everything else on the dashboard is measured."

## 4 — Follow one aircraft (1 minute)

Open **Fleet**, click a row.

Track on the map, latest telemetry, samples in history.

> "Its position came in over HTTP and was written by the API. The history behind
> it was written by a completely different process, after the event went through
> Kafka. If the consumer stopped, the aircraft would keep moving on this page and
> the history would stop growing — which is exactly the failure you'd want to be
> able to see."

## 5 — Partitioning (1 minute, if they're interested)

> "Messages are keyed by aircraft ID. Kafka hashes the key to pick a partition,
> so every report for one airframe lands on one partition and is processed in
> order. Different aircraft go to different partitions and process in parallel.
>
> That's also what makes it safe for the processor to keep the last reading per
> aircraft in memory — one partition has exactly one consumer in the group. If I
> changed the key, that cache would quietly become wrong."

## 6 — The asynchronous path (1 minute)

On the fleet page, click **Request report**.

It returns immediately with a pending report.

> "That returned in a few milliseconds. Generating the summary means reading a
> window of history and computing over it — unbounded work. So the API writes a
> pending row, puts a job on RabbitMQ and returns 202. A worker does the work."

Open **Alerts** and show the report completing.

> "Kafka carries facts — this aircraft reported this position. RabbitMQ carries
> commands — generate this report. Different semantics, so different tool. Using
> one for both means rebuilding the other's behaviour by hand."

## 7 — Break it on purpose (2 minutes)

Open **Demo console**. This is the part worth the time.

**Report worker failure.** Click Inject.

> "That enqueued a job that fails. Watch it."

Open **Alerts** and watch the report: attempts climbing 1, 2, 3, then `failed`.

> "It failed, went to a delay queue with a five-second TTL, came back, failed
> again, and after three attempts was dead-lettered. The dead-letter count on the
> dashboard comes from the broker. Nothing was lost — that message is sitting in
> the DLQ waiting for someone to look at it."

**Poison event.** Click Inject.

> "That published a genuinely malformed message to the telemetry topic. It can
> never be parsed, so retrying is pointless — it'd block the partition behind it
> forever. The consumer quarantines it to a dead-letter topic with the reason in
> the headers, and keeps going."

Show that telemetry is still flowing.

**Engine over-temperature.** Click Inject, then open **Alerts**.

> "That didn't write an alert. It changed what the aircraft _reports_ — the
> simulator raises the temperature it sends. That reading was validated,
> published to Kafka, consumed, and evaluated by the same rules as every other
> reading. The alert on this page was derived, not drawn."

## 8 — Kill a pod (30 seconds, if they like this sort of thing)

```bash
docker compose kill telemetry-consumer
```

Telemetry keeps arriving; history stops growing; lag climbs on the dashboard.

```bash
docker compose start telemetry-consumer
```

Lag drains. Nothing was lost — it resumed from its committed offset.

> "That's the argument for the stream. The API never noticed."

## 9 — Close

> "The part I found interesting wasn't getting each service running. It was
> deciding where the boundaries go — what has to be synchronous, what can be
> derived, what happens when each piece fails, and being able to show that
> rather than assert it."

Then invite the conversation rather than continuing to present:

- "Want me to walk through the Terraform?"
- "Want to see why Kafka and RabbitMQ are doing different jobs here?"
- "Want to see the failure paths in the code?"

---

## If something goes wrong

```bash
make status     # container status plus the readiness breakdown
make logs       # follow everything
```

`/ready` names the failing dependency, which is usually enough.

Nuclear option, about 90 seconds:

```bash
make down && make demo
```

Rehearse once beforehand. The fleet is seeded deterministically, so a rehearsal
is representative.
