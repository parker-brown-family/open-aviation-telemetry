# Security

## Scope

This is a reference implementation. It runs on synthetic data, has no user
accounts, and its demo controls are unauthenticated by design — see
[ADR-0009](docs/adr/0009-explain-rather-than-implement.md).

**Do not point it at real aircraft data, and do not deploy it as-is anywhere
that matters.** Read the hardening list below first.

## Reporting a vulnerability

Report privately rather than opening a public issue: open a
[security advisory](https://github.com/parker-brown-family/open-aviation-telemetry/security/advisories/new)
on the repository.

Please include what you found, how to reproduce it, and what an attacker could
do with it. Expect an acknowledgement within a few days.

## Never submit secrets

Everything here is synthetic. If you are experimenting with this project, do not
put a real credential, connection string or API key into an issue, a pull
request, a test fixture or a `.env` file that could be committed.

`.env` is in `.gitignore`. `.env.example` holds placeholders only.

## What the project does do

- **No static AWS credentials anywhere.** Applications get AWS access through EKS
  Pod Identity — one IAM role per application, assumed by the pod itself. MSK
  authenticates that role over SASL/OAUTHBEARER; there is no Kafka password.
- **Generated secrets, never supplied ones.** Terraform generates the database
  and RabbitMQ passwords and writes them straight to Secrets Manager. They are
  not input variables, not Terraform outputs, and not Helm values — anything
  passed as a Helm value is visible in `helm get values` and in CI logs.
- **Least privilege per workload.** The report worker has no Kafka permissions
  because it never uses Kafka. The simulator has no AWS permissions at all.
- **Private by default.** The database and both brokers are in private subnets
  with no public accessibility. Their security groups reference the cluster's
  workload security group rather than a CIDR range.
- **Encryption in transit is enforced, not offered.** The RDS parameter group
  sets `rds.force_ssl`; Amazon MQ only accepts AMQPS.
- **Hardened containers.** Non-root user, read-only root filesystem, all
  capabilities dropped, no privilege escalation, `RuntimeDefault` seccomp.
- **Immutable image tags.** ECR rejects a push over an existing tag, so a git SHA
  identifies one specific image permanently.
- **Log redaction.** Authorisation headers, cookies and connection strings are
  redacted by the logger.
- **Input validation at the boundary.** Every telemetry report is validated
  against a schema before anything else happens; an invalid report is rejected
  with the offending field named and never reaches the database or the stream.

## Before deploying anything like this for real

1. **Put authentication in front of it.** Every endpoint is currently open.
2. **Remove the demo routes.** `POST /api/v1/demo/reset` truncates every table.
3. **Narrow `kubernetes_api_allowed_cidrs`.** It defaults to `0.0.0.0/0`.
   Better: set `endpoint_public_access = false` and reach the API over a VPN.
4. **Verify the RDS certificate chain.** The pool currently sets
   `rejectUnauthorized: false`; mount the Amazon RDS CA bundle and set it true.
5. **Turn on the production settings.** `multi_az`, `deletion_protection`,
   `skip_final_snapshot = false`, `rabbitmq_deployment_mode = CLUSTER_MULTI_AZ`.
6. **Add network policies.** Nothing currently restricts pod-to-pod traffic.
7. **Rotate the generated secrets** and enable Secrets Manager rotation.

## Dependencies

Dependabot is configured for npm, GitHub Actions, Docker and Terraform. ECR scans
images on push.
