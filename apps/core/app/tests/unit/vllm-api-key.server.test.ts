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
});
