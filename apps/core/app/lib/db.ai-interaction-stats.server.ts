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
import { getServerHealth } from "~/lib/ai/routing/fleet/health";
import { getAllFleetServers } from "~/lib/ai/routing/fleet/registry";
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
  /**
   * Models this server currently reports via /v1/models (live, cached 30s —
   * see health.ts). Null when the server is unreachable or not configured
   * at all (e.g. this row exists only because old interactions reference an
   * id no longer in the fleet registry).
   */
  models: string[] | null;
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

/** Raw DB aggregation only — grouped counts/sums per serverId that has interaction rows. */
async function groupInteractionsByServer(
  params: InteractionStatsParams,
): Promise<Map<string | null, Omit<ServerInteractionStat, "models">>> {
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
  });

  return new Map(
    grouped.map((row) => [
      row.serverId,
      {
        serverId: row.serverId,
        count: row._count._all,
        totalTokens: row._sum.totalTokens ?? 0,
        totalDurationMs: row._sum.durationMs ?? 0,
        totalCostUsd: (row._sum.estInputCostUsd ?? 0) + (row._sum.estOutputCostUsd ?? 0),
        totalEnergyJoules: row._sum.energyJoules ?? 0,
        totalCarbonGramsCO2: row._sum.carbonGramsCO2 ?? 0,
      },
    ]),
  );
}

const ZERO_TRAFFIC_STAT: Omit<ServerInteractionStat, "serverId" | "models"> = {
  count: 0,
  totalTokens: 0,
  totalDurationMs: 0,
  totalCostUsd: 0,
  totalEnergyJoules: 0,
  totalCarbonGramsCO2: 0,
};

/**
 * Routing volume + cost/energy totals grouped by fleet server, plus the
 * models each server currently hosts (live from /v1/models).
 *
 * Starts from the fleet registry (not just DISTINCT serverId in the DB) so a
 * configured-but-idle server still shows a zero-traffic row — otherwise a
 * freshly added server would be invisible on this page until its first
 * interaction landed. Any serverId that appears in the DB but is no longer
 * in the registry (retired server, or historical rows) is appended after,
 * with models: null since there's nothing to health-check.
 */
export async function getInteractionCountsByServer(
  params: InteractionStatsParams = {},
): Promise<ServerInteractionStat[]> {
  const [byServerId, registryServers] = await Promise.all([
    groupInteractionsByServer(params),
    Promise.resolve(getAllFleetServers()),
  ]);

  const healthResults = await Promise.all(
    registryServers.map((server) => getServerHealth(server.baseUrl)),
  );

  const registryRows: ServerInteractionStat[] = registryServers.map((server, index) => {
    const dbStat = byServerId.get(server.id);
    const health = healthResults[index];
    return {
      ...(dbStat ?? { ...ZERO_TRAFFIC_STAT, serverId: server.id }),
      models: health?.ok ? health.modelIds : server.models.length > 0 ? server.models : null,
    };
  });

  const registryIds = new Set(registryServers.map((s) => s.id));
  const unregisteredRows: ServerInteractionStat[] = [...byServerId.entries()]
    .filter(([serverId]) => serverId === null || !registryIds.has(serverId))
    .map(([, stat]) => ({ ...stat, models: null }))
    .sort((a, b) => b.count - a.count);

  // Registered servers sort by traffic among themselves, but always list
  // before unregistered/historical rows — the point of starting from the
  // registry is so the full current fleet roster is visible at a glance,
  // which a single global count-sort would undermine (an idle new server
  // would sink below high-traffic legacy rows from a decommissioned host).
  registryRows.sort((a, b) => b.count - a.count);

  return [...registryRows, ...unregisteredRows];
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
