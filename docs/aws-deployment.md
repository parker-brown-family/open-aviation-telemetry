# Deploying to AWS

Terraform creates the infrastructure; Helm deploys the workloads. Roughly 25
minutes end to end, most of it waiting for the RabbitMQ broker.

**This costs money.** About **US$20–35 per day** while it runs, whether or not
anything is using it. Destroy it when the demonstration is over.

| What                  | Roughly          | Why                                |
| --------------------- | ---------------- | ---------------------------------- |
| EKS control plane     | $2.40/day        | Fixed, whether or not pods run     |
| 2 × t3.large nodes    | $4.00/day        |                                    |
| NAT gateway           | $1.10/day + data | One; production wants one per AZ   |
| RDS db.t4g.micro      | $0.40/day        | Doubles with Multi-AZ              |
| Amazon MQ mq.t3.micro | $0.60/day        |                                    |
| MSK Serverless        | ~$8/day          | Has a per-cluster-hour base charge |
| ALB, logs, storage    | $2–4/day         |                                    |

Check current pricing rather than trusting this table.

## Prerequisites

- AWS credentials with permission to create VPCs, EKS, RDS, MSK, Amazon MQ, ECR
  and IAM roles
- Terraform ≥ 1.6, kubectl, Helm ≥ 3.14, Docker, the AWS CLI, `jq`

```bash
aws sts get-caller-identity     # confirm which account you are about to bill
```

## 1 — Review the plan

```bash
make tf-validate                # no credentials needed
cd infra/terraform/environments/demo
terraform init
terraform plan
```

Read it. Roughly 70 resources.

To change the region or sizes, create `demo.auto.tfvars`:

```hcl
region                       = "ca-central-1"
name                         = "oat-demo"
node_instance_types          = ["t3.large"]
node_desired_size            = 2
kubernetes_api_allowed_cidrs = ["203.0.113.4/32"]   # your IP, not 0.0.0.0/0
```

## 2 — Apply

```bash
terraform apply
```

About 25 minutes. EKS is ~10; the RabbitMQ broker is ~15 and runs concurrently.

```bash
terraform output
terraform output -raw next_steps
```

No credential appears in the outputs. The database and RabbitMQ passwords were
generated during the apply and written straight to Secrets Manager.

## 3 — Connect kubectl

```bash
aws eks update-kubeconfig --name oat-demo --region ca-central-1
kubectl get nodes
```

## 4 — Build and push images

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=ca-central-1
REGISTRY=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/oat-demo
TAG=$(git rev-parse --short HEAD)

aws ecr get-login-password --region $REGION \
  | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com

for svc in telemetry-api telemetry-consumer report-worker simulator; do
  docker build --build-arg PACKAGE=@oat/$svc -t $REGISTRY/$svc:$TAG .
  docker push $REGISTRY/$svc:$TAG
done

docker build -f packages/web/Dockerfile -t $REGISTRY/web:$TAG .
docker push $REGISTRY/web:$TAG
```

Tag with the git SHA, not `latest`. ECR repositories use immutable tags, so a
push over an existing tag is rejected — which is the point: a SHA identifies one
specific image permanently.

## 5 — Create the credentials Secret

The chart does not accept credentials as values. Anything passed as a Helm value
is visible in `helm get values` and in whatever CI ran the upgrade.

```bash
kubectl create namespace aviation

DB_URL=$(aws secretsmanager get-secret-value --secret-id oat-demo/database \
  --query SecretString --output text | jq -r .url)
MQ_URL=$(aws secretsmanager get-secret-value --secret-id oat-demo/rabbitmq \
  --query SecretString --output text | jq -r .url)

kubectl -n aviation create secret generic oat-credentials \
  --from-literal=DATABASE_URL="$DB_URL" \
  --from-literal=RABBITMQ_URL="$MQ_URL"
```

For anything longer-lived, use the External Secrets Operator instead — it
re-syncs when a secret rotates, which this one-shot copy does not.

## 6 — Install the AWS Load Balancer Controller

Needed only if you want an Ingress. Follow the
[AWS instructions](https://docs.aws.amazon.com/eks/latest/userguide/lbc-helm.html);
the subnets are already tagged for it.

## 7 — Deploy

```bash
helm upgrade --install oat charts/open-aviation-telemetry \
  --namespace aviation --create-namespace \
  --set image.registry=$REGISTRY \
  --set image.tag=$TAG \
  --set kafka.brokers="$(terraform -chdir=infra/terraform/environments/demo output -raw kafka_bootstrap_brokers)" \
  --set kafka.auth=aws-msk-iam \
  --set database.ssl=require \
  --wait --timeout 10m
```

`kafka.auth=aws-msk-iam` is the setting people forget. MSK does not accept a
plaintext connection, and the failure looks like a timeout rather than an auth
error.

The migration Job runs first as a pre-upgrade hook. If it fails, the release
fails and the previous version keeps serving.

## 8 — Verify

```bash
kubectl -n aviation get pods
kubectl -n aviation port-forward svc/telemetry-api 8080:8080 &
curl -s localhost:8080/ready | jq
make smoke API_URL=http://localhost:8080
```

`/ready` names any dependency it cannot reach.

Start the simulator:

```bash
kubectl -n aviation port-forward svc/web 8000:80 &
curl -X POST localhost:8080/api/v1/demo/start -d '{"profile":"calm"}' \
  -H 'content-type: application/json'
```

## 9 — Destroy

```bash
cd infra/terraform/environments/demo
helm -n aviation uninstall oat
terraform destroy
```

Then confirm nothing is left behind, because a leftover NAT gateway or load
balancer is the classic surprise bill:

```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=open-aviation-telemetry \
  --query 'ResourceTagMappingList[].ResourceARN' --output table
```

Everything is tagged `Project=open-aviation-telemetry`, so that query is
authoritative. An ALB created by the Load Balancer Controller is _not_ Terraform-
managed — uninstall the Helm release first, or Terraform will fail to delete the
VPC because something is still attached to it.

## Troubleshooting

**Pods running but not ready.** `curl /ready` — the response names the failing
dependency.

**Kafka connection times out.** `kafka.auth` is probably still `plaintext`. MSK
requires IAM.

**`Unable to locate credentials` in a pod.** The EKS Pod Identity Agent add-on is
missing, or the ServiceAccount name does not match the association. Check
`kubectl -n aviation get sa` against `terraform output workload_role_arns`.

**Database connection refused.** The security group allows the workload security
group; confirm nodes actually carry it.

**`terraform destroy` hangs on the VPC.** Something outside Terraform is still
attached — usually an ALB from the Ingress. Uninstall the Helm release first.
