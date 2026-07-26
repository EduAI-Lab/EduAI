/**
 * Honest in-flight progress for course chat (#1171).
 *
 * Stages are discrete (routing → waiting → tools → generating / Assist prep).
 * Progress values are stage bookmarks — not a fake wall-clock percentage —
 * so slow local models (Qwen 32B) and Assist oversight buffering still feel
 * alive without implying a precise ETA.
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
  /** Stage bookmark in 0–100; not an estimated completion %. */
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
  preparing_assist: "Preparing Assist reply…",
};

/** Brief window before we assume the request has left the client. */
export const CHAT_PROGRESS_ROUTING_MS = 450;

/**
 * After this with Assist ON and no tokens yet, the UI acknowledges the
 * buffered oversight path (draft + audit) instead of a silent wait.
 */
export const CHAT_PROGRESS_ASSIST_PREP_MS = 6_000;

export type ResolveChatProgressStageInput = {
  elapsedMs: number;
  hasAssistantText: boolean;
  hasRoutedModel: boolean;
  /** Active tool name from the in-flight assistant message, if any. */
  activeToolName: string | null;
  adhdAssist: boolean;
};

export function labelForChatProgressStage(id: ChatProgressStageId): string {
  return STAGE_LABEL[id];
}

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

  if (hasAssistantText) {
    return "generating";
  }

  const tool = activeToolName?.trim() ?? "";
  if (tool === "getInformation") {
    return "searching_materials";
  }
  if (tool === "webSearch" || tool === "fetchPage") {
    return "searching_web";
  }

  if (
    adhdAssist &&
    elapsedMs >= CHAT_PROGRESS_ASSIST_PREP_MS
  ) {
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
  parts?: Array<{ type?: string; text?: string; toolInvocation?: { toolName?: string; state?: string }; toolName?: string; state?: string } | null> | null;
};

/**
 * True when the last assistant turn already has visible text (streaming tokens
 * or a buffered dump). Used to hide the status row once tokens speak for themselves.
 */
export function assistantMessageHasText(message: MessageLike | null | undefined): boolean {
  if (!message || message.role !== "assistant") return false;

  const parts = message.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (
        part &&
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0
      ) {
        return true;
      }
    }
  }

  if (typeof message.content === "string") {
    return message.content.trim().length > 0;
  }

  return false;
}

/**
 * Best-effort active tool name on the in-flight assistant message.
 * Prefers incomplete tool invocations so status can mirror Tool cards.
 */
export function activeToolNameFromMessage(
  message: MessageLike | null | undefined,
): string | null {
  if (!message || message.role !== "assistant" || !Array.isArray(message.parts)) {
    return null;
  }

  let fallback: string | null = null;

  for (const part of message.parts) {
    if (!part || typeof part.type !== "string") continue;

    if (part.type === "tool-invocation" && part.toolInvocation) {
      const name = part.toolInvocation.toolName?.trim();
      if (!name) continue;
      const state = part.toolInvocation.state;
      if (state && state !== "result") return name;
      fallback = fallback ?? name;
      continue;
    }

    if (part.type.startsWith("tool-")) {
      const name = (part.toolName || part.type.replace(/^tool-/, "")).trim();
      if (!name) continue;
      const state = part.state;
      if (
        state &&
        state !== "output-available" &&
        state !== "output-error" &&
        state !== "result"
      ) {
        return name;
      }
      fallback = fallback ?? name;
    }
  }

  return fallback;
}

/**
 * Assist display transform is safe once the stream is idle, or when a full
 * Top summary + Next? pair is already present (oversight dumps arrive whole).
 * Avoids flashing a half-reordered layout on true mid-stream Assist text.
 */
export function shouldApplyAssistiveDisplayTransform(
  content: string,
  isStreaming: boolean,
): boolean {
  if (!isStreaming) return true;
  const hasTop = /\*\*Top summary\*\*/i.test(content);
  const hasNext = /\*\*Next\?\*\*/i.test(content);
  return hasTop && hasNext;
}
