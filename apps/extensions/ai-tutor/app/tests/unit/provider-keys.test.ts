/**
 * Covers the BYOK-as-fallback helpers added for #1645:
 *   - `providerRequiresByokKey`: BYOK providers (google/openai/opencode) need a
 *     student key; UBC-hosted providers (vllm/ollama) and unknown providers do
 *     not, because the server key covers them.
 *   - `byokModelsForHeldKeys`: surfaces exactly the BYOK models for the
 *     provider keys the student currently holds (used to merge into the picker).
 */
import { describe, expect, it } from "vitest";
import {
  byokModelsForHeldKeys,
  BYOK_PROVIDER_MODELS,
  providerRequiresByokKey,
} from "~/lib/provider-keys";

describe("providerRequiresByokKey (#1645)", () => {
  it("requires a key for BYOK providers", () => {
    expect(providerRequiresByokKey("google")).toBe(true);
    expect(providerRequiresByokKey("openai")).toBe(true);
    expect(providerRequiresByokKey("opencode")).toBe(true);
  });

  it("does not require a key for UBC-hosted or unknown providers", () => {
    expect(providerRequiresByokKey("vllm")).toBe(false);
    expect(providerRequiresByokKey("ollama")).toBe(false);
    expect(providerRequiresByokKey("")).toBe(false);
    expect(providerRequiresByokKey("mystery")).toBe(false);
  });
});

describe("byokModelsForHeldKeys (#1645)", () => {
  it("returns only models for providers the student holds a key for", () => {
    const models = byokModelsForHeldKeys(["openai"]);
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.provider === "openai")).toBe(true);
    expect(models.map((model) => model.modelId)).toContain("openai:gpt-4o-mini");
  });

  it("accepts a Set and merges multiple providers", () => {
    const models = byokModelsForHeldKeys(new Set(["google", "opencode"]));
    const providers = new Set(models.map((model) => model.provider));
    expect(providers).toEqual(new Set(["google", "opencode"]));
  });

  it("returns nothing when no keys are held", () => {
    expect(byokModelsForHeldKeys([])).toEqual([]);
  });

  it("lists only providers that require a BYOK key", () => {
    for (const model of BYOK_PROVIDER_MODELS) {
      expect(providerRequiresByokKey(model.provider)).toBe(true);
    }
  });
});
