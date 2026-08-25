/**
 * The demo environment.
 *
 * One file that composes the modules and makes the environment-specific
 * decisions: small instances, one NAT gateway, no Multi-AZ, no deletion
 * protection. Every one of those is wrong for production, and every one of them
 * is a named variable rather than a hard-coded value, so a production
 * environment is another directory with a different tfvars file rather than a
 * fork of this code.
 *
 * Applying this creates billable resources. `terraform destroy` removes them.
 */

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state, commented out because a first apply has nowhere to put it.
  #
  # Local state is fine for one person demonstrating this. It is not fine for a
  # team: two applies race, and the state file — which contains resource
  # metadata — lives on a laptop. Create the bucket and table, then uncomment.
  #
  # backend "s3" {
  #   bucket       = "oat-terraform-state"
  #   key          = "demo/terraform.tfstate"
  #   region       = "ca-central-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  # Applied to everything the provider creates, so nothing is untagged and
  # `terraform destroy` is not the only way to find what this project owns.
  default_tags {
    tags = local.tags
  }
}

locals {
  name = var.name

  tags = {
    Project     = "open-aviation-telemetry"
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "github.com/parker-brown-family/open-aviation-telemetry"
  }

  services = ["telemetry-api", "telemetry-consumer", "report-worker", "simulator", "web"]
}

# ---------------------------------------------------------------- network

module "network" {
  source = "../../modules/network"

  name                    = local.name
  region                  = var.region
  vpc_cidr                = var.vpc_cidr
  availability_zone_count = 2
  # One NAT gateway for a demo. Production sets this to the AZ count so a single
  # AZ failure cannot cut off outbound traffic from the others.
  nat_gateway_count = 1
  tags              = local.tags
}

# ---------------------------------------------------------------- data tier

module "database" {
  source = "../../modules/database"

  name                       = local.name
  vpc_id                     = module.network.vpc_id
  private_subnet_ids         = module.network.private_subnet_ids
  workload_security_group_id = module.network.workload_security_group_id

  instance_class    = var.database_instance_class
  allocated_storage = 20

  # All three are demo settings. Production wants multi_az = true,
  # skip_final_snapshot = false and deletion_protection = true.
  multi_az              = false
  skip_final_snapshot   = true
  deletion_protection   = false
  backup_retention_days = 1

  tags = local.tags
}

module "messaging" {
  source = "../../modules/messaging"

  name                       = local.name
  vpc_id                     = module.network.vpc_id
  private_subnet_ids         = module.network.private_subnet_ids
  workload_security_group_id = module.network.workload_security_group_id

  rabbitmq_instance_type = var.rabbitmq_instance_type
  # SINGLE_INSTANCE has no redundancy. CLUSTER_MULTI_AZ for production.
  rabbitmq_deployment_mode = "SINGLE_INSTANCE"

  tags = local.tags
}

# ---------------------------------------------------------------- platform

module "platform" {
  source = "../../modules/platform"

  name                = local.name
  services            = local.services
  log_retention_days  = 14
  database_identifier = local.name

  tags = local.tags

  depends_on = [module.database]
}

# ---------------------------------------------------------------- cluster

/**
 * Per-workload AWS permissions.
 *
 * This is where least privilege is actually expressed. The API produces to
 * Kafka and reads two secrets. The consumer consumes from Kafka and reads one
 * secret. The worker never touches Kafka at all, so it is not granted any Kafka
 * permission — if the worker were compromised it could not read the telemetry
 * stream.
 *
 * The simulator has no AWS permissions whatsoever. It talks to the API over
 * HTTP and needs nothing else, so it gets nothing else.
 */
data "aws_iam_policy_document" "read_secrets" {
  statement {
    sid    = "ReadApplicationSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    # The trailing wildcard matches the six-character suffix Secrets Manager
    # appends to every secret ARN. Without it the grant silently matches nothing.
    resources = [
      "${module.database.secret_arn}*",
      "${module.messaging.rabbitmq_secret_arn}*",
    ]
  }
}

# Documents are merged with source_policy_documents rather than by concatenating
# statement objects: IAM statements are not uniformly shaped (Resource is a
# string in one and a list in the next), so Terraform cannot unify them into a
# single list type. Merging rendered documents sidesteps that entirely.
data "aws_iam_policy_document" "stream_client" {
  source_policy_documents = [
    module.messaging.kafka_client_policy_json,
    data.aws_iam_policy_document.read_secrets.json,
  ]
}

module "eks" {
  source = "../../modules/eks"

  name               = local.name
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  public_subnet_ids  = module.network.public_subnet_ids

  kubernetes_version  = var.kubernetes_version
  node_instance_types = var.node_instance_types
  node_desired_size   = var.node_desired_size
  node_min_size       = var.node_min_size
  node_max_size       = var.node_max_size

  # Open by default so a demo can be reached from anywhere. Narrow this to an
  # office or VPN range for anything that outlives the demo.
  public_access_cidrs = var.kubernetes_api_allowed_cidrs

  workload_service_accounts = {
    telemetry-api = {
      namespace       = var.kubernetes_namespace
      service_account = "telemetry-api"
      policy_json     = data.aws_iam_policy_document.stream_client.json
    }
    telemetry-consumer = {
      namespace       = var.kubernetes_namespace
      service_account = "telemetry-consumer"
      policy_json     = data.aws_iam_policy_document.stream_client.json
    }
    report-worker = {
      namespace       = var.kubernetes_namespace
      service_account = "report-worker"
      # No Kafka. The worker consumes from RabbitMQ and reads PostgreSQL; giving
      # it stream access would be granting a permission it never uses.
      policy_json = data.aws_iam_policy_document.read_secrets.json
    }
    simulator = {
      namespace       = var.kubernetes_namespace
      service_account = "simulator"
      # No policy_json at all. It talks to the API over HTTP and needs no AWS
      # access, so it is granted none.
    }
  }

  tags = local.tags
}
