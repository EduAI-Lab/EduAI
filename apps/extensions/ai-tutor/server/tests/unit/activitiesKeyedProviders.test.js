/**
 * #1645: the chat route derives the set of providers a request actually holds a
 * key for and passes it to `resolveTutorModelSelection`, so a BYOK model the
 * picker surfaced is authorized at send time instead of 403'd. This covers that
 * derivation (`collectKeyedProviders`) — the gate logic it feeds is covered in
 * aiModelPolicy.async.test.js. Fails closed: a keyless request keys nothing.
 */
import { describe, it, expect } from "vitest";
import { collectKeyedProviders } from "../../src/routes/activities.js";

describe("collectKeyedProviders (#1645)", () => {
  it("collects every provider in the apiKeys map that holds a non-empty secret", () => {
    const providers = collectKeyedProviders({
      apiKeys: { openai: "sk-openai", google: "sk-google", opencode: "   " },
    });
    expect([...providers].sort()).toEqual(["google", "openai"]);
  });

  it("adds the selected model's provider from a legacy single apiKey", () => {
    const providers = collectKeyedProviders({
      modelId: "openai:gpt-4o-mini",
      apiKey: "sk-openai",
    });
    expect(providers.has("openai")).toBe(true);
  });

  it("unions the map and the legacy key, ignoring a blank legacy key", () => {
    const providers = collectKeyedProviders({
      modelId: "openai:gpt-4o-mini",
      apiKey: "  ",
      apiKeys: { google: "sk-google" },
    });
    expect([...providers].sort()).toEqual(["google"]);
  });

  it("accepts the object-shaped apiKeys value ({ apiKey }) as well as a bare string", () => {
    const providers = collectKeyedProviders({
      apiKeys: { openai: { apiKey: "sk-openai" }, google: { apiKey: "" } },
    });
    expect([...providers].sort()).toEqual(["openai"]);
  });

  it("keys nothing for a keyless request, so BYOK admission fails closed", () => {
    expect(collectKeyedProviders({ modelId: "vllm:llama-3" }).size).toBe(0);
    expect(collectKeyedProviders({}).size).toBe(0);
    expect(collectKeyedProviders(null).size).toBe(0);
  });
});
