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
import { parseWorkloadFeature, buildFleetRouterFeatures } from "~/lib/ai/routing/fleet/types";

describe("parseWorkloadFeature", () => {
  it("defaults to chat when routingContext is missing", () => {
    expect(parseWorkloadFeature(undefined)).toBe("chat");
  });

  it("parses known feature values", () => {
    expect(parseWorkloadFeature({ feature: "tutor" })).toBe("tutor");
    expect(parseWorkloadFeature({ feature: "question-maker" })).toBe("question-maker");
  });

  it("falls back to chat for unknown values", () => {
    expect(parseWorkloadFeature({ feature: "unknown" })).toBe("chat");
  });
});

describe("buildFleetRouterFeatures", () => {
  it("includes feature and fleet pick metadata", () => {
    expect(
      buildFleetRouterFeatures("tutor", {
        serverId: "cmps02",
        baseUrl: "http://cmps02.ok.ubc.ca:8001",
        energySidecarUrl: "http://cmps02.ok.ubc.ca:8001/energy",
        reason: "chat-round-robin",
      }),
    ).toEqual({
      feature: "tutor",
      fleetServerId: "cmps02",
      fleetReason: "chat-round-robin",
    });
  });

  it("includes only feature when fleet pick is null", () => {
    expect(buildFleetRouterFeatures("chat", null)).toEqual({ feature: "chat" });
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
      feature: "chat",
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
      feature: "chat",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });
    const second = await resolveFleetHost({
      feature: "chat",
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
        feature: "chat",
        resolvedModelId: "vllm:qwen2.5-7b-instruct",
      }),
    ).rejects.toBeInstanceOf(FleetUnavailableError);
  });

  it("falls back to chat pool for question-maker when heavy URL is unset", async () => {
    delete process.env.VLLM_FLEET_HEAVY_URL;
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-32b-instruct" }] }), {
        status: 200,
      }),
    );

    const pick = await resolveFleetHost({
      feature: "question-maker",
      resolvedModelId: "vllm:qwen2.5-32b-instruct",
    });

    expect(pick?.serverId).toBe("cmps01");
    expect(pick?.reason).toBe("chat-round-robin");
  });
});
