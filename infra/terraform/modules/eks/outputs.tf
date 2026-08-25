output "cluster_name" {
  description = "EKS cluster name; use with `aws eks update-kubeconfig`."
  value       = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  description = "Kubernetes API endpoint."
  value       = aws_eks_cluster.this.endpoint
}

output "cluster_version" {
  description = "Kubernetes version running on the control plane."
  value       = aws_eks_cluster.this.version
}

output "cluster_certificate_authority_data" {
  description = "Base64 CA certificate for the cluster."
  value       = aws_eks_cluster.this.certificate_authority[0].data
  sensitive   = true
}

output "cluster_security_group_id" {
  description = "Security group EKS created for control-plane to node traffic."
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}

output "node_role_arn" {
  description = "IAM role assumed by the worker nodes."
  value       = aws_iam_role.node.arn
}

output "workload_role_arns" {
  description = "Per-application IAM role ARNs, keyed by workload name."
  value       = { for k, r in aws_iam_role.workload : k => r.arn }
}

output "account_id" {
  description = "Account the cluster was created in."
  value       = data.aws_caller_identity.current.account_id
}
