/**
 * Pick an eduai-diagram catalog type from learner + draft text.
 * Default is process-flow so any topic still gets a real animation.
 */

export const EDUAI_DIAGRAM_CANONICAL_IDS = [
  "process-flow",
  "gradient-descent",
  "hierarchy",
  "compare",
] as const;

export type EduaiDiagramCanonicalId = (typeof EDUAI_DIAGRAM_CANONICAL_IDS)[number];

const GRADIENT_PATTERN =
  /\b(gradient\s*descent|loss\s*surface|learning\s*rate|minimi[sz]e\s+(the\s+)?(loss|cost)|optimizer|stochastic\s+gradient)\b/i;

const HIERARCHY_PATTERN =
  /\b(hierarch|taxonomy|tree\s+structure|org\s*chart|parent|child\s+nodes?|breakdown|outline\s+structure|parts?\s+of)\b/i;

const COMPARE_PATTERN =
  /\b(compar(e|ison|ing)|versus|\bvs\.?\b|difference\s+between|contrast|pros?\s+and\s+cons?)\b/i;

const TYPE_ALIASES: Record<string, EduaiDiagramCanonicalId> = {
  gd: "gradient-descent",
  gradient: "gradient-descent",
  process: "process-flow",
  flow: "process-flow",
  steps: "process-flow",
  tree: "hierarchy",
  structure: "hierarchy",
  vs: "compare",
  contrast: "compare",
};

/**
 * Map a fence type token / alias to a canonical id, or null if unknown.
 * Does not fall back to process-flow — use for parse gating so bare labels
 * like "Start" are not swallowed as type ids.
 */
export function matchExplicitDiagramTypeId(
  raw: string,
): EduaiDiagramCanonicalId | null {
  const explicit = raw.trim().toLowerCase().replace(/_/g, "-");
  if (!explicit) return null;
  if ((EDUAI_DIAGRAM_CANONICAL_IDS as readonly string[]).includes(explicit)) {
    return explicit as EduaiDiagramCanonicalId;
  }
  return TYPE_ALIASES[explicit] ?? null;
}

export function resolveEduaiDiagramTypeId(args: {
  userText?: string;
  draftText?: string;
  explicitTypeId?: string;
}): EduaiDiagramCanonicalId {
  const matched = matchExplicitDiagramTypeId(args.explicitTypeId ?? "");
  if (matched) return matched;

  const haystack = `${args.userText ?? ""}\n${args.draftText ?? ""}`;

  if (GRADIENT_PATTERN.test(haystack)) return "gradient-descent";
  if (HIERARCHY_PATTERN.test(haystack)) return "hierarchy";
  if (COMPARE_PATTERN.test(haystack)) return "compare";

  return "process-flow";
}

/** Shared fence detection used by assist policy, split, and display transform. */
export function hasEduaiDiagramFence(text: string): boolean {
  return /```eduai-diagram\b/i.test(text ?? "");
}

/** Global regex for splitting / extracting eduai-diagram fences (reset lastIndex). */
export const EDUAI_DIAGRAM_FENCE_GLOBAL =
  /```eduai-diagram[^\n]*\r?\n([\s\S]*?)```/gi;
