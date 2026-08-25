variable "name" {
  description = "Prefix for repositories, log groups and alarms."
  type        = string
}

variable "services" {
  description = "Service names. One ECR repository and one log group is created for each."
  type        = list(string)
  default     = ["telemetry-api", "telemetry-consumer", "report-worker", "simulator", "web"]
}

variable "retained_image_count" {
  description = "How many tagged images to keep per repository before expiring the oldest."
  type        = number
  default     = 20
}

variable "force_delete_repositories" {
  description = "Allow `terraform destroy` to delete repositories that still hold images. True for a demo."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention. Logs kept forever are a cost with no owner."
  type        = number
  default     = 14
}

variable "database_identifier" {
  description = "RDS instance identifier to alarm on. Null disables the database alarms."
  type        = string
  default     = null
}

variable "create_alarm_topic" {
  description = "Create an SNS topic for alarm notifications."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
