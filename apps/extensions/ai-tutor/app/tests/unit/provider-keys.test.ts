/**
 * Covers the BYOK-as-fallback gate added for #1645:
 *   - `providerRequiresByokKey`: BYOK providers (google/openai/opencode) need a
 *     student key; UBC-hosted providers (vllm/ollama) and unknown providers do
 *     not, because the server key covers them. This is what lets the composer
 *     send keylessly for a UBC-hosted model (facet 1) instead of demanding a
 *     personal key up front.
 */
import { describe, expect, it } from "vitest";
import { providerRequiresByokKey } from "~/lib/provider-keys";

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
