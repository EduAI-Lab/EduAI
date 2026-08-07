import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    aIInteraction: { groupBy: vi.fn() },
  },
}));

vi.mock("~/lib/ai/routing/fleet/registry", () => ({
  getAllFleetServers: vi.fn(),
}));

vi.mock("~/lib/ai/routing/fleet/health", () => ({
  getServerHealth: vi.fn(),
}));

import prisma from "~/lib/prisma.server";
import { getServerHealth } from "~/lib/ai/routing/fleet/health";
import { getAllFleetServers } from "~/lib/ai/routing/fleet/registry";
import {
  getInteractionCountsByModel,
  getInteractionCountsByServer,
} from "~/lib/db.ai-interaction-stats.server";

describe("getInteractionCountsByServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllFleetServers).mockReturnValue([]);
  });

  it("merges DB counts with live health for a registered server", async () => {
    vi.mocked(getAllFleetServers).mockReturnValue([
      { id: "cmps01", baseUrl: "http://cmps01.ok.ubc.ca:8001", jobTypes: ["interactive"], models: [] },
    ]);
    vi.mocked(getServerHealth).mockResolvedValue({
      ok: true,
      modelIds: ["qwen3.5-2b-instruct"],
      checkedAt: Date.now(),
    });
    vi.mocked(prisma.aIInteraction.groupBy).mockResolvedValue([
      {
        serverId: "cmps01",
        _count: { _all: 10 },
        _sum: {
          totalTokens: 1000,
          durationMs: 5000,
          estInputCostUsd: 0.01,
          estOutputCostUsd: 0.02,
          energyJoules: 100,
          carbonGramsCO2: 5,
        },
      },
    ] as never);

    const result = await getInteractionCountsByServer({});

    expect(result).toEqual([
      {
        serverId: "cmps01",
        count: 10,
        totalTokens: 1000,
        totalDurationMs: 5000,
        totalCostUsd: 0.03,
        totalEnergyJoules: 100,
        totalCarbonGramsCO2: 5,
        models: ["qwen3.5-2b-instruct"],
      },
    ]);
  });

  it("shows a zero-traffic row for a registered server with no interactions yet", async () => {
    vi.mocked(getAllFleetServers).mockReturnValue([
      { id: "cmps03", baseUrl: "http://cmps03.ok.ubc.ca:8001", jobTypes: ["background"], models: [] },
    ]);
    vi.mocked(getServerHealth).mockResolvedValue({
      ok: true,
      modelIds: ["qwen2.5-32b-instruct"],
      checkedAt: Date.now(),
    });
    vi.mocked(prisma.aIInteraction.groupBy).mockResolvedValue([] as never);

    const result = await getInteractionCountsByServer({});

    expect(result).toEqual([
      {
        serverId: "cmps03",
        count: 0,
        totalTokens: 0,
        totalDurationMs: 0,
        totalCostUsd: 0,
        totalEnergyJoules: 0,
        totalCarbonGramsCO2: 0,
        models: ["qwen2.5-32b-instruct"],
      },
    ]);
  });

  it("reports models: null when the live health probe fails and no config fallback exists", async () => {
    vi.mocked(getAllFleetServers).mockReturnValue([
      { id: "cmps02", baseUrl: "http://cmps02.ok.ubc.ca:8001", jobTypes: ["interactive"], models: [] },
    ]);
    vi.mocked(getServerHealth).mockResolvedValue({
      ok: false,
      modelIds: null,
      checkedAt: Date.now(),
      error: "timeout",
    });
    vi.mocked(prisma.aIInteraction.groupBy).mockResolvedValue([] as never);

    const result = await getInteractionCountsByServer({});

    expect(result[0]?.models).toBeNull();
  });

  it("falls back to config-file models when the live health probe fails", async () => {
    vi.mocked(getAllFleetServers).mockReturnValue([
      {
        id: "cmps02",
        baseUrl: "http://cmps02.ok.ubc.ca:8001",
        jobTypes: ["interactive"],
        models: ["qwen3.5-27b-instruct"],
      },
    ]);
    vi.mocked(getServerHealth).mockResolvedValue({
      ok: false,
      modelIds: null,
      checkedAt: Date.now(),
      error: "timeout",
    });
    vi.mocked(prisma.aIInteraction.groupBy).mockResolvedValue([] as never);

    const result = await getInteractionCountsByServer({});

    expect(result[0]?.models).toEqual(["qwen3.5-27b-instruct"]);
  });

  it("appends unregistered/null serverId rows from the DB after registry rows, with models: null", async () => {
    vi.mocked(getAllFleetServers).mockReturnValue([
      { id: "cmps01", baseUrl: "http://cmps01.ok.ubc.ca:8001", jobTypes: ["interactive"], models: [] },
    ]);
    vi.mocked(getServerHealth).mockResolvedValue({
      ok: true,
      modelIds: ["qwen3.5-2b-instruct"],
      checkedAt: Date.now(),
    });
    vi.mocked(prisma.aIInteraction.groupBy).mockResolvedValue([
      {
        serverId: "cmps01",
        _count: { _all: 1 },
        _sum: {
          totalTokens: 10,
          durationMs: 50,
          estInputCostUsd: 0,
          estOutputCostUsd: 0,
          energyJoules: 1,
          carbonGramsCO2: 0.1,
        },
      },
      {
        serverId: null,
        _count: { _all: 5 },
        _sum: {
          totalTokens: 500,
          durationMs: 2500,
          estInputCostUsd: null,
          estOutputCostUsd: null,
          energyJoules: null,
          carbonGramsCO2: null,
        },
      },
      {
        serverId: "retired-server",
        _count: { _all: 2 },
        _sum: {
          totalTokens: 20,
          durationMs: 100,
          estInputCostUsd: null,
          estOutputCostUsd: null,
          energyJoules: null,
          carbonGramsCO2: null,
        },
      },
    ] as never);

    const result = await getInteractionCountsByServer({});

    // Registered row first (cmps01), then unregistered rows sorted by count desc.
    expect(result.map((r) => r.serverId)).toEqual(["cmps01", null, "retired-server"]);
    expect(result.find((r) => r.serverId === null)?.models).toBeNull();
    expect(result.find((r) => r.serverId === "retired-server")?.models).toBeNull();
  });

  it("applies date range filters to the prisma where clause", async () => {
    vi.mocked(prisma.aIInteraction.groupBy).mockResolvedValue([] as never);
    const dateFrom = new Date("2026-08-01T00:00:00.000Z");
    const dateTo = new Date("2026-08-06T23:59:59.999Z");

    await getInteractionCountsByServer({ dateFrom, dateTo });

    expect(prisma.aIInteraction.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: dateFrom, lte: dateTo } },
      }),
    );
  });
});

describe("getInteractionCountsByModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps grouped rows into per-model totals", async () => {
    vi.mocked(prisma.aIInteraction.groupBy).mockResolvedValue([
      {
        modelUsed: "vllm:qwen2.5-7b-instruct",
        _count: { _all: 7 },
        _sum: {
          totalTokens: 700,
          durationMs: 3500,
          estInputCostUsd: 0,
          estOutputCostUsd: 0,
          energyJoules: 50,
          carbonGramsCO2: 2,
        },
      },
    ] as never);

    const result = await getInteractionCountsByModel({});

    expect(result).toEqual([
      {
        modelUsed: "vllm:qwen2.5-7b-instruct",
        count: 7,
        totalTokens: 700,
        totalDurationMs: 3500,
        totalCostUsd: 0,
        totalEnergyJoules: 50,
        totalCarbonGramsCO2: 2,
      },
    ]);
  });
});
