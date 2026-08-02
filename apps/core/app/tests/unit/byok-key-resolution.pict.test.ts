// PICT drift-contract adapter (#1182, census docs/PICT_CENSUS.md § S3): one committed
// row table (tests/models/byok-vs-platform-key-resolution.cases.json) and one
// spec-derived oracle assert local-inference baseUrl precedence (fleet > user > env
// for vLLM; user > env for Ollama) and vLLM apiKey source tags (user > platform >
// default) via mergeLocalInferenceFromEnv — never comparing secret values.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mergeLocalInferenceFromEnv } from "~/lib/ai/provider-types";
import byokKeyResolutionCases from "../../../../../tests/models/byok-vs-platform-key-resolution.cases.json";
import {
  byokKeyResolutionOracle,
  type ByokKeyResolutionRow,
} from "../../../../../tests/models/byok-vs-platform-key-resolution.oracle";

const rows = byokKeyResolutionCases as ByokKeyResolutionRow[];

const FLEET_URL = "http://fleet.example:8001";
const USER_URL = "http://user.example:8001";
const ENV_URL = "http://env.example:8001";
const USER_OLLAMA_URL = "http://user-ollama.example:11434";
const ENV_OLLAMA_URL = "http://env-ollama.example:11434";

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

function resolveKeyFromMerged(
  row: ByokKeyResolutionRow,
  merged: ReturnType<typeof mergeLocalInferenceFromEnv>,
): "user" | "platform" | "default" | "none" {
  if (row.Provider !== "vllm" || !merged.vllm?.isEnabled) {
    return "none";
  }
  const key =
    merged.vllm.apiKey || process.env.VLLM_API_KEY || "vllm-local";
  if (key === USER_API_KEY) return "user";
  if (key === PLATFORM_API_KEY) return "platform";
  return "default";
}

beforeEach(() => {
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
    it("matches the oracle baseUrl and key source tags via mergeLocalInferenceFromEnv", () => {
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
      expect(resolveKeyFromMerged(row, merged)).toBe(verdict.keySource);
    });
  },
);
