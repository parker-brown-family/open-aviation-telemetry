#!/usr/bin/env bash
#
# A short-lived EKS cluster, from nothing to destroyed, in named steps.
#
# The cost of this cluster is charged by the hour and does not care whether
# anyone is looking at it. Everything here is therefore arranged around one
# idea: the window in which money is being spent should be short, and ending it
# should be the easiest thing in the file to do. `down` takes no arguments,
# needs no state from an earlier step, and works even if every other step
# failed. `status` will tell you, in one line, whether you are currently paying.
#
#   ./scripts/eks-session.sh preflight   # free — credentials, quotas, budget alarm
#   ./scripts/eks-session.sh up          # ~15 min — the meter starts here
#   ./scripts/eks-session.sh addons      # ~5 min — IRSA, EBS CSI, load balancer
#   ./scripts/eks-session.sh deploy      # ~5 min — brokers, database, the app
#   ./scripts/eks-session.sh verify      # proves the pipeline ran on AWS
#   ./scripts/eks-session.sh down        # ~10 min — the meter stops here
#   ./scripts/eks-session.sh confirm-gone # proves nothing is still billing
#
set -euo pipefail

CLUSTER="${OAT_CLUSTER:-oat-eks-day}"
REGION="${OAT_REGION:-ca-central-1}"
NAMESPACE="${OAT_NAMESPACE:-oat}"
NODE_TYPE="${OAT_NODE_TYPE:-t3.large}"
NODE_COUNT="${OAT_NODE_COUNT:-2}"
K8S_VERSION="${OAT_K8S_VERSION:-1.33}"
IMAGE_REGISTRY="${OAT_IMAGE_REGISTRY:-ghcr.io/parker-brown-family/open-aviation-telemetry}"
IMAGE_TAG="${OAT_IMAGE_TAG:-latest}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP_DIR="${HOME}/.oat-eks"
STARTED_AT="${STAMP_DIR}/${CLUSTER}.started"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die() {
  printf '\033[31m%s\033[0m\n' "$*" >&2
  exit 1
}

need() { command -v "$1" >/dev/null || die "missing: $1"; }

# ---------------------------------------------------------------- preflight

preflight() {
  bold '== Tools =='
  for t in aws eksctl kubectl helm jq; do
    need "$t"
    printf '  %-8s %s\n' "$t" "$(command -v "$t")"
  done

  bold '== Account =='
  local who
  who="$(aws sts get-caller-identity --output json 2>/dev/null)" ||
    die 'No usable AWS credentials. Run: aws configure'
  echo "$who" | jq -r '"  account  \(.Account)\n  identity \(.Arn)"'
  printf '  region   %s\n' "$REGION"

  # Read the account number back to the operator before anything is created.
  # The failure mode this prevents is not subtle — it is building a cluster in
  # the wrong account and not noticing until the bill arrives somewhere else.

  bold '== Budget alarm =='
  # A budget is not a spending limit; AWS will not stop anything. It is a
  # tripwire, and the reason to insist on one is that the expensive mistake in
  # this exercise is not the cluster you are watching, it is the one you forgot.
  if aws budgets describe-budget \
    --account-id "$(echo "$who" | jq -r .Account)" \
    --budget-name oat-eks-day >/dev/null 2>&1; then
    echo '  oat-eks-day budget exists'
  else
    warn '  No `oat-eks-day` budget. Create one before `up`:'
    warn "     ./scripts/eks-session.sh budget you@example.com"
  fi

  bold '== Already running? =='
  status
}

# A US$10 monthly budget with an alert at 50%. The number is deliberately near
# the cost of a single forgotten day rather than near a month of real usage:
# the alert should fire while the mistake is still cheap.
budget() {
  local email="${1:?usage: eks-session.sh budget you@example.com}"
  local account
  account="$(aws sts get-caller-identity --query Account --output text)"

  local dir
  dir="$(mktemp -d)"
  cat >"${dir}/budget.json" <<'JSON'
{
  "BudgetName": "oat-eks-day",
  "BudgetLimit": { "Amount": "10", "Unit": "USD" },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
JSON
  cat >"${dir}/notifications.json" <<JSON
[
  {
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 50,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [{ "SubscriptionType": "EMAIL", "Address": "${email}" }]
  }
]
JSON

  aws budgets create-budget \
    --account-id "$account" \
    --budget "file://${dir}/budget.json" \
    --notifications-with-subscribers "file://${dir}/notifications.json"
  rm -rf "$dir"
  bold "Budget created; ${email} is alerted at US\$5."
}

# ---------------------------------------------------------------- up

up() {
  command -v eksctl >/dev/null || die 'missing: eksctl'
  aws sts get-caller-identity >/dev/null || die 'no AWS credentials'

  mkdir -p "$STAMP_DIR"
  date +%s >"$STARTED_AT"

  bold "Creating ${CLUSTER} in ${REGION}. About 15 minutes. Billing starts now."

  # --with-oidc is the whole point of doing this on AWS rather than on kind. It
  # creates the OIDC identity provider that lets a Kubernetes ServiceAccount be
  # exchanged for an IAM role, which is how a pod gets AWS permissions without
  # anyone putting an access key in a Secret. Everything else here is a cluster;
  # this flag is the AWS-specific thing worth learning.
  #
  # --managed node groups because the alternative is owning the AMI, the
  # bootstrap script and the upgrade path, and none of that teaches anything a
  # first cluster needs to know.
  eksctl create cluster \
    --name "$CLUSTER" \
    --region "$REGION" \
    --version "$K8S_VERSION" \
    --nodegroup-name workers \
    --node-type "$NODE_TYPE" \
    --nodes "$NODE_COUNT" \
    --nodes-min "$NODE_COUNT" \
    --nodes-max "$NODE_COUNT" \
    --managed \
    --with-oidc \
    --vpc-nat-mode Single \
    --tags "project=open-aviation-telemetry,ephemeral=true"

  kubectl get nodes -o wide
  bold 'Cluster up. Run `addons` next, and `down` when finished.'
}

# ---------------------------------------------------------------- addons

addons() {
  local account
  account="$(aws sts get-caller-identity --query Account --output text)"

  bold '== EBS CSI driver =='
  # Without this, a PersistentVolumeClaim stays Pending and gives no reason why.
  # In-tree EBS support was removed in Kubernetes 1.23; the driver is now an
  # addon with its own IAM role, and that role is created through IRSA, which is
  # why the cluster was built --with-oidc.
  eksctl create iamserviceaccount \
    --name ebs-csi-controller-sa \
    --namespace kube-system \
    --cluster "$CLUSTER" \
    --region "$REGION" \
    --role-name "${CLUSTER}-ebs-csi" \
    --role-only \
    --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy \
    --approve

  eksctl create addon \
    --name aws-ebs-csi-driver \
    --cluster "$CLUSTER" \
    --region "$REGION" \
    --service-account-role-arn "arn:aws:iam::${account}:role/${CLUSTER}-ebs-csi" \
    --force

  bold '== AWS Load Balancer Controller =='
  # This is what turns an Ingress with `ingressClassName: alb` into an actual
  # Application Load Balancer. It is not installed by default and its absence
  # looks exactly like a broken Ingress: the object is accepted and no address
  # is ever assigned.
  local policy_arn="arn:aws:iam::${account}:policy/${CLUSTER}-albc"
  if ! aws iam get-policy --policy-arn "$policy_arn" >/dev/null 2>&1; then
    local doc
    doc="$(mktemp)"
    curl -fsSL -o "$doc" \
      https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.13.0/docs/install/iam_policy.json
    aws iam create-policy \
      --policy-name "${CLUSTER}-albc" \
      --policy-document "file://${doc}" >/dev/null
    rm -f "$doc"
  fi

  eksctl create iamserviceaccount \
    --cluster "$CLUSTER" \
    --region "$REGION" \
    --namespace kube-system \
    --name aws-load-balancer-controller \
    --role-name "${CLUSTER}-albc" \
    --attach-policy-arn "$policy_arn" \
    --approve

  helm repo add eks https://aws.github.io/eks-charts >/dev/null
  helm repo update eks >/dev/null
  helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
    --namespace kube-system \
    --set "clusterName=${CLUSTER}" \
    --set serviceAccount.create=false \
    --set serviceAccount.name=aws-load-balancer-controller \
    --wait

  kubectl -n kube-system rollout status deploy/aws-load-balancer-controller
  bold 'Addons ready.'
}

# ---------------------------------------------------------------- deploy

deploy() {
  bold '== Brokers, database, StorageClass =='
  # EKS ships gp2 already marked as the default StorageClass, and the manifest
  # below marks gp3 as one too. Two defaults is not an error Kubernetes reports
  # — it simply stops guaranteeing which one an unqualified claim gets, which is
  # a bug that appears months later on a claim nobody is looking at. Demote gp2
  # first, and only then add gp3.
  kubectl patch storageclass gp2 \
    -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}' \
    2>/dev/null || true

  kubectl apply -f "${REPO_ROOT}/deploy/eks/dependencies.yaml"

  # Fail loudly here rather than letting the PersistentVolumeClaim sit Pending
  # in silence, which is what an EBS CSI driver that did not install looks like.
  local defaults
  defaults="$(kubectl get storageclass \
    -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{" "}{end}')"
  echo "  default StorageClass: ${defaults:-none}"

  # Waiting here rather than letting Helm's migration Job discover a database
  # that is not listening yet. The Job has backoffLimit 3; three fast failures
  # against a PostgreSQL that needed forty seconds is a confusing way to learn
  # that nothing was actually wrong.
  kubectl -n "$NAMESPACE" rollout status deploy/postgres --timeout=5m
  kubectl -n "$NAMESPACE" rollout status deploy/kafka --timeout=5m
  kubectl -n "$NAMESPACE" rollout status deploy/rabbitmq --timeout=5m

  bold '== The application =='
  helm upgrade --install oat "${REPO_ROOT}/charts/open-aviation-telemetry" \
    --namespace "$NAMESPACE" \
    --set "image.registry=${IMAGE_REGISTRY}" \
    --set "image.tag=${IMAGE_TAG}" \
    --set "kafka.brokers=kafka.${NAMESPACE}.svc.cluster.local:9092" \
    --set kafka.auth=plaintext \
    --set database.ssl=disable \
    --set workloads.simulator.enabled=true \
    --set ingress.enabled=true \
    --set ingress.className=alb \
    --wait --timeout 10m

  kubectl -n "$NAMESPACE" get pods
  bold 'Deployed. `verify` next.'
}

# ---------------------------------------------------------------- verify

verify() {
  bold '== Nodes =='
  kubectl get nodes -o wide

  bold '== The EBS volume is real =='
  # A bound PVC here is the proof that the CSI driver's IAM role worked. The
  # volume id is printed because it can be looked up in the console, which is
  # the difference between believing storage was provisioned and checking.
  kubectl -n "$NAMESPACE" get pvc postgres-data
  local vol
  vol="$(kubectl -n "$NAMESPACE" get pvc postgres-data -o jsonpath='{.spec.volumeName}' 2>/dev/null || true)"
  if [[ -n "$vol" ]]; then
    kubectl get pv "$vol" -o jsonpath='{.spec.csi.volumeHandle}{"\n"}'
  fi

  bold '== Pods =='
  kubectl -n "$NAMESPACE" get pods -o wide

  bold '== The load balancer is real =='
  kubectl -n "$NAMESPACE" get ingress
  local host
  host="$(kubectl -n "$NAMESPACE" get ingress -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  if [[ -z "$host" ]]; then
    warn '  No ALB hostname yet. It takes two or three minutes after the Ingress is created.'
  else
    printf '  http://%s\n' "$host"
    # Give the target group time to mark the pods healthy before calling it.
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 5 "http://${host}/api/v1/health" >/dev/null 2>&1; then break; fi
      sleep 10
    done
    bold '== The API, answering through the ALB =='
    curl -fsS --max-time 10 "http://${host}/api/v1/health" | jq . || warn '  health check did not answer'
    bold '== Aircraft, from telemetry that moved through Kafka on this cluster =='
    curl -fsS --max-time 10 "http://${host}/api/v1/aircraft?limit=3" | jq '.data | length' ||
      warn '  aircraft query did not answer'
  fi

  bold '== Consumer lag =='
  kubectl -n "$NAMESPACE" exec deploy/kafka -- \
    /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --all-groups 2>/dev/null ||
    warn '  no consumer groups yet'

  status
}

# ---------------------------------------------------------------- down

down() {
  bold "Destroying ${CLUSTER}. About 10 minutes."

  # Delete the Ingress first and wait. The load balancer controller deletes the
  # ALB in response; if the cluster goes away before it can, the ALB and its
  # security groups are orphaned, they keep billing, and the CloudFormation
  # stack fails to delete because the security group is still attached to the
  # VPC. This is the single most common way an "I destroyed it" cluster keeps
  # charging.
  if kubectl get ns "$NAMESPACE" >/dev/null 2>&1; then
    kubectl -n "$NAMESPACE" delete ingress --all --ignore-not-found --timeout=5m || true
    sleep 30
    helm uninstall oat --namespace "$NAMESPACE" --ignore-not-found --wait --timeout 5m || true
    kubectl delete -f "${REPO_ROOT}/deploy/eks/dependencies.yaml" --ignore-not-found --timeout=5m || true
  fi

  eksctl delete cluster --name "$CLUSTER" --region "$REGION" --wait || {
    warn 'eksctl reported a failure. Do not assume it is gone — run `confirm-gone`.'
  }

  rm -f "$STARTED_AT"
  confirm-gone
}

# Trust nothing. `eksctl delete cluster` can report success while a load
# balancer, a volume or a NAT gateway survives, and each of those bills on its
# own. This asks AWS directly rather than asking eksctl how it thinks it did.
confirm-gone() {
  bold '== Anything still billing? =='
  local found=0

  local clusters
  clusters="$(aws eks list-clusters --region "$REGION" --query 'clusters' --output text 2>/dev/null || true)"
  if [[ -n "$clusters" && "$clusters" != "None" ]]; then
    warn "  EKS clusters: $clusters"
    found=1
  else
    echo '  EKS clusters: none'
  fi

  local albs
  albs="$(aws elbv2 describe-load-balancers --region "$REGION" \
    --query 'LoadBalancers[].LoadBalancerName' --output text 2>/dev/null || true)"
  if [[ -n "$albs" && "$albs" != "None" ]]; then
    warn "  Load balancers: $albs"
    found=1
  else
    echo '  Load balancers: none'
  fi

  local nats
  nats="$(aws ec2 describe-nat-gateways --region "$REGION" \
    --filter 'Name=state,Values=available' \
    --query 'NatGateways[].NatGatewayId' --output text 2>/dev/null || true)"
  if [[ -n "$nats" && "$nats" != "None" ]]; then
    warn "  NAT gateways: $nats"
    found=1
  else
    echo '  NAT gateways: none'
  fi

  local vols
  vols="$(aws ec2 describe-volumes --region "$REGION" \
    --query 'Volumes[].VolumeId' --output text 2>/dev/null || true)"
  if [[ -n "$vols" && "$vols" != "None" ]]; then
    warn "  EBS volumes: $vols"
    found=1
  else
    echo '  EBS volumes: none'
  fi

  local eips
  eips="$(aws ec2 describe-addresses --region "$REGION" \
    --query 'Addresses[].PublicIp' --output text 2>/dev/null || true)"
  if [[ -n "$eips" && "$eips" != "None" ]]; then
    warn "  Elastic IPs: $eips"
    found=1
  else
    echo '  Elastic IPs: none'
  fi

  if [[ "$found" -eq 1 ]]; then
    warn ''
    warn 'Something survived. Delete it by hand before walking away.'
    return 1
  fi
  bold 'Nothing left in this region. The meter is off.'
}

# ---------------------------------------------------------------- status

status() {
  if [[ -f "$STARTED_AT" ]]; then
    local began now hours
    began="$(cat "$STARTED_AT")"
    now="$(date +%s)"
    hours="$(awk "BEGIN{printf \"%.2f\", ($now - $began) / 3600}")"
    # Control plane $0.10/hr, two t3.large $0.1664/hr, NAT gateway $0.045/hr,
    # ALB $0.0225/hr. Roughly, and deliberately rounded up.
    local cost
    cost="$(awk "BEGIN{printf \"%.2f\", $hours * 0.34}")"
    warn "RUNNING for ${hours}h — roughly US\$${cost} so far. \`down\` stops it."
  else
    echo 'No session recorded as running. `confirm-gone` checks AWS itself.'
  fi
}

case "${1:-}" in
  preflight | budget | up | addons | deploy | verify | down | confirm-gone | status)
    cmd="$1"
    shift
    "$cmd" "$@"
    ;;
  *)
    sed -n '3,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
