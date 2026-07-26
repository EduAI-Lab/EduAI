import { useEffect, useRef, useState } from "react";

import {
  activeToolNameFromMessage,
  assistantMessageHasText,
  assistantTextFingerprint,
  computeTimedChatProgress,
  estimateExpectedResponseMs,
  estimateFollowupRemainingMs,
  resolveAwaitingFollowup,
  resolveChatProgressStage,
  type ChatProgressStage,
  type TimedChatProgress,
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
 * Tracks elapsed wait + resolved status stage while a chat turn is in flight.
 *
 * Multi-step gaps are gated on tool activity (active tool, or waiting for the
 * next tokens after a tool completes) — not on inter-token silence — so slow
 * local models do not flicker a compact status between streamed tokens.
 *
 * The progress bar fills against a deadline derived from the typical model /
 * Assist wait (extended when tools run; rebased to a short remaining window
 * after a tool finishes) so ADHD users can see how close they are.
 */
export function useChatProgress(args: {
  isLoading: boolean;
  messages: MessageLike[];
  adhdAssist: boolean;
  selectedModel?: string | null;
  streamingRoutedRegistryId?: string | null;
}): {
  elapsedMs: number;
  stage: ChatProgressStage;
  timed: TimedChatProgress;
  hasAssistantText: boolean;
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

  const [elapsedMs, setElapsedMs] = useState(0);
  /** Monotonic wall-clock target for fill + “About Xs left”. */
  const [deadlineMs, setDeadlineMs] = useState(0);
  const [peakPercent, setPeakPercent] = useState(0);
  const edgeRef = useRef<ProgressEdgeRef>({
    hasActiveTool: false,
    fingerprint: "",
    awaitingFollowup: false,
  });
  const wasAwaitingFollowupRef = useRef(false);
  const elapsedMsRef = useRef(0);
  elapsedMsRef.current = elapsedMs;

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
  const modelId = streamingRoutedRegistryId || selectedModel || null;

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
      setElapsedMs(0);
      setDeadlineMs(0);
      setPeakPercent(0);
      wasAwaitingFollowupRef.current = false;
      edgeRef.current = {
        hasActiveTool: false,
        fingerprint: "",
        awaitingFollowup: false,
      };
      return;
    }

    const startedAt = Date.now();
    setElapsedMs(0);
    setDeadlineMs(0);
    setPeakPercent(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => window.clearInterval(id);
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
      const followupMs = estimateFollowupRemainingMs({ modelId, adhdAssist });
      setDeadlineMs(elapsedMsRef.current + followupMs);
    }
    wasAwaitingFollowupRef.current = awaitingFollowup;
  }, [isLoading, awaitingFollowup, modelId, adhdAssist]);

  const stage = resolveChatProgressStage({
    elapsedMs,
    hasAssistantText,
    hasRoutedModel,
    activeToolName,
    adhdAssist,
    awaitingFollowup,
  });

  const timed = computeTimedChatProgress({
    elapsedMs,
    deadlineMs: deadlineMs > 0 ? deadlineMs : typicalExpectedMs,
    typicalExpectedMs,
    stageFloor: stage.progress,
    peakPercent,
  });

  useEffect(() => {
    if (!isLoading) return;
    setPeakPercent((prevPeak) => Math.max(prevPeak, timed.percent));
  }, [isLoading, timed.percent]);

  // Prefer streaming tokens while text is arriving. Re-show only for tools or
  // the post-tool follow-up gap — never for inter-token silence alone.
  const showProgressIndicator =
    isLoading && (!hasAssistantText || hasActiveTool || awaitingFollowup);
  const compactProgress = hasAssistantText && showProgressIndicator;

  return {
    elapsedMs,
    stage,
    timed,
    hasAssistantText,
    showProgressIndicator,
    compactProgress,
  };
}
