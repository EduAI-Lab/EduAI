import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getServerHealth,
  invalidateFleetHealthCacheForUrl,
  recordFleetHostFailure,
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
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
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
      {
        id: "cmps-from-config",
        baseUrl: "http://cmps-from-config:8001",
        jobTypes: ["interactive"],
      },
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
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
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

  it("keeps a chat affinity key on the same server across requests", async () => {
    process.env.VLLM_FLEET_CHAT_URLS =
      "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001,http://cmps03.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }] }), {
        status: 200,
      }),
    );

    const first = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      affinityKey: "chat-123",
    });
    const second = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      affinityKey: "chat-123",
    });

    expect(second?.serverId).toBe(first?.serverId);
    expect(first?.reason).toBe("interactive-affinity");
  });

  it("ejects an inference-failed host before selecting the next request", async () => {
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
    resetFleetRegistryCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }] }), {
        status: 200,
      }),
    );

    recordFleetHostFailure("http://cmps01.ok.ubc.ca:8001");
    const pick = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });

    expect(pick?.serverId).toBe("cmps02");
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
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }] }), {
        status: 200,
      });
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
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
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
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
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
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
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

describe("chat affinity — rendezvous stability under host ejection", () => {
  const originalChatUrls = process.env.VLLM_FLEET_CHAT_URLS;
  const originalConfigPath = process.env.FLEET_CONFIG_PATH;

  beforeEach(() => {
    process.env.FLEET_CONFIG_PATH = NONEXISTENT_CONFIG_PATH;
    process.env.VLLM_FLEET_CHAT_URLS =
      "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001,http://cmps03.ok.ubc.ca:8001";
    resetFleetRegistryCache();
    resetFleetHealthCache();
    resetFleetRoundRobin();
    vi.restoreAllMocks();
    // A fresh Response per call: Promise.all fires one getServerHealth() per
    // candidate concurrently, and a single shared Response body (as
    // mockResolvedValue would give every caller) can only be read by
    // whichever awaits res.json() first — the rest lose the race and read
    // from an already-used body, so most hosts would spuriously report
    // unhealthy.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }] }), { status: 200 }),
    );
  });

  afterEach(() => {
    if (originalChatUrls === undefined) delete process.env.VLLM_FLEET_CHAT_URLS;
    else process.env.VLLM_FLEET_CHAT_URLS = originalChatUrls;
    if (originalConfigPath === undefined) delete process.env.FLEET_CONFIG_PATH;
    else process.env.FLEET_CONFIG_PATH = originalConfigPath;
    resetFleetRegistryCache();
    resetFleetHealthCache();
    resetFleetRoundRobin();
    vi.restoreAllMocks();
  });

  it("only remaps affinity keys that were on the ejected host — everyone else keeps their server", async () => {
    const keys = Array.from({ length: 40 }, (_, index) => `chat-${index}`);

    const before = new Map<string, string>();
    for (const key of keys) {
      const pick = await resolveFleetHost({
        jobType: "interactive",
        resolvedModelId: "vllm:qwen2.5-7b-instruct",
        affinityKey: key,
      });
      before.set(key, pick!.serverId);
    }
    // Sanity: 40 keys across 3 hosts should actually exercise all three.
    expect(new Set(before.values()).size).toBe(3);

    recordFleetHostFailure("http://cmps01.ok.ubc.ca:8001");

    for (const key of keys) {
      const pick = await resolveFleetHost({
        jobType: "interactive",
        resolvedModelId: "vllm:qwen2.5-7b-instruct",
        affinityKey: key,
      });
      const originalHost = before.get(key)!;
      if (originalHost === "cmps01") {
        // Only keys that actually lived on the ejected host may move.
        expect(pick!.serverId).not.toBe("cmps01");
      } else {
        // Naive `hash % eligible.length` would reshuffle most of these too;
        // rendezvous hashing must leave them exactly where they were.
        expect(pick!.serverId).toBe(originalHost);
      }
    }
  });
});

describe("fleet host ejection cooldown recovery (fake timers)", () => {
  const originalChatUrls = process.env.VLLM_FLEET_CHAT_URLS;
  const originalConfigPath = process.env.FLEET_CONFIG_PATH;
  const originalEjectionMs = process.env.FLEET_FAILURE_EJECTION_MS;

  beforeEach(() => {
    process.env.FLEET_CONFIG_PATH = NONEXISTENT_CONFIG_PATH;
    process.env.VLLM_FLEET_CHAT_URLS = "http://cmps01.ok.ubc.ca:8001,http://cmps02.ok.ubc.ca:8001";
    resetFleetRegistryCache();
    resetFleetHealthCache();
    resetFleetRoundRobin();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    // See the sibling describe block above for why this must be a fresh
    // Response per call rather than mockResolvedValue's single shared one.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }] }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalChatUrls === undefined) delete process.env.VLLM_FLEET_CHAT_URLS;
    else process.env.VLLM_FLEET_CHAT_URLS = originalChatUrls;
    if (originalConfigPath === undefined) delete process.env.FLEET_CONFIG_PATH;
    else process.env.FLEET_CONFIG_PATH = originalConfigPath;
    if (originalEjectionMs === undefined) delete process.env.FLEET_FAILURE_EJECTION_MS;
    else process.env.FLEET_FAILURE_EJECTION_MS = originalEjectionMs;
    resetFleetRegistryCache();
    resetFleetHealthCache();
    resetFleetRoundRobin();
    vi.restoreAllMocks();
  });

  it("excludes a failed host until its cooldown elapses, then allows it back in", async () => {
    process.env.FLEET_FAILURE_EJECTION_MS = "30000";
    recordFleetHostFailure("http://cmps01.ok.ubc.ca:8001");

    const duringCooldown = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });
    expect(duringCooldown?.serverId).toBe("cmps02");

    // One tick before expiry: still excluded.
    await vi.advanceTimersByTimeAsync(29_999);
    const stillCoolingDown = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
    });
    expect(stillCoolingDown?.serverId).toBe("cmps02");

    // Cooldown elapses: the host is probed again and comes back healthy.
    await vi.advanceTimersByTimeAsync(2);
    const afterCooldown = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      excludeServerIds: ["cmps02"],
    });
    expect(afterCooldown?.serverId).toBe("cmps01");
  });

  it("does not let an in-flight probe clear a newer ejection", async () => {
    process.env.FLEET_FAILURE_EJECTION_MS = "30000";
    let resolveFetch!: (response: Response) => void;
    const deferredFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetch).mockImplementationOnce(async () => deferredFetch);

    const probe = getServerHealth("http://cmps01.ok.ubc.ca:8001");
    expect(fetch).toHaveBeenCalledTimes(1);

    recordFleetHostFailure("http://cmps01.ok.ubc.ca:8001");
    resolveFetch(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }] }), { status: 200 }),
    );

    await expect(probe).resolves.toMatchObject({ ok: false });
    await expect(getServerHealth("http://cmps01.ok.ubc.ca:8001")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("clamps an oversized FLEET_FAILURE_EJECTION_MS to the configured maximum bound", async () => {
    process.env.FLEET_FAILURE_EJECTION_MS = "99999999"; // far above the 120s max bound
    recordFleetHostFailure("http://cmps01.ok.ubc.ca:8001");

    await vi.advanceTimersByTimeAsync(119_999); // one tick before the clamp ceiling: still ejected
    const stillEjected = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      excludeServerIds: ["cmps02"],
    }).catch((err) => err);
    expect(stillEjected).toBeInstanceOf(FleetUnavailableError);

    await vi.advanceTimersByTimeAsync(1); // now at the clamp ceiling: eligible again
    const recovered = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      excludeServerIds: ["cmps02"],
    });
    expect(recovered?.serverId).toBe("cmps01");
  });

  it("clamps an undersized FLEET_FAILURE_EJECTION_MS to the configured minimum bound", async () => {
    process.env.FLEET_FAILURE_EJECTION_MS = "1"; // below the 100ms min bound
    recordFleetHostFailure("http://cmps01.ok.ubc.ca:8001");

    await vi.advanceTimersByTimeAsync(99); // below the 100ms clamp floor: still ejected
    const stillEjected = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      excludeServerIds: ["cmps02"],
    }).catch((err) => err);
    expect(stillEjected).toBeInstanceOf(FleetUnavailableError);

    await vi.advanceTimersByTimeAsync(1); // at the 100ms floor: eligible again
    const recovered = await resolveFleetHost({
      jobType: "interactive",
      resolvedModelId: "vllm:qwen2.5-7b-instruct",
      excludeServerIds: ["cmps02"],
    });
    expect(recovered?.serverId).toBe("cmps01");
  });
});

describe("fleet health duration configuration", () => {
  const originalCacheTtlMs = process.env.FLEET_HEALTH_CACHE_TTL_MS;
  const originalTimeoutMs = process.env.FLEET_HEALTH_TIMEOUT_MS;

  beforeEach(() => {
    resetFleetHealthCache();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b-instruct" }] }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalCacheTtlMs === undefined) delete process.env.FLEET_HEALTH_CACHE_TTL_MS;
    else process.env.FLEET_HEALTH_CACHE_TTL_MS = originalCacheTtlMs;
    if (originalTimeoutMs === undefined) delete process.env.FLEET_HEALTH_TIMEOUT_MS;
    else process.env.FLEET_HEALTH_TIMEOUT_MS = originalTimeoutMs;
    resetFleetHealthCache();
    vi.restoreAllMocks();
  });

  it("honors the configured cache TTL", async () => {
    process.env.FLEET_HEALTH_CACHE_TTL_MS = "100";
    const url = "http://cmps01.ok.ubc.ca:8001";

    await getServerHealth(url);
    await vi.advanceTimersByTimeAsync(99);
    await getServerHealth(url);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await getServerHealth(url);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clamps cache TTL to the minimum and maximum bounds", async () => {
    const url = "http://cmps01.ok.ubc.ca:8001";
    process.env.FLEET_HEALTH_CACHE_TTL_MS = "1";
    await getServerHealth(url);
    await vi.advanceTimersByTimeAsync(99);
    await getServerHealth(url);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await getServerHealth(url);
    expect(fetch).toHaveBeenCalledTimes(2);

    resetFleetHealthCache();
    vi.mocked(fetch).mockClear();
    process.env.FLEET_HEALTH_CACHE_TTL_MS = "99999999";
    await getServerHealth(url);
    await vi.advanceTimersByTimeAsync(119_999);
    await getServerHealth(url);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await getServerHealth(url);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clamps the health probe timeout to the configured bounds", async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(new AbortController().signal);
    process.env.FLEET_HEALTH_TIMEOUT_MS = "1";
    await getServerHealth("http://cmps01.ok.ubc.ca:8001");
    expect(timeoutSpy).toHaveBeenLastCalledWith(100);

    resetFleetHealthCache();
    process.env.FLEET_HEALTH_TIMEOUT_MS = "99999999";
    await getServerHealth("http://cmps01.ok.ubc.ca:8001");
    expect(timeoutSpy).toHaveBeenLastCalledWith(120_000);
  });
});
