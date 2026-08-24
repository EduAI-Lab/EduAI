/**
 * Phase 3 — carbon / quality tie-break policy for tier pool selection.
 *
 * Does not change tier prediction (kNN or rules); only how we pick among models in a tier.
 */
export type CarbonPolicyMode = "balanced" | "greener" | "quality";

const VALID_MODES: CarbonPolicyMode[] = ["balanced", "greener", "quality"];

export function parseCarbonPolicyMode(raw: string | undefined): CarbonPolicyMode {
  const v = raw?.trim().toLowerCase();
  if (v && VALID_MODES.includes(v as CarbonPolicyMode)) {
    return v as CarbonPolicyMode;
  }
  return "balanced";
}

/** Optional per-course override: `{"COSC 315":"greener"}` */
export function parseCarbonPolicyByCourse(raw: string | undefined): Map<string, CarbonPolicyMode> {
  if (!raw?.trim()) {
    return new Map();
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out = new Map<string, CarbonPolicyMode>();
    for (const [code, mode] of Object.entries(parsed)) {
      out.set(code.trim(), parseCarbonPolicyMode(mode));
    }
    return out;
  } catch {
    return new Map();
  }
}

export function resolveCarbonPolicyMode(params: {
  globalMode: CarbonPolicyMode;
  courseCode?: string | null;
  byCourse?: ReadonlyMap<string, CarbonPolicyMode>;
}): CarbonPolicyMode {
  const courseMode = params.courseCode ? params.byCourse?.get(params.courseCode) : undefined;
  return courseMode ?? params.globalMode;
}

/**
 * Map policy → tie-break for `pickModelForSpec`.
 * - greener: lowest carbon per token
 * - quality: lowest energy per token (proxy for “capable” local model in tier)
 * - balanced: tier 1 → energy, tier 2+ → carbon (matches Phase 1 rule defaults)
 */
export function tieBreakForTier(tier: 1 | 2 | 3, mode: CarbonPolicyMode): "energy" | "carbon" {
  if (mode === "greener") {
    return "carbon";
  }
  if (mode === "quality") {
    return "energy";
  }
  return tier === 1 ? "energy" : "carbon";
}
