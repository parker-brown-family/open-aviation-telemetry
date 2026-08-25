/**
 * The two brokers.
 *
 * Amazon MSK Serverless for the telemetry event stream, Amazon MQ for RabbitMQ
 * for the job queue. They are in one module because they share a lifecycle and
 * because keeping them side by side makes the point the architecture is trying
 * to make: these are two different tools for two different jobs, provisioned
 * together and used for different things.
 *
 * MSK Serverless rather than provisioned: this project is meant to demonstrate
 * Kafka semantics, not Kafka capacity planning. Serverless removes broker
 * sizing, storage sizing and rebalancing from the problem, and it authenticates
 * with IAM, which is what makes the no-static-credentials story work.
 */

# ---------------------------------------------------------------- MSK

resource "aws_security_group" "msk" {
  name        = "${var.name}-msk"
  description = "MSK access for ${var.name}"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name}-msk" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "msk_from_workloads" {
  security_group_id            = aws_security_group.msk.id
  description                  = "Kafka IAM-authenticated TLS from cluster workloads"
  from_port                    = 9098
  to_port                      = 9098
  ip_protocol                  = "tcp"
  referenced_security_group_id = var.workload_security_group_id
}

resource "aws_vpc_security_group_egress_rule" "msk_all" {
  security_group_id = aws_security_group.msk.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_msk_serverless_cluster" "this" {
  cluster_name = "${var.name}-telemetry"

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.msk.id]
  }

  # IAM is the only authentication MSK Serverless supports, which is a feature:
  # there is no password to rotate, and access is granted with the same policy
  # language as everything else in the account.
  client_authentication {
    sasl {
      iam {
        enabled = true
      }
    }
  }

  tags = merge(var.tags, { Name = "${var.name}-telemetry" })
}

/**
 * The IAM policy a producer or consumer needs.
 *
 * Scoped to this cluster's topics and groups rather than to "*", so the policy
 * cannot quietly grant access to another cluster in the same account.
 *
 * Exposed as a policy document for the caller to attach to whichever workload
 * roles need it — this module does not know which workloads exist.
 */
data "aws_iam_policy_document" "msk_client" {
  statement {
    sid    = "ConnectToCluster"
    effect = "Allow"
    actions = [
      "kafka-cluster:Connect",
      "kafka-cluster:DescribeCluster",
      "kafka-cluster:AlterCluster",
    ]
    resources = [aws_msk_serverless_cluster.this.arn]
  }

  statement {
    sid    = "TopicAccess"
    effect = "Allow"
    actions = [
      "kafka-cluster:DescribeTopic",
      "kafka-cluster:CreateTopic",
      "kafka-cluster:WriteData",
      "kafka-cluster:ReadData",
    ]
    resources = [
      replace(replace(aws_msk_serverless_cluster.this.arn, ":cluster/", ":topic/"), "$", "/*"),
    ]
  }

  statement {
    sid    = "ConsumerGroupAccess"
    effect = "Allow"
    actions = [
      "kafka-cluster:DescribeGroup",
      "kafka-cluster:AlterGroup",
    ]
    resources = [
      replace(replace(aws_msk_serverless_cluster.this.arn, ":cluster/", ":group/"), "$", "/*"),
    ]
  }
}

# ---------------------------------------------------------------- Amazon MQ

resource "random_password" "rabbitmq" {
  length = 32
  # Amazon MQ rejects commas, colons, equals signs and several others in a
  # RabbitMQ password, so the character set is restricted deliberately.
  special          = true
  override_special = "-_.~"
}

resource "aws_security_group" "mq" {
  name        = "${var.name}-mq"
  description = "Amazon MQ access for ${var.name}"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name}-mq" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "mq_amqps" {
  security_group_id            = aws_security_group.mq.id
  description                  = "AMQPS from cluster workloads"
  from_port                    = 5671
  to_port                      = 5671
  ip_protocol                  = "tcp"
  referenced_security_group_id = var.workload_security_group_id
}

resource "aws_vpc_security_group_ingress_rule" "mq_console" {
  security_group_id            = aws_security_group.mq.id
  description                  = "RabbitMQ management console from cluster workloads"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  referenced_security_group_id = var.workload_security_group_id
}

resource "aws_vpc_security_group_egress_rule" "mq_all" {
  security_group_id = aws_security_group.mq.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

/**
 * A RabbitMQ broker.
 *
 * SINGLE_INSTANCE for a demo. CLUSTER_MULTI_AZ runs three nodes across
 * availability zones and is what production wants — set rabbitmq_deployment_mode
 * and give it three private subnets.
 *
 * Worth knowing before planning a demo: creating a RabbitMQ broker takes AWS
 * roughly fifteen minutes, so this is the long pole in a first apply.
 */
resource "aws_mq_broker" "this" {
  broker_name = "${var.name}-jobs"

  engine_type        = "RabbitMQ"
  engine_version     = var.rabbitmq_version
  host_instance_type = var.rabbitmq_instance_type
  deployment_mode    = var.rabbitmq_deployment_mode

  # A single-instance broker takes exactly one subnet; a clustered one takes
  # three. Passing the wrong count is a slow failure, so it is computed.
  subnet_ids = var.rabbitmq_deployment_mode == "SINGLE_INSTANCE" ? [var.private_subnet_ids[0]] : slice(var.private_subnet_ids, 0, min(3, length(var.private_subnet_ids)))

  security_groups     = [aws_security_group.mq.id]
  publicly_accessible = false

  # Off, so a version upgrade happens when someone decides to, not overnight.
  auto_minor_version_upgrade = false
  apply_immediately          = true

  user {
    username = var.rabbitmq_username
    password = random_password.rabbitmq.result
  }

  logs {
    general = true
  }

  maintenance_window_start_time {
    day_of_week = "SUNDAY"
    time_of_day = "09:00"
    time_zone   = "UTC"
  }

  tags = merge(var.tags, { Name = "${var.name}-jobs" })
}

resource "aws_secretsmanager_secret" "rabbitmq" {
  name                    = "${var.name}/rabbitmq"
  description             = "RabbitMQ credentials and connection URL for ${var.name}"
  recovery_window_in_days = var.secret_recovery_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "rabbitmq" {
  secret_id = aws_secretsmanager_secret.rabbitmq.id

  secret_string = jsonencode({
    username = var.rabbitmq_username
    password = random_password.rabbitmq.result
    endpoint = aws_mq_broker.this.instances[0].endpoints[0]
    console  = aws_mq_broker.this.instances[0].console_url
    # amqps, not amqp: Amazon MQ only accepts TLS.
    url = "amqps://${var.rabbitmq_username}:${urlencode(random_password.rabbitmq.result)}@${replace(replace(aws_mq_broker.this.instances[0].endpoints[0], "amqps://", ""), ":5671", "")}:5671"
  })
}
