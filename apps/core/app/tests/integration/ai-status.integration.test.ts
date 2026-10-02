// @vitest-environment node

/**
 * Integration coverage for the AI status probe/read path (#764 follow-on,
 * task 16). Exercises real Postgres through Prisma end to end — only the two
 * network probes (`getServerHealth`, `probeVllmLoad`) are mocked, never the
 * database. Mirrors the DB lifecycle conventions in
 * `app/tests/integration/canvas.integration.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

const getServerHealthMock = vi.hoisted(() => vi.fn());
const probeVllmLoadMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/ai/routing/fleet/health", () => ({ getServerHealth: getServerHealthMock }));
vi.mock("~/lib/ai/service-status/vllm-metrics.server", () => ({
  probeVllmLoad: probeVllmLoadMock,
}));
vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";
import { runAiStatusProbe } from "~/lib/ai/status-probe.server";
import { loadLatestSamples } from "~/lib/ai/status/read.server";
import { resetFleetRegistryCache } from "~/lib/ai/routing/fleet/registry";
import { loader as aiStatusLoader } from "~/routes/api/ai-status";
import { loader as aiStatusHistoryLoader } from "~/routes/api/ai-status.history";

// All fixture host/server ids in this file are prefixed "it-" so cleanup can
// target them without touching rows any other suite might leave behind.
const PREFIX = "it-";

function makeArgs(url: string) {
  return {
    request: new Request(url),
    params: {} as Record<string, string>,
    context: {} as never,
  } as any;
}

function stubSession() {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "ai-status-test-user", role: "STUDENT" },
  } as never);
}

async function cleanupSamples() {
  await prisma.aiServiceSample.deleteMany({ where: { serverId: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanupSamples();
  getServerHealthMock.mockResolvedValue({ ok: true, modelIds: [], checkedAt: Date.now() });
  probeVllmLoadMock.mockResolvedValue({ waiting: 0, cacheUsage: 0.1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetFleetRegistryCache();
});

afterAll(async () => {
  await cleanupSamples();
  await prisma.$disconnect();
});

describe("AI status probe/read integration", () => {
  it("writes one row per (host, model), each stamped with intervalMinutes", async () => {
    vi.stubEnv("VLLM_FLEET_CHAT_URLS", "http://it-a:8001,http://it-b:8001");
    vi.stubEnv("VLLM_FLEET_DEFAULT_MODELS", "cfg-model");
    vi.stubEnv("AI_STATUS_POLL_MINUTES", "5");
    resetFleetRegistryCache();

    getServerHealthMock.mockImplementation(async (baseUrl: string) => {
      if (baseUrl.includes("it-a")) {
        return { ok: true, modelIds: ["model-a1", "model-a2"], checkedAt: Date.now() };
      }
      return { ok: true, modelIds: ["model-b1"], checkedAt: Date.now() };
    });
    probeVllmLoadMock.mockResolvedValue({ waiting: 1, cacheUsage: 0.2 });

    await runAiStatusProbe();

    const rows = await prisma.aiServiceSample.findMany({
      where: { serverId: { in: ["it-a", "it-b"] } },
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.modelId).sort()).toEqual(["model-a1", "model-a2", "model-b1"]);
    for (const row of rows) {
      expect(row.intervalMinutes).toBe(5);
      expect(row.state).toBe("OPERATIONAL");
    }
  });

  it("writes OUTAGE rows for an unreachable host's previously observed models, not its configured list", async () => {
    vi.stubEnv("VLLM_FLEET_CHAT_URLS", "http://it-c:8001,http://it-d:8001");
    // The global default-models list is deliberately wrong for it-d, so a
    // fallback to it would prove the bug the brief describes.
    vi.stubEnv("VLLM_FLEET_DEFAULT_MODELS", "wrong-configured-model");
    vi.stubEnv("AI_STATUS_POLL_MINUTES", "5");
    resetFleetRegistryCache();

    getServerHealthMock.mockImplementation(async (baseUrl: string) => {
      if (baseUrl.includes("it-c")) {
        return { ok: true, modelIds: ["model-c1"], checkedAt: Date.now() };
      }
      return { ok: true, modelIds: ["model-d1"], checkedAt: Date.now() };
    });
    probeVllmLoadMock.mockResolvedValue({ waiting: 0, cacheUsage: 0.1 });

    // First run establishes real history: it-d actually serves model-d1.
    await runAiStatusProbe();

    // Second run: it-d goes unreachable.
    getServerHealthMock.mockImplementation(async (baseUrl: string) => {
      if (baseUrl.includes("it-c")) {
        return { ok: true, modelIds: ["model-c1"], checkedAt: Date.now() };
      }
      return { ok: false, modelIds: null, checkedAt: Date.now(), error: "connect ETIMEDOUT" };
    });

    await runAiStatusProbe();

    const dRows = await prisma.aiServiceSample.findMany({
      where: { serverId: "it-d", state: "OUTAGE" },
    });

    expect(dRows).toHaveLength(1);
    expect(dRows[0].modelId).toBe("model-d1");
    expect(dRows[0].modelId).not.toBe("wrong-configured-model");
  });

  it("still writes rows via the legacy single-URL path when no fleet is configured but VLLM_BASE_URL is set", async () => {
    vi.stubEnv("VLLM_FLEET_CHAT_URLS", "");
    vi.stubEnv("VLLM_FLEET_HEAVY_URL", "");
    vi.stubEnv("VLLM_BASE_URL", "http://it-legacy:8001");
    vi.stubEnv("OLLAMA_BASE_URL", "");
    resetFleetRegistryCache();

    getServerHealthMock.mockResolvedValue({
      ok: true,
      modelIds: ["legacy-model"],
      checkedAt: Date.now(),
    });
    probeVllmLoadMock.mockResolvedValue({ waiting: 0, cacheUsage: 0.05 });

    await runAiStatusProbe();

    const rows = await prisma.aiServiceSample.findMany({ where: { serverId: "it-legacy" } });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ modelId: "legacy-model", state: "OPERATIONAL" });
  });

  it("prunes only rows beyond the retention window", async () => {
    vi.stubEnv("VLLM_FLEET_CHAT_URLS", "http://it-e:8001");
    vi.stubEnv("VLLM_FLEET_DEFAULT_MODELS", "model-e");
    vi.stubEnv("AI_STATUS_POLL_MINUTES", "5");
    vi.stubEnv("AI_STATUS_SAMPLE_RETENTION_DAYS", "7");
    resetFleetRegistryCache();

    const now = Date.now();
    await prisma.aiServiceSample.create({
      data: {
        serverId: "it-prune",
        modelId: "old-model",
        state: "OPERATIONAL",
        reachable: true,
        waiting: 0,
        cacheUsage: 0.1,
        intervalMinutes: 5,
        observedAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.aiServiceSample.create({
      data: {
        serverId: "it-prune",
        modelId: "recent-model",
        state: "OPERATIONAL",
        reachable: true,
        waiting: 0,
        cacheUsage: 0.1,
        intervalMinutes: 5,
        observedAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
      },
    });

    getServerHealthMock.mockResolvedValue({
      ok: true,
      modelIds: ["model-e"],
      checkedAt: Date.now(),
    });
    probeVllmLoadMock.mockResolvedValue({ waiting: 0, cacheUsage: 0.1 });

    await runAiStatusProbe();

    const remaining = await prisma.aiServiceSample.findMany({
      where: { serverId: "it-prune" },
    });

    expect(remaining.map((r) => r.modelId)).toEqual(["recent-model"]);
  });

  it("reports stale + unknown from the sample's own stored intervalMinutes, not AI_STATUS_POLL_MINUTES", async () => {
    vi.stubEnv("VLLM_FLEET_CHAT_URLS", "http://it-f:8001");
    vi.stubEnv("VLLM_FLEET_DEFAULT_MODELS", "model-f");
    // If the reader used this env value instead of the stored cadence, 3x60=180
    // minutes would NOT consider a 20-minute-old sample stale.
    vi.stubEnv("AI_STATUS_POLL_MINUTES", "60");
    resetFleetRegistryCache();

    await prisma.aiServiceSample.create({
      data: {
        serverId: "it-f",
        modelId: "model-f",
        state: "OPERATIONAL",
        reachable: true,
        waiting: 0,
        cacheUsage: 0.1,
        intervalMinutes: 5, // stored cadence, deliberately different from the env
        observedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min > 3*5=15 min horizon
      },
    });

    stubSession();

    const response = await aiStatusLoader(makeArgs("http://localhost/api/ai-status"));
    const body = await response.json();

    expect(body.stale).toBe(true);
    expect(body.ubc.state).toBe("unknown");
  });

  it("loadLatestSamples ignores a serverId absent from the live registry, while the history query still returns it", async () => {
    vi.stubEnv("VLLM_FLEET_CHAT_URLS", "http://it-g:8001");
    vi.stubEnv("VLLM_FLEET_DEFAULT_MODELS", "model-g");
    resetFleetRegistryCache();

    await prisma.aiServiceSample.create({
      data: {
        serverId: "it-g",
        modelId: "model-g",
        state: "OPERATIONAL",
        reachable: true,
        waiting: 0,
        cacheUsage: 0.1,
        intervalMinutes: 15,
        observedAt: new Date(),
      },
    });
    await prisma.aiServiceSample.create({
      data: {
        serverId: "it-decommissioned",
        modelId: "old-model",
        state: "OPERATIONAL",
        reachable: true,
        waiting: 0,
        cacheUsage: 0.1,
        intervalMinutes: 15,
        observedAt: new Date(),
      },
    });

    const latest = await loadLatestSamples();
    expect(latest.some((s) => s.serverId === "it-decommissioned")).toBe(false);
    expect(latest.some((s) => s.serverId === "it-g")).toBe(true);

    stubSession();
    const response = await aiStatusHistoryLoader(
      makeArgs("http://localhost/api/ai-status/history?hours=1"),
    );
    const payload = await response.json();

    // The history query has no live-registry filter, so both hosts' samples
    // still show up as distinct server groups even though only it-g is live.
    expect(payload.servers).toHaveLength(2);
  });
});
