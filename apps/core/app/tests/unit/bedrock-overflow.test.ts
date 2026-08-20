// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CI unit jobs share Redis. checkRateLimit prefers Redis, and
// resetRateLimitsForTests() only clears the in-memory fallback, so leftover
// hits on the shared `bedrock-overflow` key exhaust the burst cap before this
// file's own test can take the first slot.
const limiterHits = vi.hoisted(() => new Map<string, number[]>());

vi.mock("~/lib/auth/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/auth/rate-limit.server")>();
  return {
    ...actual,
    checkRateLimit: async (key: string, limit: number, windowMs: number) => {
      if (limit <= 0) {
        return { limited: true, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
      }
      const now = Date.now();
      const hits = (limiterHits.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
      if (hits.length >= limit) {
        limiterHits.set(key, hits);
        return { limited: true, retryAfter: 1 };
      }
      hits.push(now);
      limiterHits.set(key, hits);
      return { limited: false, retryAfter: 0 };
    },
  };
});

import {
  defaultBedrockOverflowSettings,
  type BedrockOverflowSettings,
} from "~/lib/ai/routing/bedrock/bedrock-settings";
import {
  BEDROCK_OVERFLOW_SERVER_ID,
  DEFAULT_BEDROCK_MODEL_ID,
  enableBedrockOnSettings,
  isClientRequestedBedrockModel,
  tryActivateBedrockOverflow,
} from "~/lib/ai/routing/bedrock/overflow.server";

const ENV_KEYS = ["AWS_BEARER_TOKEN_BEDROCK", "BEDROCK_MODEL_ID"] as const;

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

function enabledSettings(
  overrides: Partial<BedrockOverflowSettings> = {},
): BedrockOverflowSettings {
  return {
    ...defaultBedrockOverflowSettings(),
    enabled: true,
    resourceLimit: 20,
    ...overrides,
  };
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
    limiterHits.clear();
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    delete process.env.BEDROCK_MODEL_ID;
  });

  afterEach(() => {
    restoreEnv();
    limiterHits.clear();
  });

  it("returns null when the bearer token is missing", async () => {
    await expect(tryActivateBedrockOverflow({ settings: enabledSettings() })).resolves.toBeNull();
  });

  it("returns null when AWS is still at the admin default of off / 0", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";
    await expect(
      tryActivateBedrockOverflow({ settings: defaultBedrockOverflowSettings() }),
    ).resolves.toBeNull();
  });

  it("returns null when enabled but every cap is 0", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";
    await expect(
      tryActivateBedrockOverflow({
        settings: { ...defaultBedrockOverflowSettings(), enabled: true },
      }),
    ).resolves.toBeNull();
  });

  it("returns the default Llama 3 model and aws-bedrock server id", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";

    await expect(tryActivateBedrockOverflow({ settings: enabledSettings() })).resolves.toEqual({
      resolvedModelId: `bedrock:${DEFAULT_BEDROCK_MODEL_ID}`,
      serverId: BEDROCK_OVERFLOW_SERVER_ID,
    });
  });

  it("honours BEDROCK_MODEL_ID when set", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";
    process.env.BEDROCK_MODEL_ID = "meta.llama3-8b-instruct-v1:0";

    const overflow = await tryActivateBedrockOverflow({
      settings: enabledSettings(),
    });
    expect(overflow?.resolvedModelId).toBe("bedrock:meta.llama3-8b-instruct-v1:0");
  });

  it("returns null once the burst cap is exhausted", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";
    const settings = enabledSettings({ resourceLimit: 1 });

    await expect(tryActivateBedrockOverflow({ settings })).resolves.not.toBeNull();
    await expect(tryActivateBedrockOverflow({ settings })).resolves.toBeNull();
  });

  it("enforces the daily per-user cap", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-token";
    const settings = enabledSettings({
      resourceLimit: 0,
      dailyUserLimit: 1,
    });

    await expect(
      tryActivateBedrockOverflow({ settings, userId: "user-1" }),
    ).resolves.not.toBeNull();
    await expect(tryActivateBedrockOverflow({ settings, userId: "user-1" })).resolves.toBeNull();
    await expect(
      tryActivateBedrockOverflow({ settings, userId: "user-2" }),
    ).resolves.not.toBeNull();
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
