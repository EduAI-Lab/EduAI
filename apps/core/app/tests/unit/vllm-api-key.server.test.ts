// @vitest-environment node

import { describe, it, expect } from "vitest";
import { resolveVllmApiKey } from "~/lib/ai/vllm-api-key.server";

describe("resolveVllmApiKey (#1115)", () => {
  it("prefers an explicit VLLM_API_KEY", () => {
    expect(
      resolveVllmApiKey({ VLLM_API_KEY: " real-secret ", NODE_ENV: "production" }),
    ).toBe("real-secret");
  });

  it("never falls back to vllm-local in production", () => {
    expect(resolveVllmApiKey({ NODE_ENV: "production" })).toBeUndefined();
    expect(
      resolveVllmApiKey({ VLLM_API_KEY: "  ", NODE_ENV: "production" }),
    ).toBeUndefined();
  });

  it("allows the documented local default outside production", () => {
    expect(resolveVllmApiKey({ NODE_ENV: "development" })).toBe("vllm-local");
    expect(resolveVllmApiKey({ NODE_ENV: "test" })).toBe("vllm-local");
    expect(resolveVllmApiKey({})).toBe("vllm-local");
  });

  it("never falls back to vllm-local once VLLM_BASE_URL points at a non-loopback host, even outside production", () => {
    // s378 intentionally runs NODE_ENV=development (docs/DEPLOYMENT.md) but
    // points VLLM_BASE_URL at cmps01 — this is the guard that has to fire there.
    expect(
      resolveVllmApiKey({
        NODE_ENV: "development",
        VLLM_BASE_URL: "http://cmps01.ok.ubc.ca:8001",
      }),
    ).toBeUndefined();
    expect(
      resolveVllmApiKey({ NODE_ENV: "development", VLLM_BASE_URL: "  " }),
    ).toBe("vllm-local");
  });

  it("still allows the local default when VLLM_BASE_URL points at loopback", () => {
    // Laptop/CI workflows pointing at a local vLLM/LiteLLM on a non-default
    // port must keep working — only a real, non-loopback host disables this.
    expect(
      resolveVllmApiKey({ NODE_ENV: "development", VLLM_BASE_URL: "http://localhost:8001" }),
    ).toBe("vllm-local");
    expect(
      resolveVllmApiKey({ NODE_ENV: "test", VLLM_BASE_URL: "http://127.0.0.1:8001" }),
    ).toBe("vllm-local");
  });

  it("treats a malformed VLLM_BASE_URL as not configured rather than throwing", () => {
    expect(
      resolveVllmApiKey({ NODE_ENV: "development", VLLM_BASE_URL: "not-a-url" }),
    ).toBe("vllm-local");
  });
});
