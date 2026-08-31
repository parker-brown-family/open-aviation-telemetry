# A day on EKS

`docs/aws-deployment.md` describes the deployment this project would actually
run: Terraform builds MSK, RDS, Amazon MQ and an EKS cluster, and Helm puts the
workloads on it. It costs about US$20–35 a day and takes 25 minutes to build.

This document describes something smaller and more specific: a cluster that
exists for an afternoon, for the purpose of learning the parts of EKS that
cannot be learned anywhere else, and is then destroyed. It costs about **US$0.34
an hour** — roughly a dollar for a three-hour sitting.

The distinction matters because most of the money in the full deployment buys
managed versions of things this repository already runs in containers. MSK
alone is around US$8 a day, most of it a per-cluster-hour base charge that
applies whether or not a message moves. A managed broker does not teach you
anything a broker in a pod does not, so the brokers come along as pods
(`deploy/eks/dependencies.yaml`) and the money goes to the parts that are
genuinely AWS:

| What                         | Why it can only be learned here                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| The OIDC provider, IRSA      | Exchanging a Kubernetes ServiceAccount for an IAM role. No local cluster has this.                 |
| The EBS CSI driver           | Real block storage, attached to a real node, through a driver with its own IAM role.               |
| The load balancer controller | An Ingress object becoming an actual ALB, with target groups and health checks.                    |
| Managed node groups          | Nodes that join, drain and are replaced by AWS rather than by you.                                 |
| The VPC CNI                  | Pods holding real VPC addresses, which is why subnet sizing is a cluster-capacity question on AWS. |

Everything else — Deployments, Services, probes, autoscaling, rollouts — is the
same on `kind`, and should be practised there for free first.

## Before you start

```bash
aws configure                              # or export the usual variables
./scripts/eks-session.sh budget you@example.com   # a US$10 tripwire, once
./scripts/eks-session.sh preflight                # free; nothing is created
```

`preflight` prints the account number it is about to build in. Read it. The
expensive mistake in this exercise is not the cluster you are watching.

A budget is not a spending limit — AWS will not stop anything when it trips. It
exists so that a cluster you forgot announces itself while it is still cheap.

## The session

```bash
./scripts/eks-session.sh up        # ~15 min. Billing starts here.
./scripts/eks-session.sh addons    # ~5 min
./scripts/eks-session.sh deploy    # ~5 min
./scripts/eks-session.sh verify
```

`verify` prints, in order: the nodes, the bound PersistentVolumeClaim and the
EBS volume id behind it, the pods, the ALB hostname, a health check answered
through that load balancer, an aircraft query whose rows came from telemetry
that crossed Kafka inside the cluster, and the consumer group lag. Each line is
a thing that can be checked rather than assumed.

At any point:

```bash
./scripts/eks-session.sh status    # how long it has been running, and roughly what that cost
```

## Ending it

```bash
./scripts/eks-session.sh down
```

`down` deletes the Ingress first and waits before deleting anything else. This
is not fussiness. The load balancer controller deletes the ALB in response to
the Ingress going away; if the cluster is destroyed first, the controller is
gone before it can act, and the ALB and its security groups survive. They keep
billing, and the CloudFormation stack then fails to delete because a security
group is still attached to the VPC. "I deleted the cluster" is not the same
sentence as "nothing is billing".

Which is why `down` finishes by running:

```bash
./scripts/eks-session.sh confirm-gone
```

It asks AWS directly — clusters, load balancers, NAT gateways, volumes, elastic
IPs — rather than asking `eksctl` how it thinks it did. Run it again the next
morning. It is free, and it is the only step that actually answers the question
you care about.

## What tends to go wrong

**A PersistentVolumeClaim stays `Pending` with no explanation.** The EBS CSI
driver is not installed, or its IAM role is not attached. In-tree EBS support
was removed in Kubernetes 1.23; storage on EKS is an addon now, and the addon
needs IRSA, which needs the cluster to have been created `--with-oidc`.

**An Ingress never gets an address.** Either the load balancer controller is not
installed — the Ingress is accepted by the API server whether or not anything is
watching for it — or the Ingress asked for an HTTPS listener without a
certificate, which the controller rejects outright rather than degrading to
HTTP. The chart derives the listener set from `ingress.certificateArn` for
exactly this reason, and CI asserts both branches.

**A broker that worked under Compose fails on Kubernetes.** Almost always
`KAFKA_ADVERTISED_LISTENERS`. A client connects to the Service, asks the broker
where to go, and is told the pod IP — which changes on restart and is not what
the Service resolves to. It must advertise its Service DNS name.

**The cluster deletes but the bill does not stop.** See `confirm-gone` above.

## What this is not

It is not a production deployment, and nothing here should be lifted into one.
The brokers are single replicas with no durability story, the database password
is in a manifest, and the load balancer is HTTP. `infra/terraform` and
`docs/aws-deployment.md` are the honest version. This is a training cluster that
is meant to be thrown away, and saying so plainly is cheaper than discovering
later that someone believed otherwise.
