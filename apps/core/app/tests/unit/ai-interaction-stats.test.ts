import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    aIInteraction: { groupBy: vi.fn() },
  },
}));

import prisma from "~/lib/prisma.server";
import {
  getInteractionCountsByModel,
  getInteractionCountsByServer,
} from "~/lib/db.ai-interaction-stats.server";

describe("getInteractionCountsByServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps grouped rows into per-server totals, including unrouted (null serverId)", async () => {
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
      {
        serverId: null,
        _count: { _all: 3 },
        _sum: {
          totalTokens: 300,
          durationMs: 900,
          estInputCostUsd: null,
          estOutputCostUsd: null,
          energyJoules: null,
          carbonGramsCO2: null,
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
      },
      {
        serverId: null,
        count: 3,
        totalTokens: 300,
        totalDurationMs: 900,
        totalCostUsd: 0,
        totalEnergyJoules: 0,
        totalCarbonGramsCO2: 0,
      },
    ]);
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
