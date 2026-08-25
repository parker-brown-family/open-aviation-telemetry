output "kafka_cluster_arn" {
  description = "MSK Serverless cluster ARN."
  value       = aws_msk_serverless_cluster.this.arn
}

output "kafka_bootstrap_brokers" {
  description = "Bootstrap servers for KAFKA_BROKERS, using SASL/IAM on port 9098."
  value       = aws_msk_serverless_cluster.this.bootstrap_brokers_sasl_iam
}

output "kafka_client_policy_json" {
  description = "IAM policy document granting produce and consume on this cluster; attach to workload roles."
  value       = data.aws_iam_policy_document.msk_client.json
}

output "kafka_cluster_name" {
  description = "MSK Serverless cluster name."
  value       = aws_msk_serverless_cluster.this.cluster_name
}

output "kafka_security_group_id" {
  description = "Security group attached to the MSK cluster."
  value       = aws_security_group.msk.id
}

output "rabbitmq_endpoint" {
  description = "AMQPS endpoint for the RabbitMQ broker."
  value       = aws_mq_broker.this.instances[0].endpoints[0]
}

output "rabbitmq_console_url" {
  description = "RabbitMQ management console URL, reachable from inside the VPC only."
  value       = aws_mq_broker.this.instances[0].console_url
}

output "rabbitmq_secret_arn" {
  description = "Secrets Manager secret holding the RabbitMQ credentials and connection URL."
  value       = aws_secretsmanager_secret.rabbitmq.arn
}

output "rabbitmq_secret_name" {
  description = "RabbitMQ secret name."
  value       = aws_secretsmanager_secret.rabbitmq.name
}

output "rabbitmq_security_group_id" {
  description = "Security group attached to the RabbitMQ broker."
  value       = aws_security_group.mq.id
}
