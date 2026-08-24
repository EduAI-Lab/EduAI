# AWS Bedrock overflow guardrails (#1619)

Least-privilege IAM + a CloudWatch usage tripwire + an SNS topic for the
#1620 Lambda circuit breaker. **No EduAI runtime change. No Lambda in this
stack.**

Follow-up to #1441 / #1527 / #1547. Spend/rate caps still live in app code
(Redis + Postgres). This stack is the AWS-side statement of *what the bearer
token may call* and a fast alarm when Bedrock usage spikes — AWS Budgets lag
8–24h, so they are not the primary trigger (and are out of scope here).

## What it creates

| Resource | Purpose |
| --- | --- |
| IAM managed policy `EduaiBedrockLlama370bInvokeOnly` | `bedrock:InvokeModel` + `bedrock:InvokeModelWithResponseStream` on **one** model ARN |
| SNS topic `eduai-bedrock-overflow-alarm` | Alarm destination. **Exported** as `EduaiBedrockGuardrailSnsTopicArn` — #1620 must subscribe, not recreate |
| CloudWatch alarm on `AWS/Bedrock` `Invocations` | 5-minute Sum tripwire |
| CloudWatch alarm on `AWS/Bedrock` `OutputTokenCount` | 5-minute Sum tripwire (spend proxy) |

Attach the managed policy to the IAM identity that owns
`AWS_BEARER_TOKEN_BEDROCK`. This stack does not mint or rotate that token.

## Region (confirm before deploy)

Issue text locks **`us-east-1`** and model
`meta.llama3-70b-instruct-v1:0`. Override only after you have confirmed
Llama 3 70B on-demand access in that account/region (console, not code):

```bash
npx cdk synth -c bedrockRegion=us-east-1
```

This checkout’s Core `.env` currently sets `BEDROCK_REGION=ca-central-1`.
If that is the live invocation region, synth/deploy with
`-c bedrockRegion=ca-central-1` so the IAM ARN and the metric dimensions
match traffic. Do not deploy `us-east-1` against a `ca-central-1` key.

## Thresholds

Defaults in `cdk.json` (tune to the admin caps from #1547):

- `invocationAlarmThreshold` — Sum of Invocations in 5 minutes (default `100`)
- `outputTokenAlarmThreshold` — Sum of OutputTokenCount in 5 minutes (default `200000`)

```bash
npx cdk synth \
  -c invocationAlarmThreshold=40 \
  -c outputTokenAlarmThreshold=80000
```

## Commands

From this directory:

```bash
npm install
npm run verify    # cdk synth + template assertions (ARN from cdk.json) + threshold unit tests
```

Deploy is **not** required to close the code half of this issue. When the
account/region is confirmed:

```bash
npx cdk bootstrap aws://ACCOUNT/REGION
npx cdk deploy
```

Live alarm check (after deploy): put a datapoint over the threshold and
confirm SNS receives the notification. That step needs AWS credentials and
is not run in CI.

## Out of scope

- Lambda that disables overflow (#1620)
- Any change under `apps/core`
- AWS Budgets / Cost Explorer as the primary trigger
