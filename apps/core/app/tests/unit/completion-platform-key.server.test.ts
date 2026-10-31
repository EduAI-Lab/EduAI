// @vitest-environment node
// #1899 — `/api/completion` (AI Tutor's study buddy) must use the keys Core
// already holds: the request's key, then the user's saved key, then the
// deployment's own key. Before this, a student with no key of their own was
// refused even when Core had a platform key for the provider.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/ai/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/ai/providers")>();
  return {
    ...actual,
    createAIProviderRegistry: vi.fn(() => {
      throw new Error("registry stop");
    }),
  };
});

vi.mock("~/lib/ai/providers.server", () => ({
  resolveActiveChatModel: vi.fn(),
}));

vi.mock("~/lib/user-provider-settings.server", () => ({
  getUserProviderSettings: vi.fn(),
}));

import { runCompletion } from "~/lib/ai/completion.server";
import { createAIProviderRegistry } from "~/lib/ai/providers";
import { resolveActiveChatModel } from "~/lib/ai/providers.server";
import { getUserProviderSettings } from "~/lib/user-provider-settings.server";

type ProviderSettings = { apiKey?: string; isEnabled?: boolean };

function completion(apiKeys: Record<string, ProviderSettings> = {}) {
  return runCompletion({
    model: "google:gemini-2.5-flash",
    // SAFETY: `runCompletion` re-parses this with `clientApiKeysBodySchema`, which
    // accepts `isEnabled`; the narrower `CompletionApiKeys` type omits it.
    apiKeys: apiKeys as never,
    userId: "student-1",
    systemPrompt: "You are a tutor.",
    messages: [{ role: "user", content: "Hint please" }],
  });
}

/** The provider settings `runCompletion` built the model registry from. */
function registrySettings() {
  expect(createAIProviderRegistry).toHaveBeenCalledTimes(1);
  return vi.mocked(createAIProviderRegistry).mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveActiveChatModel).mockResolvedValue({
    name: "Gemini 2.5 Flash",
    supportsTools: false,
    supportsImages: false,
    maxTokens: 8192,
  });
  vi.mocked(getUserProviderSettings).mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runCompletion key order (#1899)", () => {
  it("uses the deployment key when the student holds none", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "platform-key");

    await completion();

    expect(registrySettings().google).toMatchObject({
      apiKey: "platform-key",
      isEnabled: true,
    });
  });

  it("still refuses when neither the student nor Core has a key", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");

    const result = await completion();

    expect(result).toMatchObject({ ok: false, code: "INVALID_PROVIDER_CONFIG" });
    expect(createAIProviderRegistry).not.toHaveBeenCalled();
  });

  it("prefers the student's saved key over the deployment key", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "platform-key");
    vi.mocked(getUserProviderSettings).mockResolvedValue({
      google: { apiKey: "saved-key", isEnabled: true },
    });

    await completion({ google: { isEnabled: true } });

    expect(registrySettings().google?.apiKey).toBe("saved-key");
  });

  it("prefers a key sent with the request over the deployment key", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "platform-key");

    await completion({ google: { apiKey: "pasted-key", isEnabled: true } });

    expect(registrySettings().google?.apiKey).toBe("pasted-key");
  });

  it("does not re-enable a provider the caller explicitly disabled", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "platform-key");

    const result = await completion({ google: { isEnabled: false } });

    expect(result).toMatchObject({ ok: false, code: "INVALID_PROVIDER_CONFIG" });
    expect(createAIProviderRegistry).not.toHaveBeenCalled();
  });
});
