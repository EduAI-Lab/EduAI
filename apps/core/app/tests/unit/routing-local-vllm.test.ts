import { afterEach, describe, expect, it } from "vitest";
import {
  isEffectiveToolCallingAvailable,
  isLocalVllmRouting,
  normalizePickForLocalVllm,
} from "~/lib/ai/routing/local-vllm";

describe("local-vllm routing", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("maps tier-2 picks to tier 3 when VLLM_BASE_URL is set", () => {
    process.env = { ...env, VLLM_BASE_URL: "http://cmps01:8001" };
    expect(isLocalVllmRouting()).toBe(true);
    expect(
      normalizePickForLocalVllm({ kind: "exactTier", tier: 2, tieBreak: "carbon" }),
    ).toEqual({ kind: "exactTier", tier: 3, tieBreak: "carbon" });
  });

  it("remaps minTier 2 picks to minTier 3 for local vLLM routing", () => {
    process.env = { ...env, VLLM_BASE_URL: "http://cmps01:8001" };
    expect(
      normalizePickForLocalVllm({
        kind: "minTier",
        minTier: 2,
        tieBreak: "energy",
      }),
    ).toEqual({
      kind: "minTier",
      minTier: 3,
      tieBreak: "energy",
    });
  });

  it("leaves tier-1 picks unchanged", () => {
    process.env = { ...env, VLLM_BASE_URL: "http://cmps01:8001" };
    expect(
      normalizePickForLocalVllm({ kind: "exactTier", tier: 1, tieBreak: "energy" }),
    ).toEqual({ kind: "exactTier", tier: 1, tieBreak: "energy" });
  });

  it("does not remap when cloud routing is allowed", () => {
    delete process.env.VLLM_BASE_URL;
    delete process.env.ROUTING_LOCAL_VLLM_ONLY;
    expect(isLocalVllmRouting()).toBe(false);
    expect(
      normalizePickForLocalVllm({ kind: "exactTier", tier: 2, tieBreak: "carbon" }),
    ).toEqual({ kind: "exactTier", tier: 2, tieBreak: "carbon" });
  });
});

describe("isEffectiveToolCallingAvailable", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("is always available for non-vLLM (cloud) routing", () => {
    delete process.env.VLLM_BASE_URL;
    delete process.env.ROUTING_LOCAL_VLLM_ONLY;
    delete process.env.VLLM_CHAT_TOOLS;
    expect(isEffectiveToolCallingAvailable()).toBe(true);
  });

  it("is unavailable for local vLLM routing when VLLM_CHAT_TOOLS is unset", () => {
    process.env = { ...env, VLLM_BASE_URL: "http://cmps01:8001" };
    delete process.env.VLLM_CHAT_TOOLS;
    expect(isEffectiveToolCallingAvailable()).toBe(false);
  });

  it("is unavailable for local vLLM routing when VLLM_CHAT_TOOLS=0", () => {
    process.env = { ...env, VLLM_BASE_URL: "http://cmps01:8001", VLLM_CHAT_TOOLS: "0" };
    expect(isEffectiveToolCallingAvailable()).toBe(false);
  });

  it("is available for local vLLM routing when VLLM_CHAT_TOOLS=1", () => {
    process.env = { ...env, VLLM_BASE_URL: "http://cmps01:8001", VLLM_CHAT_TOOLS: "1" };
    expect(isEffectiveToolCallingAvailable()).toBe(true);
  });
});
