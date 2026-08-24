#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BedrockGuardrailsStack } from "../lib/bedrock-guardrails-stack";
import { requirePositiveThreshold } from "../lib/thresholds";

const app = new cdk.App();

const bedrockRegion =
  (app.node.tryGetContext("bedrockRegion") as string | undefined) ?? "us-east-1";
const modelId =
  (app.node.tryGetContext("modelId") as string | undefined) ?? "meta.llama3-70b-instruct-v1:0";
const invocationAlarmThreshold = requirePositiveThreshold(
  "invocationAlarmThreshold",
  app.node.tryGetContext("invocationAlarmThreshold") ?? 100,
);
const outputTokenAlarmThreshold = requirePositiveThreshold(
  "outputTokenAlarmThreshold",
  app.node.tryGetContext("outputTokenAlarmThreshold") ?? 200_000,
);

new BedrockGuardrailsStack(app, "EduaiBedrockGuardrails", {
  description:
    "EduAI Bedrock overflow guardrails: least-privilege IAM, CloudWatch tripwire, SNS topic for #1620",
  env: {
    region: bedrockRegion,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  bedrockRegion,
  modelId,
  invocationAlarmThreshold,
  outputTokenAlarmThreshold,
});
