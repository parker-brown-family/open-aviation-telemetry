variable "name" {
  description = "Name prefix applied to every resource in this module."
  type        = string
}

variable "region" {
  description = "AWS region; used to build the S3 endpoint service name."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC. A /16 leaves room for /20 subnets per AZ."
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "availability_zone_count" {
  description = "How many availability zones to span. Two is the minimum EKS and RDS Multi-AZ require."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 4
    error_message = "availability_zone_count must be between 2 and 4."
  }
}

variable "nat_gateway_count" {
  description = <<-EOT
    Number of NAT gateways. 1 is cheapest and makes outbound traffic from other
    AZs depend on one AZ; set it equal to availability_zone_count for production.
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.nat_gateway_count >= 1 && var.nat_gateway_count <= 4
    error_message = "nat_gateway_count must be between 1 and 4."
  }
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
