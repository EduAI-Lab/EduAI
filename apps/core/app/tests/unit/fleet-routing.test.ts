import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFleetHealthCache } from "~/lib/ai/routing/fleet/health";
import {
  fleetRoutingEnabled,
  resetFleetRegistryCache,
  serverIdFromUrl,
} from "~/lib/ai/routing/fleet/registry";
import {
  FleetUnavailableError,
  resetFleetRoundRobin,
  resolveFleetHost,
} from "~/lib/ai/routing/fleet/resolve-fleet";
import { parseWorkloadFeature, buildFleetRouterFeatures, jobTypeFromFeature } from "~/lib/ai/routing/fleet/types";

describe("parseWorkloadFeature", () => {
  it("defaults to interactive when routingContext is missing", () => {
    expect(parseWorkloadFeature(undefined)).toBe("interactive");
  });

  it("parses interactive and background tags", () => {
    expect(parseWorkloadFeature({ feature: "interactive" })).toBe("interactive");
    expect(parseWorkloadFeature({ feature: "background" })).toBe("background");
  });

  it("maps legacy extension feature values", () => {
    expect(parseWorkloadFeature({ feature: "tutor" })).toBe("interactive");
    expect(parseWorkloadFeature({ feature: "question-maker" })).toBe("background");
  });

  it("falls back to interactive for unknown values", () => {
    expect(parseWorkloadFeature({ feature: "unknown" })).toBe("interactive");
  });
});

describe("jobTypeFromFeature", () => {
  it("passes through interactive and background", () => {
    expect(jobTypeFromFeature("interactive")).toBe("interactive");
    expect(jobTypeFromFeature("background")).toBe("background");
  });
});

describe("buildFleetRouterFeatures", () => {
  it("includes feature, jobType, and fleet pick metadata", () => {
    expect(
      buildFleetRouterFeatures("interactive", {
        serverId: "cmps02",
        baseUrl: "http://cmps02.ok.ubc.ca:8001",
        energySidecarUrl: "http://cmps02.ok.ubc.ca:8001/energy",
        reason: "interactive-round-robin",
        jobType: "interactive",
      }),
    ).toEqual({
      feature: "interactive",
      jobType: "interactive",
      fleetServerId: "cmps02",
      fleetReason: "interactive-round-robin",
    });
  });

  it("includes feature and jobType when fleet pick is null", () => {
    expect(buildFleetRouterFeatures("interactive", null)).toEqual({
      feature: "interactive",
      jobType: "interactive",
    });
  });
});

describe("fleet registry", () => {
  const originalChatUrls = process.env.VLLM_FLEET_CHAT_URLS;
  const originalHeavyUrl = process.env.VLLM_FLEET_HEAVY_URL;

  afterEach(() => {
    if (originalChatUrls === undefined) delete process.env.VLLM_FLEET_CHAT_URLS;
    else process.env.VLLM_FLEET_CHAT_URLS = originalChatUrls;
    if (originalHeavyUrl === undefined) delete process.env.VLLM_FLEET_HEAVY_URL;
    else process.env.VLLM_FLEET_HEAVY_URL = originalHeavyUrl;
    resetFleetRegistryCache();
  });

  it("derives server id from hostname", () => {
    expect(serverIdFromUrl("http://cmps02.ok.ubc.ca:8001")).toBe("cmps02");
  });

  it("enables fleet routing when chat URLs are configured", () => {
    process.env.VLLM_FLEET_CHAT_URLS =
      "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
    resetFleetRegistryCache();
    expect(fleetRoutingEnabled()).toBe(true);
  });
});

describe("resolveFleetHost", () => {
  const originalChatUrls = process.env.VLLM_FLEET_CHAT_URLS;
  const originalHeavyUrl = process.env.VLLM_FLEET_HEAVY_URL;
  const originalVllmBase = process.env.VLLM_BASE_URL;

  beforeEach(() => {
    resetFleetRegistryCache();
    resetFleetHealthCache();
    resetFleetRoundRobin();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalChatUrls === undefined) delete process.env.VLLM_FLEET_CHAT_URLS;
    else process.env.VLLM_FLEET_CHAT_URLS = originalChatUrls;
    if (originalHeavyUrl === undefined) delete process.env.VLLM_FLEET_HEAVY_URL;
    else process.env.VLLM_FLEET_HEAVY_URL = originalHeavyUrl;
    if (originalVllmBase === undefined) delete process.env.VLLM_BASE_URL;
    else process.env.VLLM_BASE_URL = originalVllmBase;
    resetFleetRegistryCache();
    resetFleetHealthCache();
    resetFleetRoundRobin();
    vi.restoreAllMocks();
  });

  it("returns null when fleet routing is disabled", async () => {
    delete process.env.VLLM_FLEET_CHAT_URLS;
    resetFleetRegistryCache();
    const pick = await resolveFleetHost({
      feature: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });
    expect(pick).toBeNull();
  });

  it("round-robins across healthy chat servers", async () => {
    process.env.VLLM_FLEET_CHAT_URLS =
      "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: "qwen2.5-7b-instruct" }, { id: "qwen2.5-32b-instruct" }],
        }),
        { status: 200 },
      );
    });

    const first = await resolveFleetHost({
      feature: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });
    const second = await resolveFleetHost({
      feature: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });

    expect(first?.serverId).toBe("cmps01");
    expect(second?.serverId).toBe("cmps02");
    expect(first?.energySidecarUrl).toBe("http://cmps01.ok.ubc.ca:8001/energy");
    fetchMock.mockRestore();
  });

  it("throws when no healthy server hosts the model", async () => {
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-32b-instruct" }] }), {
        status: 200,
      }),
    );

    await expect(
      resolveFleetHost({
        feature: "interactive",
        resolvedModelId: "vllm:qwen2.5-7b-instruct",
      }),
    ).rejects.toBeInstanceOf(FleetUnavailableError);
  });

  it("falls back to chat pool for background when heavy URL is unset", async () => {
    delete process.env.VLLM_FLEET_HEAVY_URL;
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-32b-instruct" }] }), {
        status: 200,
      }),
    );

    const pick = await resolveFleetHost({
      feature: "background",
      resolvedModelId: "vllm:qwen2.5-32b-instruct",
    });

    expect(pick?.serverId).toBe("cmps01");
    expect(pick?.reason).toBe("interactive-round-robin");
    expect(pick?.jobType).toBe("background");
  });
});
