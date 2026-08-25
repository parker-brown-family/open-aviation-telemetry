variable "name" {
  description = "Prefix for the cluster, the broker and their secrets."
  type        = string
}

variable "vpc_id" {
  description = "VPC both brokers run in."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets. MSK Serverless spans all of them; RabbitMQ takes one or three."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "At least two private subnets are required."
  }
}

variable "workload_security_group_id" {
  description = "Security group allowed to reach both brokers."
  type        = string
}

variable "rabbitmq_version" {
  description = "Amazon MQ RabbitMQ engine version."
  type        = string
  default     = "3.13"
}

variable "rabbitmq_instance_type" {
  description = "Broker instance type. mq.t3.micro is the smallest and is single-instance only."
  type        = string
  default     = "mq.t3.micro"
}

variable "rabbitmq_deployment_mode" {
  description = <<-EOT
    SINGLE_INSTANCE or CLUSTER_MULTI_AZ. Single instance is cheap and has no
    redundancy: losing the AZ loses the queue until it is restored. Production
    should be CLUSTER_MULTI_AZ, which needs three subnets and a larger instance.
  EOT
  type        = string
  default     = "SINGLE_INSTANCE"

  validation {
    condition     = contains(["SINGLE_INSTANCE", "CLUSTER_MULTI_AZ"], var.rabbitmq_deployment_mode)
    error_message = "rabbitmq_deployment_mode must be SINGLE_INSTANCE or CLUSTER_MULTI_AZ."
  }
}

variable "rabbitmq_username" {
  description = "RabbitMQ username. The password is generated, never supplied."
  type        = string
  default     = "oat_app"
}

variable "secret_recovery_days" {
  description = "Secrets Manager recovery window. Zero deletes immediately so the name can be reused."
  type        = number
  default     = 0
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
