import * as cdk from 'aws-cdk-lib'
import { MultiEnvRootStack } from 'common/multi-env-stack'
import { Construct } from 'constructs'
import { parameters } from './parameters'
import { NagSuppressions } from 'cdk-nag'

export class Core extends MultiEnvRootStack {
  public readonly cloudMapNamespace: cdk.aws_servicediscovery.PrivateDnsNamespace
  public readonly dataDogApiKeySecret: cdk.aws_secretsmanager.ISecret
  public readonly internalEndpointSecret: cdk.aws_secretsmanager.ISecret
  public readonly secretsSecret: cdk.aws_secretsmanager.ISecret
  public readonly vpc: cdk.aws_ec2.Vpc
  public readonly hostedZone: cdk.aws_route53.HostedZone

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)
    cdk.Tags.of(this).add('service', 'core')
    const stackParameters = parameters({
      environment: this.node.tryGetContext('env'),
    })

    // ANCHOR Secrets
    this.secretsSecret = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'secrets',
      stackParameters.secretsBundleArn
    )

    this.dataDogApiKeySecret =
      cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'DataDogApiKeySecret',
        this.node.tryGetContext('dataDogApiKeySecretArn')
      )

    this.internalEndpointSecret = new cdk.aws_secretsmanager.Secret(
      this,
      'internal-endpoint-secret',
      {
        generateSecretString: { excludePunctuation: true, passwordLength: 16 },
      }
    )

    // ANCHOR Set up VPC
    this.vpc = new cdk.aws_ec2.Vpc(this, 'Vpc', {
      cidr: '10.7.0.0/16',
      maxAzs: 3,

      subnetConfiguration: [
        { name: 'Public', subnetType: cdk.aws_ec2.SubnetType.PUBLIC },
        {
          name: 'Private',
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_NAT,
        },
        {
          name: 'Isolated',
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    })

    const vpcFlowLogGroup = new cdk.aws_logs.LogGroup(
      this,
      'vpc-flow-log-group',
      {
        retention: cdk.aws_logs.RetentionDays.TWO_MONTHS,
      }
    )

    new cdk.aws_ec2.FlowLog(this, 'FlowLog', {
      resourceType: cdk.aws_ec2.FlowLogResourceType.fromVpc(this.vpc),
      destination:
        cdk.aws_ec2.FlowLogDestination.toCloudWatchLogs(vpcFlowLogGroup),
      trafficType: cdk.aws_ec2.FlowLogTrafficType.ALL,
    })

    // ANCHOR Set up DNS
    this.cloudMapNamespace = new cdk.aws_servicediscovery.PrivateDnsNamespace(
      this,
      'CloudMapNamespace',
      {
        name: stackParameters.cloudMapNamespace,
        vpc: this.vpc,
      }
    )

    this.hostedZone = new cdk.aws_route53.HostedZone(this, 'HostedZone', {
      zoneName: stackParameters.hostedZoneName,
      comment: `Hosted zone for ${this.stackName} stack`,
    })

    if (this.node.tryGetContext('env').id === 'production') {
      new cdk.aws_route53.NsRecord(this, 'staging-ns', {
        zone: this.hostedZone,
        recordName: parameters({
          environment: { ...this.node.tryGetContext('env'), stage: 'staging' },
        }).hostedZoneName,

        // REVIEW Find a way to import these values frm staging account, intstead of hardcoding
        values: [
          'ns-2031.awsdns-61.co.uk',
          'ns-920.awsdns-51.net',
          'ns-65.awsdns-08.com',
          'ns-1091.awsdns-08.org',
        ],
      })
    }

    // ANCHOR Exports
    this.exportValue(this.vpc.vpcId)
    this.vpc
      .selectSubnets()
      .subnetIds.forEach((subnetId) => this.exportValue(subnetId))

    NagSuppressions.addResourceSuppressions(this.internalEndpointSecret, [
      { id: 'AwsSolutions-SMG4', reason: 'Requires a dedicated planning.' },
    ])
  }
}
