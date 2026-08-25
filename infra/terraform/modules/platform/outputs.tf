output "repository_urls" {
  description = "ECR repository URLs, keyed by service name. These are the image names CI pushes to."
  value       = { for k, r in aws_ecr_repository.service : k => r.repository_url }
}

output "repository_arns" {
  description = "ECR repository ARNs, keyed by service name."
  value       = { for k, r in aws_ecr_repository.service : k => r.arn }
}

output "log_group_names" {
  description = "CloudWatch log group names, keyed by service name."
  value       = { for k, g in aws_cloudwatch_log_group.service : k => g.name }
}

output "alarm_topic_arn" {
  description = "SNS topic alarms publish to, when one was created."
  value       = var.create_alarm_topic ? aws_sns_topic.alerts[0].arn : null
}
