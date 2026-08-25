variable "name" {
  description = "Cluster name and prefix for its IAM roles."
  type        = string
}

variable "vpc_id" {
  description = "VPC the cluster runs in."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for nodes and internal load balancers."
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnets, for internet-facing load balancers only."
  type        = list(string)
}

variable "kubernetes_version" {
  description = "EKS control plane version."
  type        = string
  default     = "1.31"
}

variable "endpoint_public_access" {
  description = "Whether the Kubernetes API is reachable from the internet. Prefer false plus a VPN in production."
  type        = bool
  default     = true
}

variable "public_access_cidrs" {
  description = <<-EOT
    CIDRs allowed to reach the public Kubernetes API endpoint. The default is
    open, which is convenient and is the first thing to narrow for a real
    deployment — set it to your office or VPN range.
  EOT
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "node_instance_types" {
  description = "Instance types for the managed node group."
  type        = list(string)
  default     = ["t3.large"]
}

variable "node_capacity_type" {
  description = "ON_DEMAND or SPOT. SPOT is much cheaper and can be reclaimed at two minutes' notice."
  type        = string
  default     = "ON_DEMAND"

  validation {
    condition     = contains(["ON_DEMAND", "SPOT"], var.node_capacity_type)
    error_message = "node_capacity_type must be ON_DEMAND or SPOT."
  }
}

variable "node_disk_size" {
  description = "Root volume size in GiB for each node."
  type        = number
  default     = 30
}

variable "node_desired_size" {
  description = "Initial node count. The autoscaler owns this afterwards."
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

variable "log_retention_days" {
  description = "Retention for the cluster log group. Logs kept forever are a cost with no owner."
  type        = number
  default     = 14
}

variable "workload_service_accounts" {
  description = <<-EOT
    One entry per application that needs AWS permissions. Each gets its own IAM
    role, bound to a Kubernetes service account through EKS Pod Identity, so a
    compromised workload carries only its own access.

    policy_json is a rendered IAM policy document, so a caller can grant exactly
    what a workload needs without this module knowing about MSK, Secrets Manager
    or anything else in particular. A string rather than structured objects
    because IAM statements are not uniformly shaped — Resource is a string in
    one statement and a list in the next — and Terraform cannot unify those into
    a single list type. Build it with aws_iam_policy_document and pass .json.

    Omit policy_json for a workload that needs no AWS access at all; it still
    gets a role and an association, just with nothing attached.
  EOT
  type = map(object({
    namespace       = string
    service_account = string
    policy_json     = optional(string, null)
  }))
  default = {}
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
