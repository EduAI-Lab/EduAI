// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  aggregateUbcStatus,
  classifyCloudStatus,
  resolveLoadThresholds,
  resolveUbcBaseUrls,
  type HostProbe,
  type LoadThresholds,
} from "~/lib/ai/service-status.server";
import { parseVllmLoad } from "~/lib/ai/service-status/vllm-metrics.server";

describe("classifyCloudStatus", () => {
  it("is an outage when no cloud key is present", () => {
    const s = classifyCloudStatus({});
    expect(s.state).toBe("outage");
    expect(s.detail).toMatch(/no cloud api key/i);
  });

  it("is operational and names each configured provider", () => {
    const s = classifyCloudStatus({ openai: "sk-x", google: "  ", openrouter: "or-y" });
    expect(s.state).toBe("operational");
    expect(s.detail).toContain("OpenAI");
    expect(s.detail).toContain("OpenRouter");
    // Whitespace-only keys are treated as absent.
    expect(s.detail).not.toContain("Google");
  });

  it("treats whitespace-only keys as absent", () => {
    expect(classifyCloudStatus({ openai: "   ", google: null }).state).toBe("outage");
  });
});

describe("resolveUbcBaseUrls", () => {
  it("reads and trims env base URLs", () => {
    const urls = resolveUbcBaseUrls({
      VLLM_BASE_URL: " http://cmps01:8001/v1 ",
      OLLAMA_BASE_URL: "http://localhost:11434/api",
    } as NodeJS.ProcessEnv);
    expect(urls.vllm).toBe("http://cmps01:8001/v1");
    expect(urls.ollama).toBe("http://localhost:11434/api");
  });

  it("returns undefined for unset / blank URLs", () => {
    const urls = resolveUbcBaseUrls({ VLLM_BASE_URL: "   " } as NodeJS.ProcessEnv);
    expect(urls.vllm).toBeUndefined();
    expect(urls.ollama).toBeUndefined();
  });
});

describe("resolveLoadThresholds", () => {
  it("defaults waiting=4 and cachePct=0.9", () => {
    const t = resolveLoadThresholds({} as NodeJS.ProcessEnv);
    expect(t).toEqual({ waiting: 4, cachePct: 0.9 });
  });

  it("reads env overrides and ignores invalid / negative values", () => {
    expect(
      resolveLoadThresholds({
        VLLM_DEGRADED_WAITING: "10",
        VLLM_DEGRADED_CACHE_PCT: "0.75",
      } as NodeJS.ProcessEnv),
    ).toEqual({ waiting: 10, cachePct: 0.75 });

    expect(
      resolveLoadThresholds({
        VLLM_DEGRADED_WAITING: "-3",
        VLLM_DEGRADED_CACHE_PCT: "nope",
      } as NodeJS.ProcessEnv),
    ).toEqual({ waiting: 4, cachePct: 0.9 });
  });

  it("falls back to defaults for blank / whitespace values (not 0)", () => {
    // Number("") === 0 — a blank env line must NOT pin the threshold to 0, which
    // would flag the fleet degraded under any load.
    expect(
      resolveLoadThresholds({
        VLLM_DEGRADED_WAITING: "",
        VLLM_DEGRADED_CACHE_PCT: "   ",
      } as NodeJS.ProcessEnv),
    ).toEqual({ waiting: 4, cachePct: 0.9 });
  });
});

describe("parseVllmLoad", () => {
  it("sums waiting and maxes cache usage across model-labelled series", () => {
    const text = [
      "# HELP vllm:num_requests_waiting Number of requests waiting.",
      "# TYPE vllm:num_requests_waiting gauge",
      'vllm:num_requests_waiting{model_name="qwen-7b"} 3.0',
      'vllm:num_requests_waiting{model_name="qwen-32b"} 2.0',
      'vllm:gpu_cache_usage_perc{model_name="qwen-7b"} 0.42',
      'vllm:gpu_cache_usage_perc{model_name="qwen-32b"} 0.88',
    ].join("\n");
    expect(parseVllmLoad(text)).toEqual({ waiting: 5, cacheUsage: 0.88 });
  });

  it("parses unlabelled series and ignores prefix-collision metrics", () => {
    const text = [
      "vllm:num_requests_waiting 7",
      "vllm:num_requests_waiting_total 999", // must NOT match the waiting gauge
      "vllm:gpu_cache_usage_perc 0.5",
    ].join("\n");
    expect(parseVllmLoad(text)).toEqual({ waiting: 7, cacheUsage: 0.5 });
  });

  it("returns zeroes when the gauges are absent", () => {
    expect(parseVllmLoad("some_other_metric 1\n")).toEqual({ waiting: 0, cacheUsage: 0 });
  });
});

describe("aggregateUbcStatus", () => {
  const T: LoadThresholds = { waiting: 4, cachePct: 0.9 };
  const up = (load: HostProbe["load"] = null): HostProbe => ({ reachable: true, load });
  const down = (): HostProbe => ({ reachable: false, load: null });

  it("is an outage when no hosts are configured", () => {
    const s = aggregateUbcStatus([], T);
    expect(s.state).toBe("outage");
    expect(s.detail).toMatch(/no ubc-hosted inference configured/i);
  });

  it("is an outage when every host is unreachable", () => {
    const s = aggregateUbcStatus([down(), down()], T);
    expect(s.state).toBe("outage");
    expect(s.detail).toMatch(/unreachable/i);
  });

  it("is operational when all hosts are up with headroom", () => {
    const s = aggregateUbcStatus(
      [up({ waiting: 0, cacheUsage: 0.3 }), up({ waiting: 1, cacheUsage: 0.5 })],
      T,
    );
    expect(s.state).toBe("operational");
    expect(s.detail).toMatch(/2\/2 hosts healthy/i);
  });

  it("is degraded when some hosts are down (reduced capacity)", () => {
    const s = aggregateUbcStatus([up({ waiting: 0, cacheUsage: 0.2 }), down()], T);
    expect(s.state).toBe("degraded");
    expect(s.detail).toMatch(/1\/2 hosts reachable/i);
  });

  it("is degraded under heavy aggregate load (queued > threshold)", () => {
    const s = aggregateUbcStatus(
      [up({ waiting: 3, cacheUsage: 0.4 }), up({ waiting: 3, cacheUsage: 0.4 })],
      T,
    );
    expect(s.state).toBe("degraded");
    expect(s.detail).toMatch(/heavy load — 6 queued/i);
  });

  it("is degraded when KV-cache is near full on any host", () => {
    const s = aggregateUbcStatus([up({ waiting: 0, cacheUsage: 0.95 })], T);
    expect(s.state).toBe("degraded");
    expect(s.detail).toMatch(/kv-cache 95% full/i);
  });

  it("counts reachable hosts with unknown load (e.g. Ollama) as up", () => {
    const s = aggregateUbcStatus([up(null)], T);
    expect(s.state).toBe("operational");
  });
});
