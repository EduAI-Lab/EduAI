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
export function parseCarbonPolicyByCourse(
  raw: string | undefined,
): Record<string, CarbonPolicyMode> {
  if (!raw?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, CarbonPolicyMode> = {};
    for (const [code, mode] of Object.entries(parsed)) {
      out[code.trim()] = parseCarbonPolicyMode(mode);
    }
    return out;
  } catch {
    return {};
  }
}

export function resolveCarbonPolicyMode(params: {
  globalMode: CarbonPolicyMode;
  courseCode?: string | null;
  byCourse?: Record<string, CarbonPolicyMode>;
}): CarbonPolicyMode {
  if (params.courseCode && params.byCourse?.[params.courseCode]) {
    return params.byCourse[params.courseCode];
  }
  return params.globalMode;
}

/**
 * Map policy → tie-break for `pickModelForSpec`.
 * - greener: lowest carbon per token
 * - quality: lowest energy per token (proxy for “capable” local model in tier)
 * - balanced: tier 1 → energy, tier 2+ → carbon (matches Phase 1 rule defaults)
 */
export function tieBreakForTier(
  tier: 1 | 2 | 3,
  mode: CarbonPolicyMode,
): "energy" | "carbon" {
  if (mode === "greener") {
    return "carbon";
  }
  if (mode === "quality") {
    return "energy";
  }
  return tier === 1 ? "energy" : "carbon";
}
