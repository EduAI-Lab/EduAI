import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidateFleetHealthCacheForUrl,
  resetFleetHealthCache,
} from "~/lib/ai/routing/fleet/health";
import {
  fleetRoutingEnabled,
  getAllFleetServers,
  resetFleetRegistryCache,
  serverIdFromUrl,
} from "~/lib/ai/routing/fleet/registry";
import {
  FleetUnavailableError,
  resetFleetRoundRobin,
  resolveFleetHost,
  resolveFleetHostAfterFailure,
} from "~/lib/ai/routing/fleet/resolve-fleet";
import {
  buildFleetRouterFeatures,
  parseJobType,
  parseWorkloadFeature,
} from "~/lib/ai/routing/fleet/types";

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
        reason: "interactive-round-robin",
      }),
    ).toEqual({
      feature: "tutor",
      fleetServerId: "cmps02",
      fleetReason: "interactive-round-robin",
    });
  });

  it("includes only feature when fleet pick is null", () => {
    expect(buildFleetRouterFeatures("chat", null)).toEqual({ feature: "chat" });
  });
});

describe("parseJobType", () => {
  it("defaults to interactive when routingContext is missing", () => {
    expect(parseJobType(undefined)).toBe("interactive");
  });

  it("parses validated jobType values", () => {
    expect(parseJobType({ jobType: "interactive" })).toBe("interactive");
    expect(parseJobType({ jobType: "background" })).toBe("background");
  });

  it("falls back to interactive for unknown or legacy feature tags", () => {
    expect(parseJobType({ jobType: "heavy" })).toBe("interactive");
    expect(parseJobType({ feature: "tutor" })).toBe("interactive");
    expect(parseJobType({ feature: "background" })).toBe("interactive");
  });
});

// These tests exercise the legacy env-var-driven registry path, so they must
// not see the repo's real apps/core/fleet.config.json — pointing
// FLEET_CONFIG_PATH at a nonexistent file forces loadFleetConfigFile() to
// return null (same as an unmigrated deployment) and fall through to env vars.
const NONEXISTENT_CONFIG_PATH = "./__no-such-fleet-config__.json";

describe("fleet registry", () => {
  const originalChatUrls = process.env.VLLM_FLEET_CHAT_URLS;
  const originalHeavyUrl = process.env.VLLM_FLEET_HEAVY_URL;
  const originalConfigPath = process.env.FLEET_CONFIG_PATH;

  beforeEach(() => {
    process.env.FLEET_CONFIG_PATH = NONEXISTENT_CONFIG_PATH;
  });

  afterEach(() => {
    if (originalChatUrls === undefined) delete process.env.VLLM_FLEET_CHAT_URLS;
    else process.env.VLLM_FLEET_CHAT_URLS = originalChatUrls;
    if (originalHeavyUrl === undefined) delete process.env.VLLM_FLEET_HEAVY_URL;
    else process.env.VLLM_FLEET_HEAVY_URL = originalHeavyUrl;
    if (originalConfigPath === undefined) delete process.env.FLEET_CONFIG_PATH;
    else process.env.FLEET_CONFIG_PATH = originalConfigPath;
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

  it("getAllFleetServers deduplicates chat/heavy pools by id in the env-driven fallback", () => {
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    process.env.VLLM_FLEET_HEAVY_URL = "http://cmps03.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    const servers = getAllFleetServers();
    expect(servers.map((s) => s.id).sort()).toEqual(["cmps01", "cmps03"]);
  });
});

describe("fleet registry — config file", () => {
  let tmpDir: string;
  const originalConfigPath = process.env.FLEET_CONFIG_PATH;
  const originalChatUrls = process.env.VLLM_FLEET_CHAT_URLS;
  const originalHeavyUrl = process.env.VLLM_FLEET_HEAVY_URL;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fleet-config-registry-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalConfigPath === undefined) delete process.env.FLEET_CONFIG_PATH;
    else process.env.FLEET_CONFIG_PATH = originalConfigPath;
    if (originalChatUrls === undefined) delete process.env.VLLM_FLEET_CHAT_URLS;
    else process.env.VLLM_FLEET_CHAT_URLS = originalChatUrls;
    if (originalHeavyUrl === undefined) delete process.env.VLLM_FLEET_HEAVY_URL;
    else process.env.VLLM_FLEET_HEAVY_URL = originalHeavyUrl;
    resetFleetRegistryCache();
  });

  function writeConfig(servers: unknown[]): void {
    const path = join(tmpDir, "fleet.config.json");
    writeFileSync(path, JSON.stringify({ servers }), "utf-8");
    process.env.FLEET_CONFIG_PATH = path;
  }

  it("uses the config file over env vars when both are present", () => {
    writeConfig([
      { id: "cmps-from-config", baseUrl: "http://cmps-from-config:8001", jobTypes: ["interactive"] },
    ]);
    // Env vars are set too, to prove the config file wins rather than merging.
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps-from-env:8001";
    resetFleetRegistryCache();

    const servers = getAllFleetServers();
    expect(servers.map((s) => s.id)).toEqual(["cmps-from-config"]);
  });

  it("splits config-file servers into interactive/background pools by jobTypes", () => {
    writeConfig([
      { id: "cmps01", baseUrl: "http://cmps01:8001", jobTypes: ["interactive"] },
      { id: "cmps03", baseUrl: "http://cmps03:8001", jobTypes: ["background"] },
    ]);
    resetFleetRegistryCache();

    expect(fleetRoutingEnabled()).toBe(true);
    expect(getAllFleetServers().map((s) => s.id)).toEqual(["cmps01", "cmps03"]);
  });

  it("a server can belong to both pools via jobTypes", () => {
    writeConfig([
      { id: "cmps01", baseUrl: "http://cmps01:8001", jobTypes: ["interactive", "background"] },
    ]);
    resetFleetRegistryCache();

    expect(getAllFleetServers()).toHaveLength(1);
  });
});

describe("resolveFleetHost", () => {
  const originalChatUrls = process.env.VLLM_FLEET_CHAT_URLS;
  const originalHeavyUrl = process.env.VLLM_FLEET_HEAVY_URL;
  const originalVllmBase = process.env.VLLM_BASE_URL;
  const originalConfigPath = process.env.FLEET_CONFIG_PATH;

  beforeEach(() => {
    // See NONEXISTENT_CONFIG_PATH above — keeps these env-var-driven tests
    // isolated from the repo's real fleet.config.json.
    process.env.FLEET_CONFIG_PATH = NONEXISTENT_CONFIG_PATH;
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
    if (originalConfigPath === undefined) delete process.env.FLEET_CONFIG_PATH;
    else process.env.FLEET_CONFIG_PATH = originalConfigPath;
    resetFleetRegistryCache();
    resetFleetHealthCache();
    resetFleetRoundRobin();
    vi.restoreAllMocks();
  });

  it("returns null when fleet routing is disabled", async () => {
    delete process.env.VLLM_FLEET_CHAT_URLS;
    resetFleetRegistryCache();
    const pick = await resolveFleetHost({
      jobType: "interactive",
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
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });
    const second = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });

    expect(first?.serverId).toBe("cmps01");
    expect(first?.reason).toBe("interactive-round-robin");
    expect(second?.serverId).toBe("cmps02");
    fetchMock.mockRestore();
  });

  it("checks candidate health concurrently", async () => {
    process.env.VLLM_FLEET_CHAT_URLS =
      "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001,http://cmps03.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return new Response(
        JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }] }),
        { status: 200 },
      );
    });

    await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(3);
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
        jobType: "interactive",
        resolvedModelId: "vllm:qwen2.5-7b-instruct",
      }),
    ).rejects.toBeInstanceOf(FleetUnavailableError);
  });

  it("throws when /v1/models returns an empty list (no configured-model fallback)", async () => {
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    await expect(
      resolveFleetHost({
        jobType: "interactive",
        resolvedModelId: "vllm:qwen2.5-7b-instruct",
      }),
    ).rejects.toBeInstanceOf(FleetUnavailableError);
  });

  it("falls back to the interactive pool for background jobs when heavy URL is unset", async () => {
    delete process.env.VLLM_FLEET_HEAVY_URL;
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-32b-instruct" }] }), {
        status: 200,
      }),
    );

    const pick = await resolveFleetHost({
      jobType: "background",
      resolvedModelId: "vllm:qwen2.5-32b-instruct",
    });

    expect(pick?.serverId).toBe("cmps01");
    expect(pick?.reason).toBe("interactive-round-robin");
  });

  it("maps the PR4 question-maker feature to a background job", async () => {
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    process.env.VLLM_FLEET_HEAVY_URL = "http://cmps03.ok.ubc.ca:8001";
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

    expect(pick?.serverId).toBe("cmps03");
    expect(pick?.reason).toBe("background-round-robin");
  });

  it("routes background jobs to the configured background pool", async () => {
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    process.env.VLLM_FLEET_HEAVY_URL = "http://cmps03.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-32b-instruct" }] }), {
        status: 200,
      }),
    );

    const pick = await resolveFleetHost({
      jobType: "background",
      resolvedModelId: "vllm:qwen2.5-32b-instruct",
    });

    expect(pick?.serverId).toBe("cmps03");
    expect(pick?.reason).toBe("background-round-robin");
  });

  it("keeps independent round-robin cursors per pool", async () => {
    process.env.VLLM_FLEET_CHAT_URLS =
      "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
    process.env.VLLM_FLEET_HEAVY_URL = "http://cmps03.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: "qwen2.5-7b-instruct" }, { id: "qwen2.5-32b-instruct" }],
        }),
        { status: 200 },
      );
    });

    const firstInteractive = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });
    const background = await resolveFleetHost({
      jobType: "background",
      resolvedModelId: "vllm:qwen2.5-32b-instruct",
    });
    const secondInteractive = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });

    expect(firstInteractive?.serverId).toBe("cmps01");
    expect(background?.serverId).toBe("cmps03");
    expect(secondInteractive?.serverId).toBe("cmps02");
  });

  it("treats HTTP 200 without a valid data array as unhealthy (no configured-model fallback)", async () => {
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [{ id: "qwen2.5-7b-instruct" }] }), {
        status: 200,
      }),
    );

    await expect(
      resolveFleetHost({
        jobType: "interactive",
        resolvedModelId: "vllm:qwen2.5-7b-instruct",
      }),
    ).rejects.toBeInstanceOf(FleetUnavailableError);
  });

  it("excludes a failed server id on retry pick", async () => {
    process.env.VLLM_FLEET_CHAT_URLS =
      "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: "qwen2.5-7b-instruct" }, { id: "qwen2.5-32b-instruct" }],
        }),
        { status: 200 },
      );
    });

    const pick = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      excludeServerIds: ["cmps01"],
    });

    expect(pick?.serverId).toBe("cmps02");
    expect(pick?.reason).toBe("interactive-round-robin-retry");
  });

  it("resolveFleetHostAfterFailure invalidates and picks the other host", async () => {
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

    const failed = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });
    expect(failed?.serverId).toBe("cmps01");

    invalidateFleetHealthCacheForUrl(failed!.baseUrl);
    const next = await resolveFleetHostAfterFailure({
      failedPick: failed!,
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      jobType: "interactive",
    });

    expect(next?.serverId).toBe("cmps02");
    expect(next?.reason).toContain("retry");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("resolveFleetHostAfterFailure returns null when no alternate host remains", async () => {
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }] }), {
        status: 200,
      }),
    );

    const failed = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });

    const next = await resolveFleetHostAfterFailure({
      failedPick: failed!,
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      jobType: "interactive",
    });

    expect(next).toBeNull();
  });
});
