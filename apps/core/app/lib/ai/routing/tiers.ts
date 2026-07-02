/**
 * Tier pool & model selection from the database (routerTier enum).
 */

import type { RouterTier } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { isLocalVllmRouting, isVllmRegistryId } from "./local-vllm";

export type TierModelRow = {
  registryId: string;
  tier: 1 | 2 | 3;
  routerTier: RouterTier;
  estEnergyJoulesPerToken: number | null;
  averageCarbonGramsPerToken: number | null;
  supportsImages: boolean;
  supportsTools: boolean;
};

export type PickSpec =
  | {
      kind: "minTier";
      minTier: 2 | 3;
      requireImages?: boolean;
      requireTools?: boolean;
      tieBreak: "energy" | "carbon";
    }
  | { kind: "exactTier"; tier: 1 | 2 | 3; tieBreak: "energy" | "carbon" };

let cache: TierModelRow[] | null = null;
let loading: Promise<TierModelRow[]> | null = null;

export function routerTierToNum(t: RouterTier): 1 | 2 | 3 {
  if (t === "TIER_1") return 1;
  if (t === "TIER_2") return 2;
  return 3;
}

export function numToRouterTier(n: number): RouterTier | null {
  if (n === 1) return "TIER_1";
  if (n === 2) return "TIER_2";
  if (n === 3) return "TIER_3";
  return null;
}

async function loadCloudImageTierRows(): Promise<TierModelRow[]> {
  const rows = await prisma.aIModel.findMany({
    where: {
      isActive: true,
      supportsImages: true,
      provider: { name: { in: ["google", "openai"] } },
    },
    include: { provider: { select: { name: true } } },
  });

  return rows.map((r) => ({
    registryId: `${r.provider.name}:${r.modelId}`,
    tier: 2,
    routerTier: "TIER_2" as RouterTier,
    estEnergyJoulesPerToken: r.estEnergyJoulesPerToken,
    averageCarbonGramsPerToken: r.averageCarbonGramsPerToken,
    supportsImages: true,
    supportsTools: r.supportsTools,
  }));
}

async function loadTierRows(options?: { localVllmOnly?: boolean }): Promise<TierModelRow[]> {
  const rows = await prisma.aIModel.findMany({
    where: { isActive: true, routerTier: { not: null } },
    include: { provider: { select: { name: true } } },
  });

  const localVllmOnly = options?.localVllmOnly ?? isLocalVllmRouting();

  return rows
    .map((r) => ({
      registryId: `${r.provider.name}:${r.modelId}`,
      tier: routerTierToNum(r.routerTier!),
      routerTier: r.routerTier!,
      estEnergyJoulesPerToken: r.estEnergyJoulesPerToken,
      averageCarbonGramsPerToken: r.averageCarbonGramsPerToken,
      supportsImages: r.supportsImages,
      supportsTools: r.supportsTools,
    }))
    .filter((row) => !localVllmOnly || isVllmRegistryId(row.registryId));
}

export async function getCachedTierModels(): Promise<TierModelRow[]> {
  if (cache) {
    return cache;
  }
  if (!loading) {
    loading = loadTierRows().then((rows) => {
      if (rows.length > 0) {
        cache = rows;
      }
      loading = null;
      return rows;
    });
  }
  return loading;
}

export function invalidateTierModelCache(): void {
  cache = null;
  loading = null;
}

function sortKey(row: TierModelRow, tieBreak: "energy" | "carbon"): number {
  if (tieBreak === "carbon") {
    return row.averageCarbonGramsPerToken ?? Number.POSITIVE_INFINITY;
  }
  return row.estEnergyJoulesPerToken ?? Number.POSITIVE_INFINITY;
}

export function pickFromCandidates(rows: TierModelRow[], spec: PickSpec): TierModelRow | null {
  let filtered: TierModelRow[];

  if (spec.kind === "exactTier") {
    filtered = rows.filter((r) => r.tier === spec.tier);
  } else {
    filtered = rows.filter((r) => r.tier >= spec.minTier);
    if (spec.requireImages) {
      filtered = filtered.filter((r) => r.supportsImages);
    }
    if (spec.requireTools) {
      filtered = filtered.filter((r) => r.supportsTools);
    }
  }

  if (filtered.length === 0) {
    return null;
  }

  const ranked = [...filtered].sort((a, b) => {
    const ka = sortKey(a, spec.tieBreak);
    const kb = sortKey(b, spec.tieBreak);
    if (ka !== kb) {
      return ka - kb;
    }
    return a.registryId.localeCompare(b.registryId);
  });

  return ranked[0] ?? null;
}

export async function pickModelForSpec(spec: PickSpec): Promise<TierModelRow | null> {
  const needsCloudImages =
    isLocalVllmRouting() && spec.kind === "minTier" && spec.requireImages;
  const rows = needsCloudImages
    ? await loadCloudImageTierRows()
    : await getCachedTierModels();
  return pickFromCandidates(rows, spec);
}
