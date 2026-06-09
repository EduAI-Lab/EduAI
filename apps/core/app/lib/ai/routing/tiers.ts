/**
 * Tier pool & model selection from the database.
 *
 * Reads active `AIModel` rows that have a non-null **`tier`** (seeded for the routing MVP). Caches them in-memory for the
 * lifetime of the Node process (`invalidateTierModelCache` clears after tier edits without restart).
 *
 * Exposes **`PickSpec`** (filter + tie-break strategy) and **`pickModelForSpec`** so **`rules.ts` / `router.ts`** never
 * duplicate SQL or sorting: tie-break is either lowest **`estEnergyJoulesPerToken`** or lowest **`averageCarbonGramsPerToken`**
 * depending on the rule (see MVP plan Step 05).
 */

import prisma from "~/lib/prisma.server";

/**
 * Slim view of `AIModel` + provider name for routing tie-breaks.
 * Loaded from the DB (seeded tier, energy, carbon, capability flags).
 */
export type TierModelRow = {
  registryId: string;
  tier: number;
  estEnergyJoulesPerToken: number | null;
  averageCarbonGramsPerToken: number | null;
  supportsImages: boolean;
  supportsTools: boolean;
};

/**
 * How to filter and rank candidates from the tier pool.
 * - `minTier`: tiers **>=** `minTier` (Phase 1 uses 2 for image/tool rules so Tier 3 can fall back).
 * - `exactTier`: only that tier (e.g. short-factual → Tier 1; long RAG → Tier 2).
 * - `tieBreak`: `energy` → lowest `estEnergyJoulesPerToken`; `carbon` → lowest `averageCarbonGramsPerToken`
 *   (plan: default / long-RAG Tier-2 paths prefer lowest g CO₂/token, e.g. local Gemma on BC grid).
 */
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

async function loadTierRows(): Promise<TierModelRow[]> {
  const rows = await prisma.aIModel.findMany({
    where: { isActive: true, tier: { not: null } },
    include: { provider: { select: { name: true } } },
  });

  return rows.map((r) => ({
    registryId: `${r.provider.name}:${r.modelId}`,
    tier: r.tier!,
    estEnergyJoulesPerToken: r.estEnergyJoulesPerToken,
    averageCarbonGramsPerToken: r.averageCarbonGramsPerToken,
    supportsImages: r.supportsImages,
    supportsTools: r.supportsTools,
  }));
}

/**
 * Cached slice of tiered models (refreshes on first use per process).
 * Call `invalidateTierModelCache` after changing tier assignments in DB without restart.
 */
export async function getCachedTierModels(): Promise<TierModelRow[]> {
  if (cache) {
    return cache;
  }
  if (!loading) {
    loading = loadTierRows().then((rows) => {
      cache = rows;
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

/** Rank in-process (do not mutate caller arrays). */
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

/** Load from DB cache, then apply `PickSpec`. */
export async function pickModelForSpec(spec: PickSpec): Promise<TierModelRow | null> {
  const rows = await getCachedTierModels();
  return pickFromCandidates(rows, spec);
}
