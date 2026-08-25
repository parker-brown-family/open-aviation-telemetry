/**
 * Network.
 *
 * Two availability zones, public subnets for the load balancer and NAT, private
 * subnets for everything else. The database, both brokers and every pod live in
 * the private subnets with no route from the internet — the only way in is the
 * load balancer.
 *
 * The NAT gateway count is a variable because it is the sharpest cost/resilience
 * trade in this file. One NAT gateway is about half the cost and is a single
 * point of failure for outbound traffic from the other AZ; one per AZ removes
 * that. A demo uses one, production uses one per AZ.
 */

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)

  # /20 subnets carved out of the VPC CIDR: public first, then private.
  public_subnets  = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 4, i)]
  private_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 4, i + 8)]
}

resource "aws_vpc" "this" {
  cidr_block = var.vpc_cidr

  # Both required by EKS: the kubelet and several add-ons resolve one another
  # through VPC-provided DNS.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name}-igw" })
}

resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${var.name}-public-${local.azs[count.index]}"
    # The AWS Load Balancer Controller discovers where to put an internet-facing
    # ALB by looking for this tag. Without it, an Ingress silently never gets an
    # address.
    "kubernetes.io/role/elb" = "1"
  })
}

resource "aws_subnet" "private" {
  count = length(local.azs)

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = local.azs[count.index]

  tags = merge(var.tags, {
    Name                              = "${var.name}-private-${local.azs[count.index]}"
    "kubernetes.io/role/internal-elb" = "1"
  })
}

resource "aws_eip" "nat" {
  count      = var.nat_gateway_count
  domain     = "vpc"
  tags       = merge(var.tags, { Name = "${var.name}-nat-${count.index}" })
  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count = var.nat_gateway_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = merge(var.tags, { Name = "${var.name}-nat-${count.index}" })
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name}-public" })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# One route table per private subnet, so each AZ can be pointed at its own NAT
# gateway when there is more than one.
resource "aws_route_table" "private" {
  count = length(local.azs)

  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name}-private-${local.azs[count.index]}" })
}

resource "aws_route" "private_nat" {
  count = var.nat_gateway_count > 0 ? length(local.azs) : 0

  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  # With a single shared NAT gateway every AZ routes through index 0.
  nat_gateway_id = aws_nat_gateway.this[min(count.index, var.nat_gateway_count - 1)].id
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

/**
 * A gateway endpoint for S3.
 *
 * Free, and it keeps image-layer and log traffic to S3 off the NAT gateway,
 * which is metered per gigabyte. On a cluster pulling images this is usually
 * the single largest NAT saving available, so it is not an optimisation worth
 * deferring.
 */
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id
  tags              = merge(var.tags, { Name = "${var.name}-s3" })
}

# A security group that grants nothing on its own. Other modules reference it as
# a source, which is how "the database accepts connections from the cluster, and
# from nothing else" is expressed without hard-coding a CIDR.
resource "aws_security_group" "workloads" {
  name        = "${var.name}-workloads"
  description = "Shared identity for cluster workloads; referenced by data-tier security groups"
  vpc_id      = aws_vpc.this.id

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-workloads" })

  lifecycle {
    create_before_destroy = true
  }
}
