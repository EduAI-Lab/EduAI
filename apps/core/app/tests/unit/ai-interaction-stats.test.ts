import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    aIInteraction: { groupBy: vi.fn() },
    $queryRaw: vi.fn(),
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
  getPeakUsageHours,
} from "~/lib/db.ai-interaction-stats.server";

/**
 * groupInteractionsByServer now issues two parallel groupBy calls against the
 * same mocked fn — the main by:["serverId"] aggregation, and
 * distinctChatCountsByServer's by:["serverId","chatId"] count. Promise.all
 * gives no ordering guarantee between them, so route by the `by` argument's
 * shape rather than call order/mockResolvedValueOnce.
 */
function mockGroupByServerId(rows: unknown[]) {
  vi.mocked(prisma.aIInteraction.groupBy).mockImplementation((args: unknown) => {
    const by = (args as { by: string[] }).by;
    if (by.length === 2 && by.includes("chatId")) {
      return Promise.resolve([]) as never;
    }
    return Promise.resolve(rows) as never;
  });
}

/** Stubs both the serverId grouping and the distinct-chatId grouping (server, chatId) pairs. */
function mockGroupByServerIdWithChats(rows: unknown[], chatRows: { serverId: string | null; chatId: string }[]) {
  vi.mocked(prisma.aIInteraction.groupBy).mockImplementation((args: unknown) => {
    const by = (args as { by: string[] }).by;
    if (by.length === 2 && by.includes("chatId")) {
      return Promise.resolve(chatRows) as never;
    }
    return Promise.resolve(rows) as never;
  });
}

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
    mockGroupByServerIdWithChats(
      [
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
      ],
      [
        { serverId: "cmps01", chatId: "chat_1" },
        { serverId: "cmps01", chatId: "chat_2" },
      ],
    );

    const result = await getInteractionCountsByServer({});

    expect(result).toEqual([
      {
        serverId: "cmps01",
        count: 10,
        distinctChatCount: 2,
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
    mockGroupByServerId([]);

    const result = await getInteractionCountsByServer({});

    expect(result).toEqual([
      {
        serverId: "cmps03",
        count: 0,
        distinctChatCount: 0,
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
    mockGroupByServerId([
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
    ]);

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

describe("getPeakUsageHours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("always returns all 24 hours, filling gaps with a zero count", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { hour: 9, count: 5n },
      { hour: 14, count: 12n },
    ] as never);

    const result = await getPeakUsageHours({});

    expect(result).toHaveLength(24);
    expect(result.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(result.find((h) => h.hour === 9)?.count).toBe(5);
    expect(result.find((h) => h.hour === 14)?.count).toBe(12);
    expect(result.find((h) => h.hour === 0)?.count).toBe(0);
  });

  it("converts bigint counts from COUNT(*) into plain numbers", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ hour: 3, count: 1000n }] as never);

    const result = await getPeakUsageHours({});

    const hour3 = result.find((h) => h.hour === 3);
    expect(hour3?.count).toBe(1000);
    expect(typeof hour3?.count).toBe("number");
  });

  it("returns all-zero hours when there are no interactions in the window", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

    const result = await getPeakUsageHours({ dateFrom: new Date("2026-01-01"), dateTo: new Date("2026-01-02") });

    expect(result.every((h) => h.count === 0)).toBe(true);
  });
});
