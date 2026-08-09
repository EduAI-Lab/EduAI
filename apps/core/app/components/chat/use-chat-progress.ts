import { useEffect, useRef, useState } from "react";

import {
  activeToolNameFromMessage,
  assistantMessageHasText,
  assistantTextFingerprint,
  estimateExpectedResponseMs,
  estimateFollowupRemainingMs,
  resolveAwaitingFollowup,
} from "~/components/chat/chat-progress-stage";

type MessageLike = {
  id?: string;
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

type ProgressEdgeRef = {
  hasActiveTool: boolean;
  fingerprint: string;
  awaitingFollowup: boolean;
};

/**
 * Derives in-flight chat progress *inputs* for the typing indicator.
 *
 * Deliberately does **not** tick elapsed time here: a 250ms interval in this
 * hook (called from `ChatConversationLayout`) would re-render every message /
 * Streamdown / KaTeX / diagram in the thread 4×/sec. Elapsed + bar fill tick
 * locally inside `ChatTypingIndicator` from `startedAt` instead.
 *
 * Multi-step gaps are gated on tool activity (active tool, or waiting for the
 * next tokens after a tool completes) — not on inter-token silence — so slow
 * local models do not flicker a compact status between streamed tokens.
 *
 * The progress deadline is derived from the typical model / Assist wait
 * (extended when tools run; rebased to a short remaining window after a tool
 * finishes) so ADHD users can see how close they are.
 */
export function useChatProgress(args: {
  isLoading: boolean;
  messages: MessageLike[];
  adhdAssist: boolean;
  selectedModel?: string | null;
  streamingRoutedRegistryId?: string | null;
}): {
  /** Wall-clock start of the in-flight turn; null when idle. */
  startedAt: number | null;
  /** Absolute elapsed target for fill + “About Xs left”. */
  deadlineMs: number;
  typicalExpectedMs: number;
  hasAssistantText: boolean;
  hasRoutedModel: boolean;
  activeToolName: string | null;
  awaitingFollowup: boolean;
  showProgressIndicator: boolean;
  /** Slimmer row under an already-streaming assistant bubble (multi-step). */
  compactProgress: boolean;
} {
  const {
    isLoading,
    messages,
    adhdAssist,
    selectedModel = null,
    streamingRoutedRegistryId = null,
  } = args;

  const [startedAt, setStartedAt] = useState<number | null>(null);
  /** Monotonic wall-clock target for fill + “About Xs left”. */
  const [deadlineMs, setDeadlineMs] = useState(0);
  const edgeRef = useRef<ProgressEdgeRef>({
    hasActiveTool: false,
    fingerprint: "",
    awaitingFollowup: false,
  });
  const wasAwaitingFollowupRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  startedAtRef.current = startedAt;
  /**
   * Picker value snapshotted at request start. The model picker stays
   * enabled while loading, so without this the live `selectedModel` would
   * retroactively change the estimate for a request already in flight —
   * before `X-Routed-Model` arrives, `modelId` must stay pinned to whatever
   * was selected when the request started.
   */
  const frozenSelectedModelRef = useRef<string | null>(null);

  const lastMessage = messages[messages.length - 1] as MessageLike | undefined;
  const inFlightAssistant =
    isLoading && lastMessage?.role === "assistant" ? lastMessage : null;
  const hasAssistantText = assistantMessageHasText(inFlightAssistant);
  const activeToolName = activeToolNameFromMessage(inFlightAssistant);
  const fingerprint = assistantTextFingerprint(inFlightAssistant);
  const hasRoutedModel = Boolean(
    streamingRoutedRegistryId && streamingRoutedRegistryId.trim().length > 0,
  );
  const hasActiveTool = Boolean(activeToolName);
  const modelId =
    streamingRoutedRegistryId || frozenSelectedModelRef.current || selectedModel || null;

  const typicalExpectedMs = estimateExpectedResponseMs({
    modelId,
    adhdAssist,
    hasActiveTool,
  });

  // Derive during render so tool → follow-up does not hide status for a frame.
  const prev = edgeRef.current;
  const awaitingFollowup = resolveAwaitingFollowup({
    isLoading,
    hasActiveTool,
    hasAssistantText,
    fingerprint,
    prevHasActiveTool: prev.hasActiveTool,
    prevFingerprint: prev.fingerprint,
    prevAwaitingFollowup: prev.awaitingFollowup,
  });
  edgeRef.current = {
    hasActiveTool: isLoading ? hasActiveTool : false,
    fingerprint: isLoading ? fingerprint : "",
    awaitingFollowup,
  };

  useEffect(() => {
    if (!isLoading) {
      setStartedAt(null);
      setDeadlineMs(0);
      wasAwaitingFollowupRef.current = false;
      frozenSelectedModelRef.current = null;
      edgeRef.current = {
        hasActiveTool: false,
        fingerprint: "",
        awaitingFollowup: false,
      };
      return;
    }

    setStartedAt(Date.now());
    setDeadlineMs(0);
    // Snapshot once per request — deliberately excluded from deps below.
    frozenSelectedModelRef.current = selectedModel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Grow the deadline when the typical estimate grows (routed model / tools).
  // Skip while follow-up owns a rebased short deadline.
  useEffect(() => {
    if (!isLoading || awaitingFollowup) return;
    setDeadlineMs((prevDeadline) => Math.max(prevDeadline, typicalExpectedMs));
  }, [isLoading, awaitingFollowup, typicalExpectedMs]);

  // Rebase deadline once when entering the post-tool follow-up window.
  useEffect(() => {
    if (!isLoading) {
      wasAwaitingFollowupRef.current = false;
      return;
    }
    if (awaitingFollowup && !wasAwaitingFollowupRef.current) {
      const origin = startedAtRef.current ?? Date.now();
      const elapsed = Math.max(0, Date.now() - origin);
      const followupMs = estimateFollowupRemainingMs({ modelId, adhdAssist });
      setDeadlineMs(elapsed + followupMs);
    }
    wasAwaitingFollowupRef.current = awaitingFollowup;
  }, [isLoading, awaitingFollowup, modelId, adhdAssist]);

  // Prefer streaming tokens while text is arriving. Re-show only for tools or
  // the post-tool follow-up gap — never for inter-token silence alone.
  const showProgressIndicator =
    isLoading && (!hasAssistantText || hasActiveTool || awaitingFollowup);
  const compactProgress = hasAssistantText && showProgressIndicator;

  return {
    startedAt,
    deadlineMs: deadlineMs > 0 ? deadlineMs : typicalExpectedMs,
    typicalExpectedMs,
    hasAssistantText,
    hasRoutedModel,
    activeToolName,
    awaitingFollowup,
    showProgressIndicator,
    compactProgress,
  };
}
