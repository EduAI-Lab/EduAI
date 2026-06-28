/**
 * Display-only relabeling for Assistive mode assistant messages (#699).
 *
 * Policy and stored DB text keep **Top summary** / **Next?** for oversight metrics.
 * Apply at render time in ChatMessage only — never before persistence.
 */
export function transformAssistiveDisplayCopy(content: string): string {
  return content
    .replace(/\*\*Top summary\*\*/gi, "**TLDR**")
    .replace(/\*\*Next\?\*\*/g, "**Continue**")
    .replace(/^Next\?\s+/gm, "Continue: ");
}
