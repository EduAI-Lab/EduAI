// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimitsForTests } from "~/lib/auth/rate-limit.server";
import {
  BEDROCK_OVERFLOW_SERVER_ID,
  DEFAULT_BEDROCK_MODEL_ID,
  enableBedrockOnSettings,
  isClientRequestedBedrockModel,
  tryActivateBedrockOverflow,
} from "~/lib/ai/routing/bedrock/overflow.server";

const ENV_KEYS = [
  "AWS_BEARER_TOKEN_BEDROCK",
  "BEDROCK_MODEL_ID",
  "BEDROCK_RATE_LIMIT",
  "BEDROCK_RATE_WINDOW_MS",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function stashEnv() {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
}
function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

describe("isClientRequestedBedrockModel", () => {
  it("rejects a bedrock: prefix regardless of case", () => {
    expect(isClientRequestedBedrockModel("bedrock:meta.llama3-70b-instruct-v1:0")).toBe(true);
    expect(isClientRequestedBedrockModel("Bedrock:foo")).toBe(true);
  });

  it("allows local and cloud model ids", () => {
    expect(isClientRequestedBedrockModel("vllm:qwen2.5-7b-instruct")).toBe(false);
    expect(isClientRequestedBedrockModel("openai:gpt-4o")).toBe(false);
    expect(isClientRequestedBedrockModel(undefined)).toBe(false);
  });
});

describe("tryActivateBedrockOverflow", () => {
  stashEnv();

  beforeEach(() => {
    restoreEnv();
    resetRateLimitsForTests();
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    delete process.env.BEDROCK_MODEL_ID;
    delete process.env.BEDROCK_RATE_LIMIT;
    delete process.env.BEDROCK_RATE_WINDOW_MS;
  });

  afterEach(() => {
    restoreEnv();
    resetRateLimitsForTests();
  });

  it("returns null when the bearer token is missing", () => {
    expect(tryActivateBedrockOverflow()).toBeNull();
  });

  it("returns the default Llama 3 model and aws-bedrock server id", () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";

    expect(tryActivateBedrockOverflow()).toEqual({
      resolvedModelId: `bedrock:${DEFAULT_BEDROCK_MODEL_ID}`,
      serverId: BEDROCK_OVERFLOW_SERVER_ID,
    });
  });

  it("honours BEDROCK_MODEL_ID when set", () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";
    process.env.BEDROCK_MODEL_ID = "meta.llama3-8b-instruct-v1:0";

    expect(tryActivateBedrockOverflow()?.resolvedModelId).toBe(
      "bedrock:meta.llama3-8b-instruct-v1:0",
    );
  });

  it("returns null once the global rate cap is exhausted", () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";
    process.env.BEDROCK_RATE_LIMIT = "1";
    process.env.BEDROCK_RATE_WINDOW_MS = "60000";

    expect(tryActivateBedrockOverflow()).not.toBeNull();
    expect(tryActivateBedrockOverflow()).toBeNull();
  });
});

describe("enableBedrockOnSettings", () => {
  it("enables bedrock without copying a client apiKey or baseUrl", () => {
    const next = enableBedrockOnSettings({
      vllm: { isEnabled: true, baseUrl: "http://cmps01.ok.ubc.ca:8001" },
      bedrock: { isEnabled: false, apiKey: "client-key", baseUrl: "https://evil.example" },
    });

    expect(next.bedrock).toEqual({ isEnabled: true });
    expect(next.vllm?.isEnabled).toBe(true);
  });
});
