import { describe, expect, it } from "vitest";
import {
  parseModelIdentifier,
  PROVIDER_CONFIGS,
  providerConfigurationHint,
  type SupportedProvider,
} from "~/lib/ai/provider-types";

describe("OpenCode provider contract", () => {
  it("registers the dedicated provider and parses its namespaced model id", () => {
    expect(PROVIDER_CONFIGS.opencode).toMatchObject({
      id: "opencode",
      requiresApiKey: true,
      defaultBaseUrl: "https://opencode.ai/zen/go/v1",
    });
    expect(parseModelIdentifier("opencode:deepseek-v4-flash")).toEqual({
      providerId: "opencode" as SupportedProvider,
      modelId: "deepseek-v4-flash",
    });
  });

  it("directs cloud BYOK users to the calling app's settings instead of the server env file", () => {
    expect(providerConfigurationHint("opencode")).toContain("calling app's API-key settings");
    expect(providerConfigurationHint("opencode")).not.toContain(".env");
    expect(providerConfigurationHint("ollama")).toContain("OLLAMA_BASE_URL");
  });
});
