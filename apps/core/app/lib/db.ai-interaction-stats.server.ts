/**
 * AI interaction routing/model stats (#1351 — Admin server logs page).
 *
 * Aggregates the existing `AIInteraction` rows into per-server and per-model
 * breakdowns so admins can see how much traffic is routed to a given fleet
 * server (CMPS01/02/03, and any server added later — AWS included, once
 * "q"-gated routing exists) and how much is being answered by a given model.
 *
 * `serverId` is free-form (see schema.prisma) — new servers require no code
 * change here, they simply appear as a new group once they start serving
 * traffic.
 */
import prisma from "~/lib/prisma.server";

export type InteractionStatsParams = {
  dateFrom?: Date;
  dateTo?: Date;
};

export type ServerInteractionStat = {
  serverId: string | null;
  count: number;
  totalTokens: number;
  totalDurationMs: number;
  totalCostUsd: number;
  totalEnergyJoules: number;
  totalCarbonGramsCO2: number;
};

export type ModelInteractionStat = {
  modelUsed: string;
  count: number;
  totalTokens: number;
  totalDurationMs: number;
  totalCostUsd: number;
  totalEnergyJoules: number;
  totalCarbonGramsCO2: number;
};

function buildDateWhere(params: InteractionStatsParams) {
  if (!params.dateFrom && !params.dateTo) {
    return {};
  }
  return {
    createdAt: {
      ...(params.dateFrom ? { gte: params.dateFrom } : {}),
      ...(params.dateTo ? { lte: params.dateTo } : {}),
    },
  };
}

/** Routing volume + cost/energy totals grouped by fleet server. */
export async function getInteractionCountsByServer(
  params: InteractionStatsParams = {},
): Promise<ServerInteractionStat[]> {
  const where = buildDateWhere(params);

  const grouped = await prisma.aIInteraction.groupBy({
    by: ["serverId"],
    where,
    _count: { _all: true },
    _sum: {
      totalTokens: true,
      durationMs: true,
      estInputCostUsd: true,
      estOutputCostUsd: true,
      energyJoules: true,
      carbonGramsCO2: true,
    },
    orderBy: { _count: { serverId: "desc" } },
  });

  return grouped.map((row) => ({
    serverId: row.serverId,
    count: row._count._all,
    totalTokens: row._sum.totalTokens ?? 0,
    totalDurationMs: row._sum.durationMs ?? 0,
    totalCostUsd: (row._sum.estInputCostUsd ?? 0) + (row._sum.estOutputCostUsd ?? 0),
    totalEnergyJoules: row._sum.energyJoules ?? 0,
    totalCarbonGramsCO2: row._sum.carbonGramsCO2 ?? 0,
  }));
}

/** Answer volume + cost/energy totals grouped by model. */
export async function getInteractionCountsByModel(
  params: InteractionStatsParams = {},
): Promise<ModelInteractionStat[]> {
  const where = buildDateWhere(params);

  const grouped = await prisma.aIInteraction.groupBy({
    by: ["modelUsed"],
    where,
    _count: { _all: true },
    _sum: {
      totalTokens: true,
      durationMs: true,
      estInputCostUsd: true,
      estOutputCostUsd: true,
      energyJoules: true,
      carbonGramsCO2: true,
    },
    orderBy: { _count: { modelUsed: "desc" } },
  });

  return grouped.map((row) => ({
    modelUsed: row.modelUsed,
    count: row._count._all,
    totalTokens: row._sum.totalTokens ?? 0,
    totalDurationMs: row._sum.durationMs ?? 0,
    totalCostUsd: (row._sum.estInputCostUsd ?? 0) + (row._sum.estOutputCostUsd ?? 0),
    totalEnergyJoules: row._sum.energyJoules ?? 0,
    totalCarbonGramsCO2: row._sum.carbonGramsCO2 ?? 0,
  }));
}
