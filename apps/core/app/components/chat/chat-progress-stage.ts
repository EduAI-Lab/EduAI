/**
 * Honest in-flight progress for course chat (#1171).
 *
 * Stages are discrete (routing → waiting → tools → generating / Assist work).
 * Progress bookmarks are ordinal stage ranks for tests/UI data attrs — never
 * shown as a fake completion percentage.
 */

export type ChatProgressStageId =
  | "routing"
  | "waiting_for_model"
  | "searching_materials"
  | "searching_web"
  | "generating"
  | "preparing_assist";

export type ChatProgressStage = {
  id: ChatProgressStageId;
  label: string;
  /** Ordinal stage rank (0–100 scale); not a completion estimate. */
  progress: number;
};

const STAGE_BOOKMARK: Record<ChatProgressStageId, number> = {
  routing: 12,
  waiting_for_model: 32,
  searching_materials: 48,
  searching_web: 48,
  generating: 72,
  preparing_assist: 88,
};

const STAGE_LABEL: Record<ChatProgressStageId, string> = {
  routing: "Routing…",
  waiting_for_model: "Waiting for model…",
  searching_materials: "Searching course materials…",
  searching_web: "Searching the web…",
  generating: "Generating…",
  // Covers both slow TTFT and oversight buffering — not oversight-only.
  preparing_assist: "Working on Assist reply…",
};

/** Brief window before we assume the request has left the client. */
export const CHAT_PROGRESS_ROUTING_MS = 450;

/**
 * After this with Assist ON and no tokens yet, acknowledge the longer Assist
 * path (slow local TTFT and/or oversight buffering) instead of a silent wait.
 */
export const CHAT_PROGRESS_ASSIST_PREP_MS = 6_000;

/**
 * After assistant text stops changing for this long, treat the turn as an idle
 * multi-step gap and show a compact status row again.
 */
export const CHAT_PROGRESS_TEXT_IDLE_MS = 900;

export type ResolveChatProgressStageInput = {
  elapsedMs: number;
  hasAssistantText: boolean;
  hasRoutedModel: boolean;
  /** Active tool name from the in-flight assistant message, if any. */
  activeToolName: string | null;
  adhdAssist: boolean;
};

export function resolveChatProgressStage(
  input: ResolveChatProgressStageInput,
): ChatProgressStage {
  const id = resolveChatProgressStageId(input);
  return {
    id,
    label: STAGE_LABEL[id],
    progress: STAGE_BOOKMARK[id],
  };
}

export function resolveChatProgressStageId(
  input: ResolveChatProgressStageInput,
): ChatProgressStageId {
  const {
    elapsedMs,
    hasAssistantText,
    hasRoutedModel,
    activeToolName,
    adhdAssist,
  } = input;

  // In-progress tools win even when earlier tokens already exist (multi-step).
  const tool = activeToolName?.trim() ?? "";
  if (tool === "getInformation") {
    return "searching_materials";
  }
  if (tool === "webSearch" || tool === "fetchPage") {
    return "searching_web";
  }

  if (hasAssistantText) {
    return "generating";
  }

  if (adhdAssist && elapsedMs >= CHAT_PROGRESS_ASSIST_PREP_MS) {
    return "preparing_assist";
  }

  if (!hasRoutedModel && elapsedMs < CHAT_PROGRESS_ROUTING_MS) {
    return "routing";
  }

  return "waiting_for_model";
}

/** Format elapsed wait for ADHD-friendly predictability (e.g. "12s"). */
export function formatChatProgressElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

type MessageLike = {
  role?: string;
  content?: unknown;
  parts?: Array<{
    type?: string;
    text?: string;
    toolInvocation?: { toolName?: string; state?: string };
    toolName?: string;
    state?: string;
  } | null> | null;
};

function contentAsDisplayText(content: unknown): string {
  if (typeof content === "string") return content;
  if (
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    typeof (content as { text?: unknown }).text === "string"
  ) {
    return (content as { text: string }).text;
  }
  return "";
}

/** Stable fingerprint of visible assistant text for idle-gap detection. */
export function assistantTextFingerprint(
  message: MessageLike | null | undefined,
): string {
  if (!message || message.role !== "assistant") return "";

  const parts = message.parts;
  if (Array.isArray(parts)) {
    const texts: string[] = [];
    for (const part of parts) {
      if (
        part &&
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.length > 0
      ) {
        texts.push(part.text);
      }
    }
    if (texts.length > 0) return texts.join("\n");
  }

  return contentAsDisplayText(message.content);
}

/**
 * True when the last assistant turn already has visible text (streaming tokens
 * or a buffered dump).
 */
export function assistantMessageHasText(
  message: MessageLike | null | undefined,
): boolean {
  return assistantTextFingerprint(message).trim().length > 0;
}

/**
 * Best-effort *in-progress* tool name on the in-flight assistant message.
 * Completed tool cards must not keep the status row stuck on “Searching…”
 * (and must not block Assist’s later work stage).
 */
export function activeToolNameFromMessage(
  message: MessageLike | null | undefined,
): string | null {
  if (!message || message.role !== "assistant" || !Array.isArray(message.parts)) {
    return null;
  }

  for (const part of message.parts) {
    if (!part || typeof part.type !== "string") continue;

    if (part.type === "tool-invocation" && part.toolInvocation) {
      const name = part.toolInvocation.toolName?.trim();
      if (!name) continue;
      const state = part.toolInvocation.state;
      // AI SDK v4: call / partial-call while running; result when done.
      if (!state || state === "result") continue;
      return name;
    }

    if (part.type.startsWith("tool-")) {
      const name = (part.toolName || part.type.replace(/^tool-/, "")).trim();
      if (!name) continue;
      const state = part.state;
      if (
        !state ||
        state === "output-available" ||
        state === "output-error" ||
        state === "result"
      ) {
        continue;
      }
      return name;
    }
  }

  return null;
}

/**
 * True when any eduai-diagram fence was opened but not closed yet.
 * Checks each diagram open for a following closer (ignores other code fences).
 */
export function hasIncompleteEduaiDiagramFence(content: string): boolean {
  const openRe = /```eduai-diagram\b/gi;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(content)) !== null) {
    const bodyStart = match.index + match[0].length;
    const closer = content.indexOf("```", bodyStart);
    if (closer === -1) return true;
    // Continue scanning after this fence's closer so multiple diagrams work.
    openRe.lastIndex = closer + 3;
  }
  return false;
}

/**
 * Assist display transform is safe once the stream is idle, or when a full
 * Top summary + Next? pair is present without a half-open diagram fence.
 * Oversight dumps arrive whole; true mid-stream Assist should not reorder yet.
 */
export function shouldApplyAssistiveDisplayTransform(
  content: string,
  isStreaming: boolean,
): boolean {
  if (!isStreaming) return true;
  if (hasIncompleteEduaiDiagramFence(content)) return false;
  const hasTop = /\*\*Top summary\*\*/i.test(content);
  const hasNext = /\*\*Next\?\*\*/i.test(content);
  return hasTop && hasNext;
}
