import { describe, expect, it, vi } from "vitest";
import { AiProviderKeySchema } from "../../../shared/schemas/aiProviderKey.js";
import {
  validateProviderKey,
  OPENCODE_VALIDATION_MODEL,
} from "../../src/services/aiProviderKeyValidation.js";

describe("AiProviderKeySchema", () => {
  it("accepts a bounded OpenCode provider key payload", () => {
    const result = AiProviderKeySchema.safeParse({
      provider: "opencode",
      apiKey: "opencode-secret",
    });

    expect(result.success).toBe(true);
  });

  it("rejects missing and oversized key fields", () => {
    expect(AiProviderKeySchema.safeParse({ provider: "opencode" }).success).toBe(false);
    expect(
      AiProviderKeySchema.safeParse({ provider: "opencode", apiKey: "k".repeat(513) }).success,
    ).toBe(false);
  });
});

describe("validateProviderKey", () => {
  it("uses the fixed OpenCode chat probe and forwards the key only as Bearer auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const result = await validateProviderKey({
      provider: "opencode",
      apiKey: "opencode-secret",
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(result).toEqual({ valid: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(String(url)).not.toContain("opencode-secret");
    expect(options.headers).toMatchObject({ Authorization: "Bearer opencode-secret" });
    expect(JSON.parse(options.body)).toMatchObject({
      model: OPENCODE_VALIDATION_MODEL,
      max_tokens: 1,
      stream: false,
    });
  });

  it("returns a provider error without throwing for an OpenCode 401 response", async () => {
    const result = await validateProviderKey({
      provider: "opencode",
      apiKey: "bad-key",
      signal: new AbortController().signal,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Unauthorized" } }),
      }),
    });

    expect(result).toEqual({ valid: false, error: "Unauthorized" });
  });

  it("bubbles network failures for the route to map to its generic 500 response", async () => {
    await expect(
      validateProviderKey({
        provider: "opencode",
        apiKey: "network-key",
        signal: new AbortController().signal,
        fetchImpl: vi.fn().mockRejectedValue(new Error("network down")),
      }),
    ).rejects.toThrow("network down");
  });

  it("bubbles abort failures for the route to map to its timeout 504 response", async () => {
    const controller = new AbortController();
    const pending = validateProviderKey({
      provider: "opencode",
      apiKey: "timeout-key",
      signal: controller.signal,
      fetchImpl: vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(options.signal.reason), {
              once: true,
            });
          }),
      ),
    });

    controller.abort(new Error("timed out"));
    await expect(pending).rejects.toThrow("timed out");
  });
});
