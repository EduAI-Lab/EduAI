import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export interface BedrockGuardrailsStackProps extends cdk.StackProps {
  /** Region the Llama 3 70B on-demand model is invoked in. */
  bedrockRegion: string;
  /** Bedrock model id, e.g. meta.llama3-70b-instruct-v1:0 */
  modelId: string;
  /** Sum of Invocations in 5 minutes above this value trips the alarm. */
  invocationAlarmThreshold: number;
  /** Sum of OutputTokenCount in 5 minutes above this value trips the alarm. */
  outputTokenAlarmThreshold: number;
}

/**
 * AWS-side backstop for Bedrock overflow (#1619).
 *
 * Owns:
 * - least-privilege IAM managed policy (two Invoke* actions, one model ARN)
 * - CloudWatch alarms on AWS/Bedrock Invocations and OutputTokenCount
 * - SNS topic those alarms publish to (exported for #1620; do not redefine there)
 *
 * Does not own: Lambda circuit breaker, apps/core routes, AWS Budgets.
 */
export class BedrockGuardrailsStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;
  public readonly invokePolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: BedrockGuardrailsStackProps) {
    super(scope, id, props);

    const modelArn = `arn:aws:bedrock:${props.bedrockRegion}::foundation-model/${props.modelId}`;

    this.invokePolicy = new iam.ManagedPolicy(this, "Llama370bInvokePolicy", {
      managedPolicyName: "EduaiBedrockLlama370bInvokeOnly",
      description:
        "EduAI overflow: InvokeModel(+stream) on Llama 3 70B Instruct only. No other Bedrock actions, models, or regions.",
      document: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            sid: "InvokeLlama370bOnly",
            effect: iam.Effect.ALLOW,
            actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            resources: [modelArn],
          }),
        ],
      }),
    });

    this.alarmTopic = new sns.Topic(this, "OverflowAlarmTopic", {
      topicName: "eduai-bedrock-overflow-alarm",
      displayName: "EduAI Bedrock overflow CloudWatch tripwire",
    });

    const invocationMetric = new cloudwatch.Metric({
      namespace: "AWS/Bedrock",
      metricName: "Invocations",
      dimensionsMap: { ModelId: props.modelId },
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
      region: props.bedrockRegion,
    });

    const outputTokenMetric = new cloudwatch.Metric({
      namespace: "AWS/Bedrock",
      metricName: "OutputTokenCount",
      dimensionsMap: { ModelId: props.modelId },
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
      region: props.bedrockRegion,
    });

    const invocationAlarm = new cloudwatch.Alarm(this, "InvocationSpikeAlarm", {
      alarmName: "eduai-bedrock-llama370b-invocations",
      alarmDescription: `Tripwire: ${props.modelId} Invocations Sum > ${props.invocationAlarmThreshold} in 5 minutes. Not an AWS Budget (those lag 8–24h).`,
      metric: invocationMetric,
      threshold: props.invocationAlarmThreshold,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const outputTokenAlarm = new cloudwatch.Alarm(this, "OutputTokenSpikeAlarm", {
      alarmName: "eduai-bedrock-llama370b-output-tokens",
      alarmDescription: `Tripwire: ${props.modelId} OutputTokenCount Sum > ${props.outputTokenAlarmThreshold} in 5 minutes.`,
      metric: outputTokenMetric,
      threshold: props.outputTokenAlarmThreshold,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const snsAction = new cw_actions.SnsAction(this.alarmTopic);
    invocationAlarm.addAlarmAction(snsAction);
    outputTokenAlarm.addAlarmAction(snsAction);

    new cdk.CfnOutput(this, "BedrockGuardrailSnsTopicArn", {
      value: this.alarmTopic.topicArn,
      description:
        "SNS topic ARN for Bedrock overflow alarms. #1620 must subscribe here and must not create a second topic.",
      exportName: "EduaiBedrockGuardrailSnsTopicArn",
    });

    new cdk.CfnOutput(this, "BedrockInvokePolicyArn", {
      value: this.invokePolicy.managedPolicyArn,
      description: "Attach this managed policy to the identity that owns AWS_BEARER_TOKEN_BEDROCK.",
    });

    new cdk.CfnOutput(this, "BedrockModelArn", {
      value: modelArn,
      description: "Sole Bedrock resource the IAM policy may invoke.",
    });
  }
}
