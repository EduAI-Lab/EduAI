import { afterEach, describe, expect, it } from "vitest";
import {
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
