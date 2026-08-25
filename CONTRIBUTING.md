# Contributing

Issues and pull requests are welcome, particularly ones that correct something
this project gets wrong about AWS, Kafka, RabbitMQ or Kubernetes.

## Getting set up

Requirements: Docker, Node 20+, pnpm.

```bash
pnpm install
make demo      # the whole stack, plus the simulator
make smoke     # prove the pipeline works
```

## Before opening a pull request

```bash
make check     # formatting, types, unit and component tests
```

If you touched anything on the request or message path, also run the end-to-end
suite against a running stack:

```bash
make demo
make e2e
```

For infrastructure changes:

```bash
make tf-validate
helm lint charts/open-aviation-telemetry
```

CI runs all of this.

## What good looks like here

**Comments explain why, not what.** The code says what it does. A comment earns
its place by recording a decision, a constraint, or a failure mode that is not
visible from the code — why the partition key is `aircraft_id`, why publishing
happens before the projection write, why liveness and readiness check different
things.

**Tests assert behaviour, not implementation.** The end-to-end suite talks to
the system over HTTP only and has no database client, so an assertion can only
pass if the real pipeline ran. Keep it that way.

**Contracts live in `packages/shared`.** Anything the services and the web client
must agree on — the telemetry schema, topic names, queue names, alert thresholds
— goes there and is imported, not duplicated. The Architecture Explorer displays
those same constants so its content cannot drift from the implementation, and
there is a test that checks it.

**A significant decision gets an ADR.** If reversing a change would mean touching
more than one component, add a record in `docs/adr/` saying what was decided,
what was rejected, and what it costs. Anything smaller belongs in a comment next
to the code.

**No credentials, ever.** Not in a value, not in a fixture, not in a `.env` that
could be committed.

## Adding a service

1. A package under `packages/`, using `@oat/service-kit` for logging, metrics,
   probes and shutdown, and `@oat/data` if it touches PostgreSQL.
2. A `workloads` entry in `charts/open-aviation-telemetry/values.yaml`. The
   templates generate the Deployment, ServiceAccount, Service, HPA and PDB.
3. A compose service, using the shared `x-service-defaults` anchor.
4. An entry in `ARCH_NODES` in `packages/web/src/architecture.ts` — the content
   test requires every field to be filled in, including a real alternative that
   was considered.
5. If it needs AWS access, a `workload_service_accounts` entry in the Terraform
   granting only what it uses.

## Licence

Contributions are licensed under [Apache 2.0](LICENSE).
