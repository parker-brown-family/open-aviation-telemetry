# ADR-0001: Terraform owns deployed infrastructure; CDK is reference only

**Status:** Accepted

## Context

This project needs infrastructure as code, and it is also meant to demonstrate
familiarity with more than one way of writing it. Those two goals pull in
opposite directions: the second invites having both Terraform and CDK in the
repository, and the first is undermined the moment two tools can both create the
same resource.

Two tools managing one resource is not a stylistic problem. Terraform records
what it created in a state file and reconciles against reality; CloudFormation
records what it created in a stack and reconciles against its own template.
Neither knows about the other. A resource created by CDK and then imported —
or worse, recreated — by Terraform produces a state file that disagrees with a
stack, and the recovery is manual.

## Decision

**Terraform is the canonical implementation.** Every deployed resource is
created and destroyed by the Terraform in `infra/terraform`.

**The CDK stack in `infra/cdk-reference` manages nothing.** It expresses the
network, the registry and the log groups so the two approaches can be compared
against the same problem, and it is documented — in its own source, its README
and here — as never being deployed to an environment Terraform manages.

`cdk synth` renders CloudFormation and touches no account. That is the intended
way to read it.

## Why Terraform for the canonical path

- The plan is computed against real resource state, so drift introduced in the
  console shows up. A `cdk diff` compares against the last deployed template and
  generally does not.
- `terraform destroy` is a first-class, reliable operation. That matters for a
  demo environment whose whole point is to be created and removed on demand.
- The skill transfers off AWS.

## What CDK is genuinely better at

Recorded here rather than left implied, because pretending the rejected option
has no merits is not a real comparison.

- It is a programming language. `new ec2.Vpc()` with a `subnetConfiguration`
  replaces roughly a hundred lines of Terraform because the L2 construct already
  encodes the subnet maths, the route tables and the NAT wiring.
- Loops, conditionals and shared abstractions are ordinary code rather than HCL
  expressions.
- For a team already writing TypeScript, there is one language instead of two.

The cost is that the abstraction makes decisions for you. The Terraform here
spells out every route table on purpose, because a reader can then see what an
EKS-ready VPC is actually made of.

## Consequences

- One place to look for what exists in AWS.
- The CDK stack must be kept compiling, or it becomes a liability that a reader
  discovers by cloning the repository. CI runs `tsc` and `cdk synth` on it.
- If this project ever adopted CDK for real, the migration would be a deliberate
  one-way move with an import step, not a gradual drift.

## Related

- [ADR-0009](0009-explain-rather-than-implement.md) — what is documented rather than built
