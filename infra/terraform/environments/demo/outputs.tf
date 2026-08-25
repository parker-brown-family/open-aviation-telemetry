/**
 * Outputs.
 *
 * These are the values a person or a pipeline needs after an apply — nothing
 * else. Credentials are deliberately absent: the connection strings live in
 * Secrets Manager and the outputs name the secret rather than reproducing its
 * contents, so `terraform output` cannot leak a database password onto a
 * terminal or into a CI log.
 */

output "region" {
  description = "Region everything was created in."
  value       = var.region
}

output "cluster_name" {
  description = "EKS cluster name."
  value       = module.eks.cluster_name
}

output "kubeconfig_command" {
  description = "Run this to point kubectl at the cluster."
  value       = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.region}"
}

output "vpc_id" {
  description = "VPC id."
  value       = module.network.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnets."
  value       = module.network.private_subnet_ids
}

output "database_endpoint" {
  description = "PostgreSQL hostname. The credentials are in Secrets Manager, not here."
  value       = module.database.endpoint
}

output "database_secret_name" {
  description = "Secrets Manager secret holding DATABASE_URL. Read it with `aws secretsmanager get-secret-value`."
  value       = module.database.secret_name
}

output "kafka_bootstrap_brokers" {
  description = "Value for KAFKA_BROKERS. Authentication is IAM, so there is no password."
  value       = module.messaging.kafka_bootstrap_brokers
}

output "rabbitmq_endpoint" {
  description = "AMQPS endpoint for the RabbitMQ broker."
  value       = module.messaging.rabbitmq_endpoint
}

output "rabbitmq_secret_name" {
  description = "Secrets Manager secret holding RABBITMQ_URL."
  value       = module.messaging.rabbitmq_secret_name
}

output "ecr_repository_urls" {
  description = "Image repositories, keyed by service. CI pushes here."
  value       = module.platform.repository_urls
}

output "workload_role_arns" {
  description = "Per-application IAM roles bound through EKS Pod Identity."
  value       = module.eks.workload_role_arns
}

output "next_steps" {
  description = "What to do once the apply finishes."
  value       = <<-EOT
    1. aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.region}
    2. Build and push images to the repositories in ecr_repository_urls.
    3. helm upgrade --install oat charts/open-aviation-telemetry \
         --namespace ${var.kubernetes_namespace} --create-namespace \
         --set image.registry=<account>.dkr.ecr.${var.region}.amazonaws.com/${var.name} \
         --set secrets.databaseSecretName=${module.database.secret_name} \
         --set secrets.rabbitmqSecretName=${module.messaging.rabbitmq_secret_name} \
         --set kafka.brokers=${module.messaging.kafka_bootstrap_brokers} \
         --set kafka.auth=aws-msk-iam
    4. make smoke API_URL=<the ingress address>
    5. terraform destroy when the demo is over. This costs money while it runs.
  EOT
}
