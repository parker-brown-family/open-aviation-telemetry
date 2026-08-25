/**
 * Platform services: the container registry and the log groups.
 *
 * Small enough that separate modules would be ceremony, and they share a
 * lifecycle — both exist for as long as the application does, and neither
 * depends on the cluster.
 */

/**
 * One ECR repository per service.
 *
 * Immutable tags are the important setting. With mutable tags, someone can push
 * a different image over an existing tag and the thing running in production is
 * no longer the thing that was tested. With immutable tags, a git SHA means one
 * specific image, permanently.
 */
resource "aws_ecr_repository" "service" {
  for_each = toset(var.services)

  name                 = "${var.name}/${each.value}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    # Scan every push. A vulnerability report that arrives after deployment is
    # worth much less than one that arrives with the build.
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  force_delete = var.force_delete_repositories

  tags = merge(var.tags, { Service = each.value })
}

/**
 * Keep the last N images and expire untagged layers quickly.
 *
 * Without a lifecycle policy an ECR repository grows without limit, and the
 * storage bill is the kind that nobody notices for a year.
 */
resource "aws_ecr_lifecycle_policy" "service" {
  for_each = aws_ecr_repository.service

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after one day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the ${var.retained_image_count} most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.retained_image_count
        }
        action = { type = "expire" }
      },
    ]
  })
}

/**
 * A log group per service, created here rather than left to be auto-created.
 *
 * An auto-created log group has no retention policy, which means logs are kept
 * forever and billed forever. Creating them explicitly is how retention becomes
 * a decision instead of an oversight.
 */
resource "aws_cloudwatch_log_group" "service" {
  for_each = toset(var.services)

  name              = "/aws/eks/${var.name}/${each.value}"
  retention_in_days = var.log_retention_days
  tags              = merge(var.tags, { Service = each.value })
}

/**
 * Alarms on the things that mean the pipeline is broken rather than busy.
 *
 * Deliberately few. An alarm that fires often gets muted, and a muted alarm is
 * worse than none because it looks like coverage.
 */
resource "aws_sns_topic" "alerts" {
  count = var.create_alarm_topic ? 1 : 0

  name = "${var.name}-alerts"
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  count = var.database_identifier == null ? 0 : 1

  alarm_name          = "${var.name}-database-cpu"
  alarm_description   = "Database CPU is sustained high; the workload has outgrown the instance class."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { DBInstanceIdentifier = var.database_identifier }

  alarm_actions = var.create_alarm_topic ? [aws_sns_topic.alerts[0].arn] : []
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_storage" {
  count = var.database_identifier == null ? 0 : 1

  alarm_name          = "${var.name}-database-storage"
  alarm_description   = "Free storage is low. Storage autoscaling has a ceiling and this is the warning before it."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 2147483648 # 2 GiB
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { DBInstanceIdentifier = var.database_identifier }

  alarm_actions = var.create_alarm_topic ? [aws_sns_topic.alerts[0].arn] : []
  tags          = var.tags
}
