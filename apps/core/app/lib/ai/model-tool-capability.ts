const SMALL_MODEL_PATTERNS = [
  /(^|:|\/)0\.5b($|:|\b)/i,
  /(^|:|\/)1b($|:|\b)/i,
  /(^|:|\/)1\.5b($|:|\b)/i,
  /(^|:|\/)1\.7b($|:|\b)/i,
  /(^|:|\/)2b($|:|\b)/i,
  /(^|:|\/)3b($|:|\b)/i,
  /phi-?3[:.]mini/i,
  /tinyllama/i,
  /gemma2:2b/i,
  /gemma:2b/i,
];

/** Legacy slug heuristic (migration backfill only — not used for admin gating). */
export function isSmallModelSlug(modelId: string): boolean {
  return SMALL_MODEL_PATTERNS.some((pattern) => pattern.test(modelId));
}

/** Admin UI: only CHAT models may toggle supportsTools. */
export function allowsSupportsToolsToggle(_modelId: string, type: string): boolean {
  if (type !== "CHAT") return false;
  return true;
}
