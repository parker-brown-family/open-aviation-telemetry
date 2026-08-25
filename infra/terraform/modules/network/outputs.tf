output "vpc_id" {
  description = "The VPC id."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "The VPC CIDR block."
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnets, for load balancers and NAT."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnets, for cluster nodes and the data tier."
  value       = aws_subnet.private[*].id
}

output "availability_zones" {
  description = "Availability zones the network spans."
  value       = local.azs
}

output "workload_security_group_id" {
  description = "Security group shared by cluster workloads; use as the source in data-tier rules."
  value       = aws_security_group.workloads.id
}
