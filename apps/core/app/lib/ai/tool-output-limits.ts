/**
 * Shared character limits for tool outputs (#260).
 *
 * These caps keep a single tool result (web page markdown, RAG chunk, etc.) from
 * flooding the model's context. They live here — rather than in `chat-rag.ts` —
 * so leaf tools like `fetch-page.ts` can import them without pulling in session
 * digest / hybrid RAG logic.
 */

/** Default per-result cap shared by `fetchPage`, `getInformation`, and reloaded tool messages. */
export const TOOL_RAG_MAX_CHARS_PER_CHUNK = 6000;

const TOOL_RESULT_MAX_CHARS_FLOOR = 500;
const TOOL_RESULT_MAX_CHARS_CEILING = 50_000;

/**
 * Resolves the active tool-result cap, honoring the `CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK`
 * override and clamping it into a safe range.
 */
export function resolveToolResultMaxChars(): number {
  const parsed = Number(process.env.CHAT_TOOL_RAG_MAX_CHARS_PER_CHUNK);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return TOOL_RAG_MAX_CHARS_PER_CHUNK;
  }
  return Math.min(
    TOOL_RESULT_MAX_CHARS_CEILING,
    Math.max(TOOL_RESULT_MAX_CHARS_FLOOR, Math.floor(parsed)),
  );
}

/**
 * Truncates `text` to `maxChars`, appending a single-character ellipsis marker.
 *
 * Convention (project-wide): when truncation happens the result is `maxChars + 1`
 * characters — `maxChars` of content plus the `…` marker. This matches
 * `capRagHitsForTool` and `buildCappedRagContextText`, so a "6000" cap yields a
 * 6001-char string. Use this for tool-output caps; for hard budget enforcement
 * (result length must be `<= cap`) use the internal strict truncation in
 * `chat-rag.ts`.
 */
export function truncateToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}
