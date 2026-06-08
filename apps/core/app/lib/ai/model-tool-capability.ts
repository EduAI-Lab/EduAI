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

/** Heuristic: sub-4B parameter models are not tool-capable in practice. */
export function isSmallModelSlug(modelId: string): boolean {
  return SMALL_MODEL_PATTERNS.some((pattern) => pattern.test(modelId));
}

/** Admin UI: only CHAT models above the small-model threshold may toggle supportsTools. */
export function allowsSupportsToolsToggle(modelId: string, type: string): boolean {
  if (type !== "CHAT") return false;
  if (!modelId.trim()) return false;
  return !isSmallModelSlug(modelId);
}
