output "endpoint" {
  description = "Hostname of the database instance."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "Port the database listens on."
  value       = aws_db_instance.this.port
}

output "database_name" {
  description = "Name of the application database."
  value       = var.database_name
}

output "security_group_id" {
  description = "Security group attached to the instance."
  value       = aws_security_group.this.id
}

output "secret_arn" {
  description = "Secrets Manager secret holding the credentials and connection URL."
  value       = aws_secretsmanager_secret.database.arn
}

output "secret_name" {
  description = "Secrets Manager secret name, for the External Secrets Operator or the AWS CLI."
  value       = aws_secretsmanager_secret.database.name
}
