variable "region" {
  description = "AWS region. ca-central-1 keeps the data in Canada, which suits the demo domain."
  type        = string
  default     = "ca-central-1"
}

variable "name" {
  description = "Name prefix for every resource in this environment."
  type        = string
  default     = "oat-demo"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name))
    error_message = "name must be lowercase alphanumeric with hyphens, 3-31 characters."
  }
}

variable "environment" {
  description = "Environment label, used in tags."
  type        = string
  default     = "demo"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "kubernetes_version" {
  description = "EKS control plane version."
  type        = string
  default     = "1.31"
}

variable "kubernetes_namespace" {
  description = "Namespace the workloads are deployed into. Must match the Helm chart."
  type        = string
  default     = "aviation"
}

variable "kubernetes_api_allowed_cidrs" {
  description = "CIDRs allowed to reach the public Kubernetes API endpoint. Narrow this for anything real."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "node_instance_types" {
  description = "Instance types for the managed node group."
  type        = list(string)
  default     = ["t3.large"]
}

variable "node_desired_size" {
  description = "Initial node count."
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = "Minimum node count."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Maximum node count."
  type        = number
  default     = 4
}

variable "database_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "rabbitmq_instance_type" {
  description = "Amazon MQ broker instance type."
  type        = string
  default     = "mq.t3.micro"
}
