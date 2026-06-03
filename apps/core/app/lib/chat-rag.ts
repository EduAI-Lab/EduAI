export type HybridRagHit = { content: string; similarity: number; materialTitle: string };

/** Hybrid RAG + tool `getInformation`: pgvector row cap (default was 6). */
export const HYBRID_RAG_MAX_CHUNKS = 4;
/** Max characters from excerpts injected into hybrid `system` (non-tool models). */
export const HYBRID_RAG_MAX_CONTEXT_CHARS = 14_000;
/** Max characters per chunk returned to the model from `getInformation` (tool path). */
export const TOOL_RAG_MAX_CHARS_PER_CHUNK = 6000;
/** Minimum remaining chars before truncating the last hybrid RAG excerpt. */
export const HYBRID_RAG_MIN_TRUNCATE_CHARS = 120;

const TOOL_RESULT_MAX_CHARS_FLOOR = 500;
const TOOL_RESULT_MAX_CHARS_CEILING = 50_000;

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

export function truncateToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

function capStringsInValue(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") {
    return truncateToMaxChars(value, maxChars);
  }

  if (Array.isArray(value)) {
    return value.map((item) => capStringsInValue(item, maxChars));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const capped: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      capped[key] = capStringsInValue(nested, maxChars);
    }
    return capped;
  }

  return value;
}

/**
 * Truncates oversized strings inside assistant/tool messages before `streamText`.
 * User turns are left unchanged. Does not mutate DB-stored history.
 */
export function capToolResultsInMessages<T extends Record<string, unknown>>(
  messages: T[],
  maxCharsPerResult?: number,
): T[] {
  const maxChars = maxCharsPerResult ?? resolveToolResultMaxChars();

  return messages.map((message) => {
    const role = message.role;
    if (role !== "assistant" && role !== "tool") {
      return message;
    }

    return capStringsInValue(message, maxChars) as T;
  });
}

/** Top-similarity first; stops at chunk count and char budget for local LLM prefill. */
export function buildCappedRagContextText(
  hits: HybridRagHit[],
  maxChunks: number,
  maxChars: number,
): string {
  const slice = hits.slice(0, maxChunks);
  const sep = "\n\n---\n\n";
  const parts: string[] = [];
  let total = 0;

  for (const item of slice) {
    const header = `**Source**: ${item.materialTitle || "Course Material"}\n`;
    const body = item.content;
    const overhead = parts.length === 0 ? 0 : sep.length;
    const fullLen = header.length + body.length;

    if (total + overhead + fullLen <= maxChars) {
      parts.push(header + body);
      total += overhead + fullLen;
      continue;
    }

    const room = maxChars - total - overhead - header.length;
    if (room > HYBRID_RAG_MIN_TRUNCATE_CHARS) {
      parts.push(`${header}${body.slice(0, room)}…`);
    }
    break;
  }

  return parts.join(sep);
}

/** Shrink tool payloads so a single `getInformation` call cannot flood the next model step. */
export function capRagHitsForTool(hits: HybridRagHit[]): HybridRagHit[] {
  const maxChars = resolveToolResultMaxChars();
  return hits.slice(0, HYBRID_RAG_MAX_CHUNKS).map((h) => ({
    ...h,
    content: truncateToMaxChars(h.content, maxChars),
  }));
}
