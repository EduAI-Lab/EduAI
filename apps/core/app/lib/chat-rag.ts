export type HybridRagHit = { content: string; similarity: number; materialTitle: string };

/** Hybrid RAG + tool `getInformation`: pgvector row cap (default was 6). */
export const HYBRID_RAG_MAX_CHUNKS = 4;
/** Max characters from excerpts injected into hybrid `system` (non-tool models). */
export const HYBRID_RAG_MAX_CONTEXT_CHARS = 14_000;
/** Max characters per chunk returned to the model from `getInformation` (tool path). */
export const TOOL_RAG_MAX_CHARS_PER_CHUNK = 6000;
/** Minimum remaining chars before truncating the last hybrid RAG excerpt. */
export const HYBRID_RAG_MIN_TRUNCATE_CHARS = 120;

const DEFAULT_MAX_CONTEXT_MESSAGES = 20;
const DEFAULT_SESSION_RECENT_MESSAGES = 6;
/** Max total characters in `messages[]` before older turns are digested (#259). */
const DEFAULT_SESSION_CHAR_BUDGET = 28_000;
/** Max size of the synthetic digest block replacing older turns (#259). */
const DEFAULT_SESSION_DIGEST_MAX_CHARS = 14_000;
const MIN_SESSION_MESSAGES = 2;

const MAX_CONTEXT_MESSAGES_CEILING = 50;
const SESSION_CHAR_BUDGET_CEILING = 100_000;
const SESSION_DIGEST_MAX_CEILING = 50_000;

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

function readBoundedEnvInt(
  name: string,
  fallback: number,
  floor: number,
  ceiling: number,
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(ceiling, Math.max(floor, Math.floor(parsed)));
}

/** Message-count window loaded from DB and tail-trimmed before the model (env: CHAT_MAX_CONTEXT_MESSAGES). */
export function resolveMaxContextMessages(): number {
  return readBoundedEnvInt(
    "CHAT_MAX_CONTEXT_MESSAGES",
    DEFAULT_MAX_CONTEXT_MESSAGES,
    4,
    MAX_CONTEXT_MESSAGES_CEILING,
  );
}

/** Total char budget for `messages[]` sent to the model (env: CHAT_SESSION_MAX_CHARS). */
export function resolveSessionCharBudget(): number {
  return readBoundedEnvInt(
    "CHAT_SESSION_MAX_CHARS",
    DEFAULT_SESSION_CHAR_BUDGET,
    2_000,
    SESSION_CHAR_BUDGET_CEILING,
  );
}

/** Verbatim tail preserved when older turns are digested (env: CHAT_SESSION_RECENT_MESSAGES). */
export function resolveSessionRecentMessages(): number {
  return readBoundedEnvInt(
    "CHAT_SESSION_RECENT_MESSAGES",
    DEFAULT_SESSION_RECENT_MESSAGES,
    MIN_SESSION_MESSAGES,
    MAX_CONTEXT_MESSAGES_CEILING,
  );
}

/** Cap on the synthetic digest block (env: CHAT_SESSION_DIGEST_MAX_CHARS). */
export function resolveSessionDigestMaxChars(): number {
  return readBoundedEnvInt(
    "CHAT_SESSION_DIGEST_MAX_CHARS",
    DEFAULT_SESSION_DIGEST_MAX_CHARS,
    500,
    SESSION_DIGEST_MAX_CEILING,
  );
}

function totalMessageChars<T extends Record<string, unknown>>(
  messages: T[],
  extractText: (message?: T) => string,
): number {
  return messages.reduce((sum, message) => sum + extractText(message).length, 0);
}

function buildSessionDigest<T extends Record<string, unknown>>(
  messages: T[],
  extractText: (message?: T) => string,
  maxDigestChars: number,
): string {
  const lines: string[] = [];

  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "unknown";
    const normalized = extractText(message).replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }
    const preview =
      normalized.length > 200 ? `${normalized.slice(0, 200)}…` : normalized;
    lines.push(`- **${role}**: ${preview}`);
  }

  if (lines.length === 0) {
    return "";
  }

  const header = "## Session digest (earlier turns)\n\n";
  return truncateToMaxChars(`${header}${lines.join("\n")}`, maxDigestChars);
}

/**
 * Form A §3b (#259): when chat history exceeds the char budget, replace older
 * turns with a short digest and keep the recent tail verbatim. DB/UI unchanged.
 */
export function prepareBoundedSessionContext<T extends Record<string, unknown>>(
  messages: T[],
  extractText: (message?: T) => string,
  opts?: {
    charBudget?: number;
    recentCount?: number;
    digestMaxChars?: number;
  },
): T[] {
  if (messages.length === 0) {
    return messages;
  }

  const charBudget = opts?.charBudget ?? resolveSessionCharBudget();
  const recentCount = opts?.recentCount ?? resolveSessionRecentMessages();
  const digestMaxChars = opts?.digestMaxChars ?? resolveSessionDigestMaxChars();

  if (totalMessageChars(messages, extractText) <= charBudget) {
    return messages;
  }

  const recent = messages.slice(-recentCount);
  const older = messages.slice(0, -recentCount);

  if (older.length === 0) {
    let trimmed = [...messages];
    while (
      trimmed.length > MIN_SESSION_MESSAGES &&
      totalMessageChars(trimmed, extractText) > charBudget
    ) {
      trimmed = trimmed.slice(1);
    }
    return trimmed;
  }

  const digest = buildSessionDigest(older, extractText, digestMaxChars);
  const digestMessage = {
    id: "session-digest",
    role: "user",
    content:
      digest ||
      "## Session digest (earlier turns)\n\n(Earlier turns summarized for length.)",
  } as unknown as T;

  return [digestMessage, ...recent];
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
