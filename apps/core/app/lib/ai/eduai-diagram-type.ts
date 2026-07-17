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

export function resolveEduaiDiagramTypeId(args: {
  userText?: string;
  draftText?: string;
  explicitTypeId?: string;
}): EduaiDiagramCanonicalId {
  const explicit = (args.explicitTypeId ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (explicit && (EDUAI_DIAGRAM_CANONICAL_IDS as readonly string[]).includes(explicit)) {
    return explicit as EduaiDiagramCanonicalId;
  }

  // Aliases the model might emit
  if (explicit === "gd" || explicit === "gradient") return "gradient-descent";
  if (explicit === "process" || explicit === "flow" || explicit === "steps") return "process-flow";
  if (explicit === "tree" || explicit === "structure") return "hierarchy";
  if (explicit === "vs" || explicit === "contrast") return "compare";

  const haystack = `${args.userText ?? ""}\n${args.draftText ?? ""}`;

  if (GRADIENT_PATTERN.test(haystack)) return "gradient-descent";
  if (HIERARCHY_PATTERN.test(haystack)) return "hierarchy";
  if (COMPARE_PATTERN.test(haystack)) return "compare";

  return "process-flow";
}

/** @deprecated Prefer buildEduaiDiagramFence from eduai-diagram-payload (supports stages). */
export function buildEduaiDiagramFence(typeId: string): string {
  const id = resolveEduaiDiagramTypeId({ explicitTypeId: typeId });
  return ["```eduai-diagram", id, "```"].join("\n");
}
