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
import { Prisma } from "@prisma/client";
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
  /**
   * Count of distinct non-null chatId values for this server (#1351). Turns
   * with no owning chat (async Question Maker/background AiJob completions,
   * and rows predating the chatId column) are excluded, not counted as one
   * shared "no chat" bucket — there's no meaningful chat to attribute them
   * to. Always <= count, since a chat can have multiple turns.
   */
  distinctChatCount: number;
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

/** One UTC hour-of-day (0-23) bucket in the peak-usage-hours breakdown. */
export type HourlyUsageStat = {
  hour: number;
  count: number;
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

/**
 * Distinct non-null chatId count per serverId. Prisma's groupBy has no
 * COUNT(DISTINCT ...) aggregate, so this groups by (serverId, chatId) — one
 * row per unique pair — and counts the non-null-chatId rows per serverId in
 * JS. Cheap in practice: bounded by the same date-range filter as every
 * other query on this page, and the row count here is "distinct chats", not
 * "distinct turns" (groupInteractionsByServer already gets the turn count).
 */
async function distinctChatCountsByServer(
  params: InteractionStatsParams,
): Promise<Map<string | null, number>> {
  const where = buildDateWhere(params);

  const grouped = await prisma.aIInteraction.groupBy({
    by: ["serverId", "chatId"],
    where: { ...where, chatId: { not: null } },
  });

  const counts = new Map<string | null, number>();
  for (const row of grouped) {
    counts.set(row.serverId, (counts.get(row.serverId) ?? 0) + 1);
  }
  return counts;
}

/** Raw DB aggregation only — grouped counts/sums per serverId that has interaction rows. */
async function groupInteractionsByServer(
  params: InteractionStatsParams,
): Promise<Map<string | null, Omit<ServerInteractionStat, "models">>> {
  const where = buildDateWhere(params);

  const [grouped, distinctChatCounts] = await Promise.all([
    prisma.aIInteraction.groupBy({
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
    }),
    distinctChatCountsByServer(params),
  ]);

  return new Map(
    grouped.map((row) => [
      row.serverId,
      {
        serverId: row.serverId,
        count: row._count._all,
        distinctChatCount: distinctChatCounts.get(row.serverId) ?? 0,
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
  distinctChatCount: 0,
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

/**
 * Interaction volume by UTC hour-of-day, across all servers/models (#1351 —
 * "peak usage hours" for overall workload balancing, not split per-server:
 * the issue asks for this as a fleet-wide signal, and a per-server x 24-hour
 * breakdown would be a lot of near-empty buckets on the admin UI for little
 * benefit). Always returns all 24 hours (0 count where there's no traffic)
 * so the UI can render a stable-width chart without special-casing gaps.
 *
 * Raw SQL: EXTRACT(HOUR FROM ...) has no Prisma groupBy equivalent — every
 * other aggregate in this file only ever groups by an existing column.
 */
export async function getPeakUsageHours(
  params: InteractionStatsParams = {},
): Promise<HourlyUsageStat[]> {
  const rows = await prisma.$queryRaw<Array<{ hour: number; count: bigint }>>(
    Prisma.sql`
      SELECT
        EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC')::int AS hour,
        COUNT(*)::bigint AS count
      FROM "ai_interactions"
      WHERE 1=1
        ${params.dateFrom ? Prisma.sql`AND "createdAt" >= ${params.dateFrom}` : Prisma.empty}
        ${params.dateTo ? Prisma.sql`AND "createdAt" <= ${params.dateTo}` : Prisma.empty}
      GROUP BY hour
    `,
  );

  const countByHour = new Map(rows.map((row) => [row.hour, Number(row.count)]));
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: countByHour.get(hour) ?? 0,
  }));
}
