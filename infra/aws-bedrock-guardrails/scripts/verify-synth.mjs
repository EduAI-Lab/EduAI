#!/usr/bin/env node
/**
 * Assert cdk synth output matches #1619: two Bedrock Invoke* actions,
 * one model ARN, CloudWatch alarms, SNS topic export for #1620.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
// Expected ARN comes from cdk.json context, not a second hardcoded region,
// so changing the default region cannot silently desync this check.
const cdkJson = JSON.parse(readFileSync(join(root, "cdk.json"), "utf8"));
const ctx = cdkJson.context ?? {};
const region = ctx.bedrockRegion;
const modelId = ctx.modelId;
if (typeof region !== "string" || !region) {
  console.error("verify-synth failed: cdk.json context.bedrockRegion missing");
  process.exit(1);
}
if (typeof modelId !== "string" || !modelId) {
  console.error("verify-synth failed: cdk.json context.modelId missing");
  process.exit(1);
}
const MODEL_ARN = `arn:aws:bedrock:${region}::foundation-model/${modelId}`;
const ACTIONS = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"];

const synth = spawnSync("npx", ["--no-install", "cdk", "synth", "--quiet"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, CDK_DEFAULT_ACCOUNT: "123456789012" },
});
if (synth.status !== 0) {
  console.error(synth.stdout);
  console.error(synth.stderr);
  process.exit(synth.status ?? 1);
}

const outDir = join(root, "cdk.out");
const templateName = readdirSync(outDir).find(
  (f) => f.endsWith(".template.json") && f.includes("EduaiBedrockGuardrails"),
);
if (!templateName) {
  console.error("No EduaiBedrockGuardrails template in cdk.out");
  process.exit(1);
}

const tpl = JSON.parse(readFileSync(join(outDir, templateName), "utf8"));
const resources = tpl.Resources ?? {};
const outputs = tpl.Outputs ?? {};

function fail(msg) {
  console.error("verify-synth failed:", msg);
  process.exit(1);
}

const policies = Object.values(resources).filter((r) => r.Type === "AWS::IAM::ManagedPolicy");
if (policies.length !== 1) {
  fail(`expected 1 ManagedPolicy, got ${policies.length}`);
}

const doc = policies[0].Properties.PolicyDocument;
const statements = doc.Statement;
if (!Array.isArray(statements) || statements.length !== 1) {
  fail("expected exactly one IAM statement");
}
const stmt = statements[0];
const actions = [...(stmt.Action ?? [])].sort();
if (JSON.stringify(actions) !== JSON.stringify([...ACTIONS].sort())) {
  fail(`IAM actions were ${JSON.stringify(actions)}`);
}
const resourcesAllowed = stmt.Resource;
const resourceList = Array.isArray(resourcesAllowed) ? resourcesAllowed : [resourcesAllowed];
if (resourceList.length !== 1 || resourceList[0] !== MODEL_ARN) {
  fail(`IAM resource was ${JSON.stringify(resourcesAllowed)}`);
}
if (stmt.Effect !== "Allow") fail("IAM effect must be Allow");

const extraActions = actions.filter((a) => !ACTIONS.includes(a));
if (extraActions.length) {
  fail(`extra Bedrock actions: ${extraActions.join(", ")}`);
}

const alarms = Object.values(resources).filter((r) => r.Type === "AWS::CloudWatch::Alarm");
if (alarms.length !== 2) {
  fail(`expected 2 CloudWatch alarms, got ${alarms.length}`);
}
function alarmMetrics(alarm) {
  const props = alarm.Properties;
  if (props.Namespace && props.MetricName) {
    return [{ namespace: props.Namespace, metricName: props.MetricName }];
  }
  return (props.Metrics ?? [])
    .map((m) => m.MetricStat?.Metric)
    .filter(Boolean)
    .map((m) => ({ namespace: m.Namespace, metricName: m.MetricName }));
}

const seenMetrics = new Set();
for (const alarm of alarms) {
  const metrics = alarmMetrics(alarm);
  if (!metrics.length) fail(`alarm ${alarm.Properties.AlarmName} has no metric`);
  for (const m of metrics) {
    if (m.namespace !== "AWS/Bedrock") fail(`alarm namespace ${m.namespace}`);
    if (!["Invocations", "OutputTokenCount"].includes(m.metricName)) {
      fail(`unexpected metric ${m.metricName}`);
    }
    seenMetrics.add(m.metricName);
  }
  const actionsArn = alarm.Properties.AlarmActions;
  if (!actionsArn || actionsArn.length < 1) {
    fail(`alarm ${alarm.Properties.AlarmName} has no AlarmActions`);
  }
}
if (!seenMetrics.has("Invocations") || !seenMetrics.has("OutputTokenCount")) {
  fail(`alarms missing a required metric: ${[...seenMetrics].join(", ")}`);
}

const topics = Object.values(resources).filter((r) => r.Type === "AWS::SNS::Topic");
if (topics.length !== 1) {
  fail(`expected 1 SNS topic, got ${topics.length}`);
}

const snsOut = outputs.BedrockGuardrailSnsTopicArn;
if (!snsOut) fail("missing output BedrockGuardrailSnsTopicArn");
if (snsOut.Export?.Name !== "EduaiBedrockGuardrailSnsTopicArn") {
  fail("SNS output must export EduaiBedrockGuardrailSnsTopicArn for #1620");
}

if (!outputs.BedrockInvokePolicyArn) fail("missing BedrockInvokePolicyArn");
if (outputs.BedrockModelArn?.Value !== MODEL_ARN) {
  fail("BedrockModelArn output does not match the locked model ARN");
}

console.log("verify-synth ok");
console.log("  policy actions:", actions.join(", "));
console.log("  model ARN:", MODEL_ARN);
console.log("  alarms:", alarms.length, "SNS topics:", topics.length);
console.log("  export:", snsOut.Export.Name);
