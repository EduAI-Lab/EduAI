// @vitest-environment node
//
// PICT drift-contract adapter (#1182, census docs/PICT_CENSUS.md § S3): one committed
// row table (tests/models/byok-vs-platform-key-resolution.cases.json) and one
// spec-derived oracle assert local-inference baseUrl precedence (fleet > user > env
// for vLLM; user > env for Ollama) and vLLM apiKey source tags (user > platform >
// default) via mergeLocalInferenceFromEnv + createAIProviderRegistry — never
// comparing secret values.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { createOpenAIMock, createOllamaMock } = vi.hoisted(() => ({
  createOpenAIMock: vi.fn((_opts: Record<string, unknown>) => vi.fn()),
  createOllamaMock: vi.fn((_opts: Record<string, unknown>) => vi.fn()),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (opts: Record<string, unknown>) => createOpenAIMock(opts),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => vi.fn(),
}));

vi.mock("ollama-ai-provider", () => ({
  createOllama: (opts: Record<string, unknown>) => createOllamaMock(opts),
}));

vi.mock("ai", () => ({
  createProviderRegistry: (providers: unknown) => ({ __providers: providers }),
}));

import {
  createAIProviderRegistry,
  mergeLocalInferenceFromEnv,
} from "~/lib/ai/providers";
import byokKeyResolutionCases from "../../../../../tests/models/byok-vs-platform-key-resolution.cases.json";
import {
  byokKeyResolutionOracle,
  type ByokKeyResolutionRow,
} from "../../../../../tests/models/byok-vs-platform-key-resolution.oracle";

const rows = byokKeyResolutionCases as ByokKeyResolutionRow[];

// Loopback hosts pass the registry SSRF allow-list (see providers-ssrf.server.test.ts).
const FLEET_URL = "http://127.0.0.1:8001";
const USER_URL = "http://127.0.0.1:8002";
const ENV_URL = "http://127.0.0.1:8003";
const USER_OLLAMA_URL = "http://127.0.0.1:11434";
const ENV_OLLAMA_URL = "http://127.0.0.1:11435";

const USER_API_KEY = "user-byok-key";
const PLATFORM_API_KEY = "platform-env-key";

const ORIGINAL_ENV = {
  VLLM_BASE_URL: process.env.VLLM_BASE_URL,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  VLLM_API_KEY: process.env.VLLM_API_KEY,
};

function urlForSource(
  row: ByokKeyResolutionRow,
  source: ReturnType<typeof byokKeyResolutionOracle>["baseUrlSource"],
): string | undefined {
  switch (source) {
    case "fleet":
      return FLEET_URL;
    case "user":
      return row.Provider === "ollama" ? USER_OLLAMA_URL : USER_URL;
    case "env":
      return row.Provider === "ollama" ? ENV_OLLAMA_URL : ENV_URL;
    default:
      return undefined;
  }
}

function configureEnv(row: ByokKeyResolutionRow) {
  delete process.env.VLLM_BASE_URL;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.VLLM_API_KEY;

  if (row.EnvBaseUrl === "set") {
    if (row.Provider === "ollama") {
      process.env.OLLAMA_BASE_URL = ENV_OLLAMA_URL;
    } else {
      process.env.VLLM_BASE_URL = ENV_URL;
    }
  }

  if (row.PlatformKey === "set") {
    process.env.VLLM_API_KEY = PLATFORM_API_KEY;
  }
}

function buildUserSettings(row: ByokKeyResolutionRow) {
  const settings: Parameters<typeof mergeLocalInferenceFromEnv>[0] = {
    [row.Provider]: { isEnabled: false },
  };

  if (row.UserBaseUrl === "set") {
    settings[row.Provider] = {
      ...settings[row.Provider],
      baseUrl: row.Provider === "ollama" ? USER_OLLAMA_URL : USER_URL,
    };
  }

  if (row.Provider === "vllm" && row.UserApiKey === "set") {
    settings.vllm = {
      ...settings.vllm,
      isEnabled: false,
      apiKey: USER_API_KEY,
    };
  }

  return settings;
}

function keySourceFromRegistryCall(
  row: ByokKeyResolutionRow,
  enabled: boolean,
): "user" | "platform" | "default" | "none" {
  if (row.Provider !== "vllm" || !enabled) {
    return "none";
  }
  const call = createOpenAIMock.mock.calls.find(
    ([opts]) => typeof opts?.baseURL === "string" && String(opts.baseURL).includes("/v1"),
  );
  const key = call?.[0]?.apiKey;
  if (key === USER_API_KEY) return "user";
  if (key === PLATFORM_API_KEY) return "platform";
  if (key === "vllm-local") return "default";
  return "none";
}

beforeEach(() => {
  createOpenAIMock.mockClear();
  createOllamaMock.mockClear();
  configureEnv(rows[0]);
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key as keyof typeof ORIGINAL_ENV];
    else process.env[key as keyof typeof ORIGINAL_ENV] = value;
  }
});

describe.each(rows.map((row, index) => ({ row, index })))(
  "byok-vs-platform-key-resolution PICT row #$index $row.Provider/$row.FleetBaseUrl/$row.UserBaseUrl/$row.EnvBaseUrl",
  ({ row }) => {
    it("matches the oracle baseUrl and key source tags via merge + createAIProviderRegistry", () => {
      configureEnv(row);
      const verdict = byokKeyResolutionOracle(row);
      const modelId = row.Provider === "vllm" ? "vllm:qwen2.5-7b-instruct" : "ollama:qwen2.5:7b";
      const fleetOverride = row.FleetBaseUrl === "set" ? FLEET_URL : undefined;

      const merged = mergeLocalInferenceFromEnv(
        buildUserSettings(row),
        modelId,
        fleetOverride,
      );

      const providerConfig = merged[row.Provider];
      expect(Boolean(providerConfig?.isEnabled)).toBe(verdict.enabled);

      if (!verdict.enabled) {
        expect(verdict.baseUrlSource).toBe("none");
        expect(verdict.keySource).toBe("none");
        return;
      }

      expect(providerConfig?.baseUrl).toBe(urlForSource(row, verdict.baseUrlSource));

      createAIProviderRegistry(merged);

      if (row.Provider === "vllm") {
        expect(keySourceFromRegistryCall(row, true)).toBe(verdict.keySource);
      } else {
        expect(createOllamaMock).toHaveBeenCalled();
        expect(verdict.keySource).toBe("none");
      }
    });
  },
);
