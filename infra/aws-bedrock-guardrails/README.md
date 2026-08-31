# AWS Bedrock overflow guardrails

Last verified: 2026-08-31

This CDK stack is an AWS-side safety boundary for the Bedrock bearer token used
by EduAI. It is separate from the application runtime: it does not change
`apps/core`, deploy a Lambda, or replace the application's Redis/PostgreSQL spend
and rate controls.

## Resources created

| Resource | Contract |
| --- | --- |
| `EduaiBedrockLlama370bInvokeOnly` | Allows bearer-token authentication and invocation of one configured foundation model ARN; explicitly denies Invoke* on every other model |
| `eduai-bedrock-overflow-alarm` | Alarm destination, exported as `EduaiBedrockGuardrailSnsTopicArn`; no subscription is created by this stack |
| `eduai-bedrock-llama370b-invocations` | `AWS/Bedrock` `Invocations` sum over five minutes |
| `eduai-bedrock-llama370b-output-tokens` | `AWS/Bedrock` `OutputTokenCount` sum over five minutes |

Both alarms evaluate one five-minute period, trigger when the metric is greater
than its threshold, and treat missing data as not breaching. Both publish to the
stack-owned SNS topic.

## IAM policy contract

The policy is intended to replace broad Bedrock permissions on the IAM user that
owns `AWS_BEARER_TOKEN_BEDROCK`; IAM allow statements are unioned, so attaching
this policy beside `AmazonBedrockLimitedAccess` does not constrain the user.

The synthesized policy contains exactly:

1. `bedrock:CallWithBearerToken` allowed on `*`, required for the Bedrock bearer
   token flow.
2. `bedrock:InvokeModel` and
   `bedrock:InvokeModelWithResponseStream` allowed on the configured model ARN.
3. The same two Invoke* actions explicitly denied with `NotResource` set to every
   resource except that model ARN.

The stack does not mint, distribute, or rotate the bearer token. Keep credentials
out of the repository, command history, logs, and client bundles.

## Configuration

The CDK context in `cdk.json` is the default source for:

| Context key | Current default |
| --- | --- |
| `bedrockRegion` | `us-east-1` |
| `modelId` | `meta.llama3-70b-instruct-v1:0` |
| `invocationAlarmThreshold` | `100` |
| `outputTokenAlarmThreshold` | `200000` |

The region must match the region used by Core's Bedrock client and the model ARN
and CloudWatch metric dimensions. The repository's Core environment has used
`ca-central-1`, so inspect the actual production environment before deploying
rather than blindly accepting the CDK default.

Override context only after confirming model access in the target account/region:

```bash
npx cdk synth -c bedrockRegion=ca-central-1
npx cdk synth -c invocationAlarmThreshold=40 \
  -c outputTokenAlarmThreshold=80000
```

Thresholds must be positive numbers. Choose them with the application's rate and
spend controls; these alarms are fast tripwires, not AWS Budgets. AWS Budgets and
Cost Explorer are not part of this stack's trigger path.

## Development verification

From this directory:

```bash
npm install
npm run verify
```

`npm run verify` runs the synth assertions and the threshold unit tests. The synth
assertions verify the model ARN, the exact IAM statement shape, both CloudWatch
metrics, the alarm actions, the SNS topic, and the exported outputs.

Useful separate commands:

```bash
npm run build
npm run synth
npm run test
npm run diff
```

Do not run `cdk deploy` until the account, region, model access, thresholds,
credentials, and IAM replacement plan have been reviewed.

## Deployment

With AWS credentials configured for the intended account:

```bash
npx cdk bootstrap aws://ACCOUNT/REGION
npm run deploy
```

Supply the same region/model context used during verification if it differs from
`cdk.json`:

```bash
npx cdk deploy \
  -c bedrockRegion=REGION \
  -c modelId=MODEL_ID \
  -c invocationAlarmThreshold=INVOCATION_LIMIT \
  -c outputTokenAlarmThreshold=TOKEN_LIMIT
```

After deployment, record the CloudFormation stack name, account, region, model
ARN, threshold values, managed-policy ARN, and exported SNS topic ARN. Then attach
the managed policy in place of broad Bedrock access on the bearer-token IAM user.

## Post-deployment checks

Verify in AWS that:

- the managed policy has the three expected statements;
- the `NotResource` deny covers all other model resources;
- both alarms are in the intended region and use the configured `ModelId`;
- both alarms publish to the exported SNS topic;
- the intended mailbox/subscriber exists if notifications are required;
- a controlled test datapoint or approved test procedure reaches the SNS mailbox.

A synth pass proves the generated template, not AWS account permissions, model
access, alarm delivery, or application behavior. Do not claim the stack is live
until those account-level checks are recorded.

## Potential upgrades

These are future options, not current resources:

- attach a reviewed SNS subscriber or incident integration to the exported topic;
- add an automated circuit breaker that disables overflow after a confirmed alarm;
- reconcile alarm thresholds with the application's rate/spend controls;
- add deployment-time account/region/model-access checks;
- add a restore/runbook exercise for the alarm mailbox and policy replacement.

Any future circuit breaker must consume the existing SNS export rather than create a
second topic, and must be reviewed for failure modes before it can disable traffic.
