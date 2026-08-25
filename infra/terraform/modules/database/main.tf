/**
 * Amazon RDS for PostgreSQL.
 *
 * Private subnets, no public accessibility, and a security group that accepts
 * connections only from the cluster's workload security group — not from a CIDR
 * range, so the rule keeps meaning what it says as the network changes.
 *
 * The password is generated here and written to Secrets Manager. It is never
 * printed, never an input variable, and never checked in. The pods read it from
 * Secrets Manager using their own IAM identity.
 */

resource "random_password" "master" {
  length = 32
  # RDS rejects several punctuation characters in a master password, so the set
  # is restricted rather than left to chance on apply.
  special          = true
  override_special = "!#%*()-_=+[]{}<>:?"
}

resource "aws_db_subnet_group" "this" {
  name        = var.name
  description = "Private subnets for ${var.name}"
  subnet_ids  = var.private_subnet_ids
  tags        = merge(var.tags, { Name = var.name })
}

resource "aws_security_group" "this" {
  name        = "${var.name}-db"
  description = "PostgreSQL access for ${var.name}"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name}-db" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "from_workloads" {
  security_group_id            = aws_security_group.this.id
  description                  = "PostgreSQL from cluster workloads"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = var.workload_security_group_id
}

resource "aws_db_parameter_group" "this" {
  name        = "${var.name}-pg16"
  family      = "postgres16"
  description = "Parameters for ${var.name}"

  # Reject any connection that is not encrypted. Encryption in transit is not
  # useful if it is merely available.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Log statements slower than a second. Fast enough to be quiet in normal
  # operation, slow enough that anything it catches is worth reading.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "this" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.database_name
  username = var.master_username
  password = random_password.master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false

  # Multi-AZ keeps a synchronous standby in another availability zone and fails
  # over automatically. It roughly doubles the cost, which is why it is a
  # variable — off for a demo, on for anything real.
  multi_az = var.multi_az

  backup_retention_period = var.backup_retention_days
  backup_window           = "08:00-09:00"
  maintenance_window      = "sun:09:30-sun:10:30"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true
  apply_immediately          = var.apply_immediately

  # A demo environment is torn down often, so skipping the final snapshot avoids
  # accumulating snapshots nobody will restore. Production must not skip it.
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.name}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  deletion_protection       = var.deletion_protection

  performance_insights_enabled    = var.performance_insights_enabled
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = merge(var.tags, { Name = var.name })

  lifecycle {
    # final_snapshot_identifier embeds a timestamp, so it differs on every plan
    # and would otherwise show a perpetual diff.
    ignore_changes = [final_snapshot_identifier]
  }
}

# ---------------------------------------------------------------- secret

resource "aws_secretsmanager_secret" "database" {
  name        = "${var.name}/database"
  description = "PostgreSQL credentials and connection string for ${var.name}"
  # Zero means the secret is deleted immediately on destroy rather than being
  # held for a week, which otherwise blocks recreating the environment under the
  # same name.
  recovery_window_in_days = var.secret_recovery_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id = aws_secretsmanager_secret.database.id

  secret_string = jsonencode({
    username = var.master_username
    password = random_password.master.result
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = var.database_name
    # The exact value DATABASE_URL takes. Assembling it here means no service
    # has to know how to build one.
    url = "postgres://${var.master_username}:${urlencode(random_password.master.result)}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${var.database_name}?sslmode=require"
  })
}
