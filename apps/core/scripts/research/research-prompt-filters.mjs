/** Exclude prompts that require live web tools (unavailable / unstable in research). */

export const RESEARCH_EXCLUDED_TOOL_TYPES = new Set(["webSearch", "fetchPage"]);

export function isResearchExcludedToolPrompt(row) {
  return RESEARCH_EXCLUDED_TOOL_TYPES.has(row?.tools_expected);
}

/** Active prompts eligible for policy / adequacy / classroom research batches. */
export function isResearchActivePrompt(row) {
  if (!row || typeof row !== "object") return false;
  if (row.active === false) return false;
  if (isResearchExcludedToolPrompt(row)) return false;
  return true;
}

export function filterResearchActivePrompts(prompts) {
  const all = Array.isArray(prompts) ? prompts : [];
  const active = all.filter(isResearchActivePrompt);
  const skipped = all.length - active.length;
  return { active, skipped, excludedToolIds: all.filter(isResearchExcludedToolPrompt).map((r) => r.id) };
}
