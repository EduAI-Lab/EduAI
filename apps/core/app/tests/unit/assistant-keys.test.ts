// @vitest-environment node
/**
 * #1818: the one decrypt helper, masked display, the shared key-resolution order
 * with its tier, and all five steps of the per-question provider/model choice —
 * including the key-less preference row and a preference whose provider an admin
 * has since disabled. Also the #1823 policy: no own key → admin catalogue only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encrypt } from "~/lib/canvas/encryption";
import {
  maskKey,
  plainKey,
  platformKeyFor,
  resetPlainKeyWarningsForTests,
  resolveProviderKey,
  type UserAiRow,
} from "~/lib/assistant/user-ai-keys.server";
import {
  chooseProviderAndModel,
  offeredModels,
  resolveRouterModel,
  type CatalogueProvider,
} from "~/lib/assistant/provider-choice.server";

const ENV_KEYS = [
  "ENCRYPTION_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "VLLM_BASE_URL",
  "OLLAMA_BASE_URL",
  "VLLM_FLEET_CHAT_URLS",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.ENCRYPTION_KEY = "test-encryption-key-for-assistant";
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.VLLM_BASE_URL;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.VLLM_FLEET_CHAT_URLS;
  resetPlainKeyWarningsForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
});

describe("plainKey — the only decrypt", () => {
  it("decrypts a stored key", () => {
    expect(plainKey({ id: "r1", apiKey: encrypt("sk-secret-value-1234") })).toBe(
      "sk-secret-value-1234",
    );
  });

  it("treats a blank or null column as no key", () => {
    expect(plainKey({ id: "r1", apiKey: null })).toBeNull();
    expect(plainKey({ id: "r1", apiKey: "   " })).toBeNull();
  });

  it("an undecryptable row reads as 'no key saved', logs once, and never logs key material", () => {
    const stored = encrypt("sk-will-not-decrypt-9999");
    process.env.ENCRYPTION_KEY = "a-rotated-app-key";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(plainKey({ id: "row-7", apiKey: stored })).toBeNull();
    expect(plainKey({ id: "row-7", apiKey: stored })).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("row-7");
    expect(logged).not.toContain(stored);
    expect(logged).not.toContain("9999");
  });
});

describe("maskKey", () => {
  it("shows the last 4 only when the key is at least 12 characters", () => {
    expect(maskKey("sk-abcdefgh1234")).toBe("••••••••1234");
    expect(maskKey("short-key")).toBe("••••••••");
    expect(maskKey(null)).toBeNull();
  });
});

describe("resolveProviderKey — pasted → saved → platform → none", () => {
  it("prefers a pasted key, then the saved key, then the platform key", () => {
    process.env.OPENAI_API_KEY = "sk-platform";
    expect(
      resolveProviderKey({ provider: "openai", pasted: "sk-pasted", saved: "sk-saved" }),
    ).toEqual({
      tier: "PASTED",
      apiKey: "sk-pasted",
    });
    expect(resolveProviderKey({ provider: "openai", pasted: "  ", saved: "sk-saved" })).toEqual({
      tier: "SAVED",
      apiKey: "sk-saved",
    });
    expect(resolveProviderKey({ provider: "openai", saved: null })).toEqual({
      tier: "PLATFORM",
      apiKey: "sk-platform",
    });
  });

  it("returns none when no tier resolves", () => {
    expect(resolveProviderKey({ provider: "openai", saved: null })).toBeNull();
    expect(resolveProviderKey({ provider: "opencode", saved: null })).toBeNull();
  });

  it("local inference has a keyless platform tier only when its endpoint is configured", () => {
    expect(platformKeyFor("vllm")).toBeNull();
    process.env.VLLM_BASE_URL = "http://localhost:8001";
    expect(platformKeyFor("vllm")).toEqual({ tier: "PLATFORM", apiKey: undefined });
  });
});

const catalogue: CatalogueProvider[] = [
  { name: "google", displayName: "Google AI", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
  { name: "openai", displayName: "OpenAI", models: ["gpt-4o-mini"] },
  { name: "opencode", displayName: "OpenCode", models: ["deepseek-v4-flash"] },
];

function row(overrides: Partial<UserAiRow> & { provider: string }): UserAiRow {
  return {
    id: `row-${overrides.provider}`,
    key: null,
    model: null,
    preferred: false,
    enabledModels: null,
    ...overrides,
  };
}

describe("chooseProviderAndModel — five steps", () => {
  it("1. the explicit preference wins, keeping its stored model", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-platform";
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [
        row({ provider: "openai", key: "sk-own" }),
        row({ provider: "google", preferred: true, model: "gemini-2.5-pro" }),
      ],
      defaultModel: "",
    });
    expect(choice).toMatchObject({
      provider: "google",
      model: "gemini-2.5-pro",
      step: "explicit_preference",
    });
  });

  it("1. a key-less preference row runs on the platform key", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-platform";
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [row({ provider: "google", preferred: true, model: "gemini-2.5-pro" })],
      defaultModel: "",
    });
    expect(choice).toMatchObject({
      provider: "google",
      step: "explicit_preference",
      key: { tier: "PLATFORM" },
    });
  });

  it("1. a stored model the provider no longer offers falls back to its first model", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-platform";
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [row({ provider: "google", preferred: true, model: "gemini-1.0-retired" })],
      defaultModel: "",
    });
    expect(choice).toMatchObject({ provider: "google", model: "gemini-2.5-flash" });
  });

  it("1→2. a preference whose provider an admin disabled falls through to the user's own key", () => {
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [
        row({ provider: "ollama", preferred: true, model: "llama3" }),
        row({ provider: "opencode", key: "oc-own" }),
      ],
      defaultModel: "",
    });
    expect(choice).toMatchObject({ provider: "opencode", step: "own_key", key: { tier: "SAVED" } });
  });

  it("2. a saved key is used before the platform pays — and a key-less row contributes nothing", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-platform";
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [
        row({ provider: "google", model: "gemini-2.5-pro" }),
        row({ provider: "openai", key: "sk-own" }),
      ],
      defaultModel: "",
    });
    expect(choice).toMatchObject({ provider: "openai", step: "own_key" });
  });

  it("3. the admin default applies when the user configured nothing", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-platform";
    process.env.OPENAI_API_KEY = "sk-platform";
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [],
      defaultModel: "openai:gpt-4o-mini",
    });
    expect(choice).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      step: "admin_default",
    });
  });

  it("3. a stale default model is replaced by that provider's own first model", () => {
    process.env.OPENAI_API_KEY = "sk-platform";
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [],
      defaultModel: "openai:gemini-2.5-flash",
    });
    expect(choice).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      step: "admin_default",
    });
  });

  it("4. otherwise the first provider in catalogue order where a key and a model resolve", () => {
    process.env.OPENAI_API_KEY = "sk-platform";
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [],
      defaultModel: "google:gemini-2.5-flash",
    });
    expect(choice).toMatchObject({ provider: "openai", step: "first_usable" });
  });

  it("5. nothing resolves → null (the caller reports no_key)", () => {
    expect(chooseProviderAndModel({ catalogue, rows: [], defaultModel: "" })).toBeNull();
  });
});

describe("offeredModels — the #1823 policy", () => {
  const openai = catalogue[1];

  it("a user WITHOUT a key of their own gets the admin catalogue only, whatever they curated", () => {
    const keyless = row({ provider: "openai", enabledModels: ["gpt-4.1-withheld"] });
    expect(offeredModels(openai, keyless)).toEqual(["gpt-4o-mini"]);
  });

  it("a user WITH their own key may also run models they enabled", () => {
    const keyed = row({ provider: "openai", key: "sk-own", enabledModels: ["gpt-4.1-withheld"] });
    expect(offeredModels(openai, keyed)).toEqual(["gpt-4o-mini", "gpt-4.1-withheld"]);
  });

  it("a key-less user cannot be handed a withheld model even as their explicit preference", () => {
    process.env.OPENAI_API_KEY = "sk-platform";
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [
        row({
          provider: "openai",
          preferred: true,
          model: "gpt-4.1-withheld",
          enabledModels: ["gpt-4.1-withheld"],
        }),
      ],
      defaultModel: "",
    });
    expect(choice).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      key: { tier: "PLATFORM" },
    });
  });
});

describe("resolveRouterModel", () => {
  it("uses the router model only when it belongs to the chosen provider", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-platform";
    const choice = chooseProviderAndModel({
      catalogue,
      rows: [],
      defaultModel: "google:gemini-2.5-pro",
    });
    if (!choice) throw new Error("expected a choice");
    expect(
      resolveRouterModel({ choice, catalogue, rows: [], routerModel: "google:gemini-2.5-flash" }),
    ).toBe("gemini-2.5-flash");
    expect(
      resolveRouterModel({ choice, catalogue, rows: [], routerModel: "openai:gpt-4o-mini" }),
    ).toBe("gemini-2.5-pro");
    expect(
      resolveRouterModel({ choice, catalogue, rows: [], routerModel: "google:not-offered" }),
    ).toBe("gemini-2.5-pro");
    expect(resolveRouterModel({ choice, catalogue, rows: [], routerModel: "" })).toBe(
      "gemini-2.5-pro",
    );
  });
});
