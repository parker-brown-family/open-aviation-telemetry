# ADR-0002: Amazon EKS rather than ECS on Fargate

**Status:** Accepted

## Context

Five workloads: an HTTP API, two broker consumers, a load generator and a static
web server. They are long-running, need health checks, rolling updates, resource
limits and — for the API — horizontal autoscaling. Something has to run them.

## Decision

Amazon EKS, with a managed node group, and Helm for the workloads.

## Why

The workloads are heterogeneous. One serves HTTP and scales on CPU; two consume
from brokers and scale on partition count and queue depth; one is a load
generator that is off by default. Kubernetes gives all five the same deployment,
probe, restart, rollout and scaling model rather than five different ones.

The manifests are also portable. The Helm chart in this repository runs on any
conformant cluster, which is the difference between learning Kubernetes and
learning one cloud's container scheduler.

## Alternatives considered

**ECS on Fargate.** For five services this is materially simpler: no control
plane to pay for, no node group to patch, no CNI to understand, and it is the
right answer for many teams. Rejected here for two reasons — Kubernetes is the
skill being demonstrated, and the deployment description would then be
AWS-specific.

Worth saying plainly: at this scale ECS would be cheaper to run and cheaper to
operate. EKS is chosen for what it demonstrates, not because it wins on merit
for five containers.

**EKS on Fargate.** Removes node management but rules out DaemonSets, complicates
the CNI story, and prices per-pod in a way that suits spiky workloads rather than
steady ones.

**Plain EC2 with systemd.** Fewest moving parts, and genuinely defensible for a
handful of services. Rejected because rolling updates, health-based restarts and
autoscaling then become bespoke scripts.

**App Runner or Elastic Beanstalk.** Fine for the API alone; neither has a good
answer for a broker consumer that never receives an HTTP request.

## Consequences

- The control plane costs about US$0.10 per hour whether or not anything runs on
  it. That is most of the reason this environment is created for a demonstration
  and destroyed afterwards.
- Nodes are in private subnets and reachable only through SSM Session Manager;
  there is no SSH path and no bastion.
- Cluster access is granted through IAM access entries rather than the aws-auth
  ConfigMap, so it is auditable and revocable like any other AWS permission.
- Applications get AWS permissions through EKS Pod Identity — one IAM role per
  application, so a compromised workload carries only its own access. The
  simulator gets no AWS permissions at all.
