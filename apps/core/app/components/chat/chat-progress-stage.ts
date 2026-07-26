/**
 * Honest in-flight progress for course chat (#1171).
 *
 * Stages are discrete (routing → waiting → tools → generating / Assist work).
 * The progress bar fills against an *expected* response duration for the
 * selected / routed model (plus Assist / tools), so ADHD users can see how
 * close they are — without claiming a precise model-internal %.
 *
 * The bar never reaches 100% while the request is still in flight; if the wait
 * exceeds the estimate it crawls toward a soft cap and the copy switches to
 * “Taking longer than usual”.
 */

export type ChatProgressStageId =
  | "routing"
  | "waiting_for_model"
  | "searching_materials"
  | "searching_web"
  | "working"
  | "generating"
  | "preparing_assist";

export type ChatProgressStage = {
  id: ChatProgressStageId;
  label: string;
  /**
   * Soft floor for the timed bar when this stage is active (0–100).
   * Combined with elapsed/expected so stage changes still feel like progress.
   */
  progress: number;
};

/** Soft stage floors — timed elapsed/expected is the primary fill signal. */
const STAGE_FLOOR: Record<ChatProgressStageId, number> = {
  routing: 8,
  waiting_for_model: 18,
  searching_materials: 38,
  searching_web: 38,
  working: 42,
  generating: 58,
  preparing_assist: 48,
};

/** Cap while the request is still in flight (never imply "done"). */
export const CHAT_PROGRESS_IN_FLIGHT_CAP = 96;

const STAGE_LABEL: Record<ChatProgressStageId, string> = {
  routing: "Routing…",
  waiting_for_model: "Waiting for model…",
  searching_materials: "Searching course materials…",
  searching_web: "Searching the web…",
  working: "Working…",
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

export type ResolveChatProgressStageInput = {
  elapsedMs: number;
  hasAssistantText: boolean;
  hasRoutedModel: boolean;
  /** Active tool name from the in-flight assistant message, if any. */
  activeToolName: string | null;
  adhdAssist: boolean;
  /**
   * True while we are waiting for the next model tokens after a tool finished
   * (multi-step gap). Keeps compact status without using inter-token idle.
   */
  awaitingFollowup?: boolean;
};

export function resolveChatProgressStage(
  input: ResolveChatProgressStageInput,
): ChatProgressStage {
  const id = resolveChatProgressStageId(input);
  return {
    id,
    label: STAGE_LABEL[id],
    progress: STAGE_FLOOR[id],
  };
}

export type EstimateExpectedResponseMsInput = {
  /** Picker id and/or X-Routed-Model registry id. */
  modelId?: string | null;
  adhdAssist: boolean;
  hasActiveTool?: boolean;
};

/**
 * Typical wall-clock wait for a full turn. Tuned for ADHD predictability from
 * Week 12 latency notes (cloud fast; local 32B + Assist oversight slow).
 * Not a guarantee — the UI labels it as “about” / “usually”.
 *
 * Do not shrink this for post-tool follow-up: elapsed is measured from the
 * start of the request, so a shorter “total expected” would falsely trip
 * “Taking longer than usual”. Use {@link estimateFollowupRemainingMs} + a
 * deadline rebase in the hook instead.
 */
export function estimateExpectedResponseMs(
  input: EstimateExpectedResponseMsInput,
): number {
  const model = (input.modelId ?? "").toLowerCase();
  let baseMs = 18_000;

  if (
    model.startsWith("google:") ||
    model.startsWith("openai:") ||
    model.startsWith("anthropic:") ||
    model.includes("gemini") ||
    model.includes("gpt-")
  ) {
    baseMs = 8_000;
  } else if (
    model.includes("32b") ||
    model.includes("70b") ||
    model.includes("72b")
  ) {
    baseMs = 40_000;
  } else if (
    model.startsWith("vllm:") ||
    model.startsWith("ollama:") ||
    model.includes("qwen")
  ) {
    baseMs = 22_000;
  } else if (model === "auto" || model.length === 0) {
    baseMs = 20_000;
  }

  if (input.adhdAssist) {
    // Oversight buffering + denser Assist drafts.
    baseMs = Math.round(baseMs * 1.45 + 6_000);
  }
  if (input.hasActiveTool) {
    baseMs += 8_000;
  }

  return baseMs;
}

/**
 * Remaining stretch after a tool finishes and we wait for the next tokens.
 * Applied as `elapsed + remaining` deadline — never as a full-turn rewrite.
 */
export function estimateFollowupRemainingMs(input: {
  modelId?: string | null;
  adhdAssist: boolean;
}): number {
  const full = estimateExpectedResponseMs({
    modelId: input.modelId,
    adhdAssist: input.adhdAssist,
    hasActiveTool: false,
  });
  // Short post-tool gap; floor so the bar still has room to move.
  return Math.max(8_000, Math.min(16_000, Math.round(full * 0.28)));
}

export type TimedChatProgress = {
  /** 0–96 while in flight. */
  percent: number;
  /** Typical full-turn estimate for “Usually ~Ys” (not the follow-up deadline). */
  expectedMs: number;
  remainingMs: number;
  isOverExpected: boolean;
  /** Right-rail copy: "About 8s left" / "Taking longer than usual". */
  timingLabel: string;
};

/**
 * Map elapsed time onto a calming ease-out fill toward a deadline.
 *
 * `deadlineMs` is the wall-clock target for this wait (full-turn estimate, or
 * rebased `elapsed + followupRemaining` after a tool). `typicalExpectedMs` is
 * only for the “Usually ~” label.
 *
 * `peakPercent` keeps the bar from sliding backwards when the estimate grows
 * (tool starts, slower routed model).
 */
export function computeTimedChatProgress(input: {
  elapsedMs: number;
  /** Absolute elapsed target used for fill + remaining. */
  deadlineMs: number;
  /** Shown as “Usually ~Ys”; defaults to deadlineMs. */
  typicalExpectedMs?: number;
  stageFloor?: number;
  /** Prior fill — bar is monotonic within a turn. */
  peakPercent?: number;
}): TimedChatProgress {
  const elapsedMs = Math.max(0, input.elapsedMs);
  const deadlineMs = Math.max(1_000, input.deadlineMs);
  const typicalExpectedMs = Math.max(
    1_000,
    input.typicalExpectedMs ?? deadlineMs,
  );
  const stageFloor = Math.max(0, Math.min(90, input.stageFloor ?? 0));
  const peakPercent = Math.max(0, input.peakPercent ?? 0);

  const ratio = elapsedMs / deadlineMs;
  let timed: number;
  if (ratio <= 1) {
    // Ease-out: early movement (engagement) then slower approach to ~88%.
    const eased = 1 - (1 - ratio) * (1 - ratio);
    timed = eased * 88;
  } else {
    const over = ratio - 1;
    timed = 88 + (1 - Math.exp(-over)) * (CHAT_PROGRESS_IN_FLIGHT_CAP - 88);
  }

  const percent = Math.min(
    CHAT_PROGRESS_IN_FLIGHT_CAP,
    Math.max(stageFloor, peakPercent, Math.round(timed)),
  );
  const remainingMs = Math.max(0, deadlineMs - elapsedMs);
  const isOverExpected = elapsedMs > deadlineMs;

  return {
    percent,
    expectedMs: typicalExpectedMs,
    remainingMs,
    isOverExpected,
    timingLabel: isOverExpected
      ? "Taking longer than usual"
      : `About ${formatChatProgressRemaining(remainingMs)} left`,
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
    awaitingFollowup = false,
  } = input;

  // In-progress tools win even when earlier tokens already exist (multi-step).
  const tool = activeToolName?.trim() ?? "";
  if (tool === "getInformation") {
    return "searching_materials";
  }
  if (tool === "webSearch" || tool === "fetchPage") {
    return "searching_web";
  }
  if (tool) {
    return "working";
  }

  // Post-tool gap before the next tokens — keep an honest generating label.
  if (awaitingFollowup) {
    return "generating";
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

/**
 * Format remaining wait. Ceils so sub-second leftovers never show “About 0s left”
 * while the request is still in flight under the deadline.
 */
export function formatChatProgressRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return "0s";
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
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

/** Stable fingerprint of visible assistant text for follow-up detection. */
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
