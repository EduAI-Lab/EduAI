// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fleet-aware UBC probing (#1551): `probeUbcStatus` fans out over every fleet
// host via `getAllFleetServers()`, checks liveness with `getServerHealth()`, and
// reads load with `probeVllmLoad()` (a real `/metrics` fetch), then aggregates.
// The pure aggregation + parse helpers are covered in `ai-service-status.test.ts`;
// this suite drives the wired fleet branch end-to-end so a break in the fan-out
// (not just the helpers) fails the build.
vi.mock("~/lib/ai/routing/fleet/registry", () => ({
  fleetRoutingEnabled: vi.fn(() => true),
  getAllFleetServers: vi.fn(() => []),
}));
vi.mock("~/lib/ai/routing/fleet/health", () => ({
  getServerHealth: vi.fn(),
}));

import { fleetRoutingEnabled, getAllFleetServers } from "~/lib/ai/routing/fleet/registry";
import { getServerHealth } from "~/lib/ai/routing/fleet/health";
import { getAiServiceStatus, resetAiServiceStatusCache } from "~/lib/ai/service-status.server";

const fleetRoutingEnabledMock = vi.mocked(fleetRoutingEnabled);
const getAllFleetServersMock = vi.mocked(getAllFleetServers);
const getServerHealthMock = vi.mocked(getServerHealth);

/** A fleet host is only touched by `.baseUrl` here — the rest is irrelevant. */
function server(baseUrl: string) {
  return { baseUrl } as unknown as ReturnType<typeof getAllFleetServers>[number];
}

/** A `/metrics` payload with the two gauges the load probe reads. */
function metrics(waiting: number, cacheUsage: number): string {
  return [`vllm:num_requests_waiting ${waiting}`, `vllm:gpu_cache_usage_perc ${cacheUsage}`].join(
    "\n",
  );
}

const CLOUD_ENV = [
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
  "VLLM_API_KEY",
  "VLLM_DEGRADED_WAITING",
  "VLLM_DEGRADED_CACHE_PCT",
] as const;
const savedEnv: Record<string, string | undefined> = {};

describe("getAiServiceStatus (fleet mode)", () => {
  beforeEach(() => {
    for (const key of CLOUD_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    resetAiServiceStatusCache();
    fleetRoutingEnabledMock.mockReturnValue(true);
    getAllFleetServersMock.mockReturnValue([]);
    getServerHealthMock.mockReset();
  });

  afterEach(() => {
    for (const key of CLOUD_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.unstubAllGlobals();
  });

  /** Stub fetch so each host's `/metrics` returns the load in `byHost`. */
  function stubMetrics(byHost: Record<string, { waiting: number; cacheUsage: number }>) {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      for (const [base, load] of Object.entries(byHost)) {
        if (url.startsWith(base)) {
          return Promise.resolve(
            new Response(metrics(load.waiting, load.cacheUsage), { status: 200 }),
          );
        }
      }
      return Promise.resolve(new Response("", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("is operational when every fleet host is reachable with headroom", async () => {
    getAllFleetServersMock.mockReturnValue([
      server("http://h1:8001/v1"),
      server("http://h2:8001/v1"),
    ]);
    getServerHealthMock.mockResolvedValue({ ok: true } as never);
    const fetchMock = stubMetrics({
      "http://h1:8001/v1": { waiting: 0, cacheUsage: 0.3 },
      "http://h2:8001/v1": { waiting: 1, cacheUsage: 0.5 },
    });

    const status = await getAiServiceStatus();

    expect(status.ubc.state).toBe("operational");
    expect(status.ubc.detail).toMatch(/2\/2 hosts healthy/i);
    // Load is read from every reachable host's /metrics.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/metrics")).length).toBe(2);
    expect(getServerHealthMock).toHaveBeenCalledTimes(2);
  });

  it("is degraded when some fleet hosts are down (reduced capacity)", async () => {
    getAllFleetServersMock.mockReturnValue([
      server("http://h1:8001/v1"),
      server("http://h2:8001/v1"),
    ]);
    getServerHealthMock.mockImplementation((baseUrl: string) =>
      Promise.resolve({ ok: baseUrl.includes("h1") } as never),
    );
    stubMetrics({ "http://h1:8001/v1": { waiting: 0, cacheUsage: 0.2 } });

    const status = await getAiServiceStatus();

    expect(status.ubc.state).toBe("degraded");
    expect(status.ubc.detail).toMatch(/1\/2 hosts reachable/i);
  });

  it("is degraded when the reachable hosts are under heavy aggregate load", async () => {
    getAllFleetServersMock.mockReturnValue([
      server("http://h1:8001/v1"),
      server("http://h2:8001/v1"),
    ]);
    getServerHealthMock.mockResolvedValue({ ok: true } as never);
    // 4 + 4 = 8 queued, over the default waiting threshold of 4.
    stubMetrics({
      "http://h1:8001/v1": { waiting: 4, cacheUsage: 0.4 },
      "http://h2:8001/v1": { waiting: 4, cacheUsage: 0.4 },
    });

    const status = await getAiServiceStatus();

    expect(status.ubc.state).toBe("degraded");
    expect(status.ubc.detail).toMatch(/heavy load — 8 queued/i);
  });

  it("honours env-tuned thresholds for the fleet load classification", async () => {
    process.env.VLLM_DEGRADED_WAITING = "20";
    getAllFleetServersMock.mockReturnValue([server("http://h1:8001/v1")]);
    getServerHealthMock.mockResolvedValue({ ok: true } as never);
    // 8 queued would be degraded at the default 4, but the env raises the bar to 20.
    stubMetrics({ "http://h1:8001/v1": { waiting: 8, cacheUsage: 0.4 } });

    const status = await getAiServiceStatus();

    expect(status.ubc.state).toBe("operational");
  });

  it("is an outage when the fleet registry is empty", async () => {
    getAllFleetServersMock.mockReturnValue([]);
    const fetchMock = stubMetrics({});

    const status = await getAiServiceStatus();

    expect(status.ubc.state).toBe("outage");
    expect(status.ubc.detail).toMatch(/no ubc-hosted inference configured/i);
    // No hosts → no health checks, no /metrics probes.
    expect(getServerHealthMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is an outage when every fleet host is unreachable", async () => {
    getAllFleetServersMock.mockReturnValue([
      server("http://h1:8001/v1"),
      server("http://h2:8001/v1"),
    ]);
    getServerHealthMock.mockResolvedValue({ ok: false } as never);
    stubMetrics({});

    const status = await getAiServiceStatus();

    expect(status.ubc.state).toBe("outage");
    expect(status.ubc.detail).toMatch(/configured but unreachable/i);
  });
});
