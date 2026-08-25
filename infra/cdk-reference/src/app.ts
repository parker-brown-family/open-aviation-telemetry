#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { NetworkStack } from './network-stack.js';

/**
 * CDK application entrypoint.
 *
 * This is a reference implementation for comparison with the Terraform in
 * ../terraform. It is not the deployment path for this project and must not be
 * pointed at an environment Terraform manages.
 *
 *   pnpm --filter @oat/cdk-reference exec cdk synth
 *
 * synth renders CloudFormation and touches no AWS account, which is how to read
 * this without deploying anything.
 */
const app = new App();

const namePrefix = app.node.tryGetContext('namePrefix') ?? 'oat-cdk';
const region = process.env.CDK_DEFAULT_REGION ?? 'ca-central-1';
const account = process.env.CDK_DEFAULT_ACCOUNT;

new NetworkStack(app, 'OatNetworkStack', {
  namePrefix,
  services: ['telemetry-api', 'telemetry-consumer', 'report-worker', 'simulator', 'web'],
  natGateways: 1,
  env: account ? { account, region } : { region },
  description:
    'Reference-only network, registry and log groups. Terraform is the canonical implementation.',
});

// The same tags the Terraform applies, plus one that says which tool created
// these resources — so a resource created by the wrong tool is obvious.
Tags.of(app).add('Project', 'open-aviation-telemetry');
Tags.of(app).add('ManagedBy', 'cdk-reference');
Tags.of(app).add('Environment', 'reference');
