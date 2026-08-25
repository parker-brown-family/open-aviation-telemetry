import { CfnOutput, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

/**
 * The same network, registry and log groups as the Terraform, expressed in CDK.
 *
 * This stack manages nothing. It exists so the comparison between the two tools
 * is concrete rather than theoretical — see docs/adr/0001-terraform-is-canonical.md.
 * Terraform owns every deployed resource; running `cdk deploy` against an
 * environment Terraform already manages would produce two tools fighting over
 * the same resources, which is the failure mode that ADR exists to prevent.
 *
 * What the comparison actually shows:
 *
 *   * CDK is a program. `new ec2.Vpc(...)` with subnetConfiguration replaces
 *     roughly a hundred lines of Terraform, because the L2 construct already
 *     encodes the subnet maths, the route tables and the NAT wiring. That is a
 *     real productivity difference and the strongest argument for CDK.
 *
 *   * The cost is that the abstraction decides things for you. The Terraform in
 *     this repository spells out every route table because a reader can then see
 *     what an EKS-ready VPC is made of; this file does not, because the
 *     construct hides it. Both are defensible; they optimise for different
 *     readers.
 *
 *   * `cdk diff` and `terraform plan` are not equivalent. A plan is computed
 *     against real resource state; a diff is computed against the last deployed
 *     CloudFormation template. When someone changes something in the console,
 *     Terraform notices and CloudFormation generally does not.
 */
export interface NetworkStackProps extends StackProps {
  /** Prefix for every resource name, matching the Terraform `name` variable. */
  readonly namePrefix: string;
  /** Services that get an ECR repository and a log group. */
  readonly services: string[];
  /** One NAT gateway is cheap and not redundant; one per AZ is the opposite. */
  readonly natGateways?: number;
  readonly logRetentionDays?: logs.RetentionDays;
}

export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly repositories: Record<string, ecr.Repository> = {};

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { namePrefix, services, natGateways = 1 } = props;

    /**
     * The whole VPC.
     *
     * subnetConfiguration is the interesting part: PRIVATE_WITH_EGRESS gives
     * subnets with a NAT route and no inbound path from the internet, which is
     * exactly what the cluster, the database and both brokers need. In the
     * Terraform this is route tables, associations and NAT gateways written out
     * by hand.
     */
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: namePrefix,
      ipAddresses: ec2.IpAddresses.cidr('10.42.0.0/16'),
      maxAzs: 2,
      natGateways,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 20,
          // Required for an internet-facing ALB to be placed here.
          mapPublicIpOnLaunch: true,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 20,
        },
      ],
      // Free, and keeps image-layer traffic off the metered NAT gateway.
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
      },
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Tags the AWS Load Balancer Controller looks for when deciding where to
    // place an ALB. CDK does not add them, so they are added explicitly — the
    // same requirement as in the Terraform, just expressed differently.
    //
    // Tags.of(), not node.addMetadata(): metadata is CDK's own annotation
    // mechanism and never reaches the resource. Only a tag does, and the
    // controller is looking for a tag.
    for (const subnet of this.vpc.publicSubnets) {
      Tags.of(subnet).add('kubernetes.io/role/elb', '1');
    }
    for (const subnet of this.vpc.privateSubnets) {
      Tags.of(subnet).add('kubernetes.io/role/internal-elb', '1');
    }

    /**
     * One repository per service, with immutable tags.
     *
     * Immutability is the setting that matters: with mutable tags someone can
     * push a different image over an existing tag, and what is running is no
     * longer what was tested.
     */
    for (const service of services) {
      this.repositories[service] = new ecr.Repository(this, `Repo${service}`, {
        repositoryName: `${namePrefix}/${service}`,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        imageScanOnPush: true,
        encryption: ecr.RepositoryEncryption.AES_256,
        lifecycleRules: [
          {
            description: 'Expire untagged images',
            maxImageAge: undefined,
            tagStatus: ecr.TagStatus.UNTAGGED,
            maxImageCount: 1,
          },
          {
            description: 'Keep the 20 most recent',
            tagStatus: ecr.TagStatus.ANY,
            maxImageCount: 20,
          },
        ],
        // DESTROY because this is a disposable reference environment. A real
        // one would use RETAIN so a stack delete cannot take the images with it.
        removalPolicy: RemovalPolicy.DESTROY,
        emptyOnDelete: true,
      });
    }

    /**
     * Log groups created explicitly rather than auto-created.
     *
     * An auto-created log group has no retention policy, so logs are kept — and
     * billed — forever. Creating them here makes retention a decision.
     */
    for (const service of services) {
      new logs.LogGroup(this, `Logs${service}`, {
        logGroupName: `/aws/eks/${namePrefix}/${service}`,
        retention: props.logRetentionDays ?? logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    }

    new CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new CfnOutput(this, 'PrivateSubnetIds', {
      value: this.vpc.privateSubnets.map((s) => s.subnetId).join(','),
    });
    new CfnOutput(this, 'RepositoryUris', {
      value: Object.entries(this.repositories)
        .map(([name, repo]) => `${name}=${repo.repositoryUri}`)
        .join(','),
    });
  }
}
