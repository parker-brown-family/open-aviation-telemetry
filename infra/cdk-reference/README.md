# CDK reference implementation

**This stack manages nothing.** It exists so the comparison between CDK and
Terraform is concrete rather than theoretical. Terraform owns every deployed
resource — see [ADR-0001](../../docs/adr/0001-terraform-is-canonical.md).

Do not `cdk deploy` this into an environment Terraform manages. Two tools
reconciling the same resources against two different sources of truth is how
state files and stacks end up disagreeing, and the recovery is manual.

## Read it

```bash
pnpm --filter @oat/cdk-reference build
pnpm --filter @oat/cdk-reference exec cdk synth
```

`synth` renders CloudFormation to `cdk.out/` and touches no AWS account.

## What the comparison shows

**CDK is a program.** `new ec2.Vpc()` with a `subnetConfiguration` replaces
roughly a hundred lines of Terraform, because the L2 construct already encodes
the subnet maths, the route tables and the NAT wiring. That is a real
productivity difference and the strongest argument for it.

**The abstraction decides things for you.** The Terraform here spells out every
route table on purpose, so a reader can see what an EKS-ready VPC is made of.
This file does not. Both are defensible; they optimise for different readers.

**`cdk diff` and `terraform plan` are not equivalent.** A plan is computed
against real resource state, so drift introduced in the console shows up. A diff
is computed against the last deployed template, and generally does not.

**Some things need saying twice anyway.** The subnet tags the AWS Load Balancer
Controller looks for are not added by the construct, so they are added
explicitly — the same requirement as in the Terraform, just in a different place.

Note also `Tags.of()` rather than `node.addMetadata()`: metadata is CDK's own
annotation mechanism and never reaches the resource. Only a tag does.
