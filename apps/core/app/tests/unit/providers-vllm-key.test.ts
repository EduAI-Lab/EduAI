// @vitest-environment node

import { describe, it, expect, afterEach } from "vitest";
import { resolveRegistryVllmApiKey } from "~/lib/ai/providers";
import { mergeLocalInferenceFromEnv } from "~/lib/ai/provider-types";

/**
 * #1568 — the deployment's internal vLLM/LiteLLM key must never be attached to a
 * client-supplied base URL (SSRF-to-loopback + internal secret disclosure). This
 * mirrors the Ollama block's client-base-URL header strip.
 */
describe("resolveRegistryVllmApiKey", () => {
  it("does NOT fall back to the internal key when the base URL is client-supplied", () => {
    expect(
      resolveRegistryVllmApiKey({
        clientBaseUrl: "http://127.0.0.1:9999/v1",
        userApiKey: undefined,
        internalKey: "internal-litellm-master-key",
      }),
    ).toBeUndefined();
  });

  it("uses the caller's own key with a client-supplied base URL, never the internal key", () => {
    expect(
      resolveRegistryVllmApiKey({
        clientBaseUrl: "http://127.0.0.1:9999/v1",
        userApiKey: "user-key",
        internalKey: "internal-litellm-master-key",
      }),
    ).toBe("user-key");
  });

  it("falls back to the internal key only for the deployment-configured endpoint (no client base URL)", () => {
    expect(
      resolveRegistryVllmApiKey({
        clientBaseUrl: undefined,
        userApiKey: undefined,
        internalKey: "internal-litellm-master-key",
      }),
    ).toBe("internal-litellm-master-key");
  });

  it("still prefers the caller's own key for the deployment endpoint when both exist", () => {
    expect(
      resolveRegistryVllmApiKey({
        clientBaseUrl: undefined,
        userApiKey: "user-key",
        internalKey: "internal-litellm-master-key",
      }),
    ).toBe("user-key");
  });
});

describe("mergeLocalInferenceFromEnv — vLLM base-URL provenance (#1568)", () => {
  const original = process.env.VLLM_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.VLLM_BASE_URL;
    else process.env.VLLM_BASE_URL = original;
  });

  it("marks an env-sourced base URL as deployment-trusted", () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu/v1";
    const merged = mergeLocalInferenceFromEnv({ vllm: { isEnabled: true } });
    expect(merged.vllm?.baseUrl).toBe("http://vllm.internal.example.edu/v1");
    expect(merged.vllm?.baseUrlIsEnvTrusted).toBe(true);
  });

  it("marks a DB/client-supplied base URL as NOT trusted (internal key withheld)", () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal.example.edu/v1";
    const merged = mergeLocalInferenceFromEnv({
      vllm: { isEnabled: true, baseUrl: "http://127.0.0.1:9999/v1" },
    });
    expect(merged.vllm?.baseUrl).toBe("http://127.0.0.1:9999/v1");
    expect(merged.vllm?.baseUrlIsEnvTrusted).toBe(false);
  });
});
