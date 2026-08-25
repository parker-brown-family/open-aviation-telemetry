/**
 * Amazon EKS: control plane, a managed node group, the add-ons the workloads
 * need, and one IAM role per application delivered through EKS Pod Identity.
 *
 * Written as plain resources rather than by calling the community EKS module.
 * That module is the right answer for a team that maintains real clusters — it
 * handles far more cases than this does. Here the point is that a reader can
 * see exactly what an EKS cluster is made of, which a module call hides.
 */

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  cluster_name = var.name
}

# ---------------------------------------------------------------- cluster role

resource "aws_iam_role" "cluster" {
  name = "${var.name}-cluster"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSClusterPolicy"
}

# ---------------------------------------------------------------- control plane

resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/aws/eks/${local.cluster_name}/cluster"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_security_group" "cluster" {
  name        = "${var.name}-cluster"
  description = "EKS control plane"
  vpc_id      = var.vpc_id

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-cluster" })
}

resource "aws_eks_cluster" "this" {
  name     = local.cluster_name
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  vpc_config {
    subnet_ids              = concat(var.private_subnet_ids, var.public_subnet_ids)
    security_group_ids      = [aws_security_group.cluster.id]
    endpoint_private_access = true
    # Public endpoint access is on so the cluster can be reached without a
    # bastion or VPN, but it is restricted by CIDR. Set
    # public_access_cidrs = [] and use private access only for a real
    # production cluster.
    endpoint_public_access = var.endpoint_public_access
    public_access_cidrs    = var.public_access_cidrs
  }

  access_config {
    # API mode drops the aws-auth ConfigMap entirely: cluster access is granted
    # through IAM access entries, which are auditable and revocable the same way
    # every other AWS permission is.
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = true
  }

  # Audit and authenticator logs are the two that answer "who did this".
  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  tags = merge(var.tags, { Name = local.cluster_name })

  depends_on = [
    aws_iam_role_policy_attachment.cluster,
    aws_cloudwatch_log_group.cluster,
  ]
}

# ---------------------------------------------------------------- node group

resource "aws_iam_role" "node" {
  name = "${var.name}-node"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    "AmazonEKSWorkerNodePolicy",
    "AmazonEKS_CNI_Policy",
    # Pull access to ECR. Nodes need it to start a pod at all; the applications
    # themselves get their AWS permissions from Pod Identity instead.
    "AmazonEC2ContainerRegistryReadOnly",
    # Lets the CloudWatch agent and SSM Session Manager work without opening SSH.
    "AmazonSSMManagedInstanceCore",
  ])

  role       = aws_iam_role.node.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/${each.value}"
}

resource "aws_eks_node_group" "this" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "${var.name}-default"
  node_role_arn   = aws_iam_role.node.arn
  # Nodes go in private subnets only. A node with a public IP is a node exposed
  # to the internet for no reason.
  subnet_ids = var.private_subnet_ids

  instance_types = var.node_instance_types
  capacity_type  = var.node_capacity_type
  disk_size      = var.node_disk_size

  scaling_config {
    desired_size = var.node_desired_size
    min_size     = var.node_min_size
    max_size     = var.node_max_size
  }

  update_config {
    # Replace one node at a time so capacity never drops below what the
    # workloads need during an upgrade.
    max_unavailable = 1
  }

  labels = { workload = "general" }
  tags   = var.tags

  lifecycle {
    # The cluster autoscaler owns desired_size once it is running; Terraform
    # setting it back on every apply would fight it.
    ignore_changes = [scaling_config[0].desired_size]
  }

  depends_on = [aws_iam_role_policy_attachment.node]
}

# ---------------------------------------------------------------- add-ons

/**
 * EKS Pod Identity Agent.
 *
 * This is what makes `eks-pod-identity` associations work. Without it, the
 * association exists in the API and the pod still has no credentials — a
 * genuinely confusing failure, so the add-on is not optional here.
 */
resource "aws_eks_addon" "pod_identity" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "eks-pod-identity-agent"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = var.tags

  depends_on = [aws_eks_node_group.this]
}

resource "aws_eks_addon" "vpc_cni" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "vpc-cni"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = var.tags

  depends_on = [aws_eks_node_group.this]
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "kube-proxy"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = var.tags

  depends_on = [aws_eks_node_group.this]
}

resource "aws_eks_addon" "coredns" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "coredns"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  tags                        = var.tags

  depends_on = [aws_eks_node_group.this]
}

# ---------------------------------------------------------------- pod identity

/**
 * One IAM role per application.
 *
 * The alternative — a single role shared by every pod — means a bug in the
 * simulator carries the same AWS permissions as the API. Separate roles keep
 * the blast radius of any one compromised workload to that workload's own
 * access, which is the entire argument for least privilege.
 *
 * The trust policy names pods.eks.amazonaws.com, so only the EKS Pod Identity
 * service can assume these roles — not an EC2 instance, not a user.
 */
resource "aws_iam_role" "workload" {
  for_each = var.workload_service_accounts

  name = "${var.name}-${each.key}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "pods.eks.amazonaws.com" }
      Action    = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })

  tags = merge(var.tags, { Workload = each.key })
}

resource "aws_iam_role_policy" "workload" {
  # Only workloads that were given a policy get one. A workload with no AWS
  # permissions still gets a role and an association — it just cannot do
  # anything with them, which is the correct outcome for the simulator.
  for_each = { for k, v in var.workload_service_accounts : k => v if v.policy_json != null }

  name   = "${var.name}-${each.key}"
  role   = aws_iam_role.workload[each.key].id
  policy = each.value.policy_json
}

resource "aws_eks_pod_identity_association" "workload" {
  for_each = var.workload_service_accounts

  cluster_name    = aws_eks_cluster.this.name
  namespace       = each.value.namespace
  service_account = each.value.service_account
  role_arn        = aws_iam_role.workload[each.key].arn
  tags            = var.tags

  depends_on = [aws_eks_addon.pod_identity]
}
