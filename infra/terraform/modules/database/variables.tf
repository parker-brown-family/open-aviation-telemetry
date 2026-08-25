variable "name" {
  description = "Instance identifier and prefix for related resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC the database runs in."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for the DB subnet group. At least two AZs are required."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "RDS requires subnets in at least two availability zones."
  }
}

variable "workload_security_group_id" {
  description = "Security group allowed to connect on 5432."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL major.minor version."
  type        = string
  default     = "16.4"
}

variable "instance_class" {
  description = "RDS instance class. db.t4g.micro is the cheapest that runs this workload."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Initial storage in GiB."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Ceiling for storage autoscaling in GiB. Set equal to allocated_storage to disable."
  type        = number
  default     = 100
}

variable "database_name" {
  description = "Name of the database created on the instance."
  type        = string
  default     = "oat"
}

variable "master_username" {
  description = "Master username. The password is generated, never supplied."
  type        = string
  default     = "oat_admin"
}

variable "multi_az" {
  description = "Run a synchronous standby in a second AZ. Roughly doubles cost; required for production."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Days of automated backups. Zero disables them, which no production database should do."
  type        = number
  default     = 7
}

variable "skip_final_snapshot" {
  description = "Skip the final snapshot on destroy. True is right for a disposable demo, wrong otherwise."
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Refuse to delete the instance. Should be true anywhere data matters."
  type        = bool
  default     = false
}

variable "apply_immediately" {
  description = "Apply changes at once instead of in the maintenance window. Can cause a restart."
  type        = bool
  default     = true
}

variable "performance_insights_enabled" {
  description = "Enable Performance Insights. Free for seven days of retention on supported classes."
  type        = bool
  default     = false
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
