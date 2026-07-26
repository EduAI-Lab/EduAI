import { useEffect, useRef, useState } from "react";

import {
  activeToolNameFromMessage,
  assistantMessageHasText,
  assistantTextFingerprint,
  computeTimedChatProgress,
  estimateExpectedResponseMs,
  estimateFollowupRemainingMs,
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
  const [awaitingFollowup, setAwaitingFollowup] = useState(false);
  /** Monotonic wall-clock target for fill + “About Xs left”. */
  const [deadlineMs, setDeadlineMs] = useState(0);
  const [peakPercent, setPeakPercent] = useState(0);
  const prevHadActiveToolRef = useRef(false);
  const lastFingerprintRef = useRef("");
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

  useEffect(() => {
    if (!isLoading) {
      setElapsedMs(0);
      setAwaitingFollowup(false);
      setDeadlineMs(0);
      setPeakPercent(0);
      prevHadActiveToolRef.current = false;
      lastFingerprintRef.current = "";
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
    setDeadlineMs((prev) => Math.max(prev, typicalExpectedMs));
  }, [isLoading, awaitingFollowup, typicalExpectedMs]);

  // Enter/leave tool activity. Only the active→inactive edge starts follow-up wait.
  useEffect(() => {
    if (!isLoading) return;

    const wasActive = prevHadActiveToolRef.current;
    prevHadActiveToolRef.current = hasActiveTool;

    if (hasActiveTool) {
      setAwaitingFollowup(false);
      return;
    }

    if (wasActive && hasAssistantText) {
      // If tokens already advanced in this same turn, skip the follow-up gap.
      const textAlreadyAdvanced =
        lastFingerprintRef.current.trim().length > 0 &&
        fingerprint.trim().length > 0 &&
        fingerprint !== lastFingerprintRef.current;

      if (!textAlreadyAdvanced) {
        setAwaitingFollowup(true);
        const followupMs = estimateFollowupRemainingMs({
          modelId,
          adhdAssist,
        });
        // Rebase from *now* — do not rewrite the full-turn estimate against
        // total elapsed (that falsely trips “longer than usual”).
        setDeadlineMs(elapsedMsRef.current + followupMs);
      }
    }
  }, [
    isLoading,
    hasActiveTool,
    hasAssistantText,
    fingerprint,
    modelId,
    adhdAssist,
  ]);

  // New assistant text clears the post-tool wait (follow-up generation started).
  useEffect(() => {
    if (!isLoading) return;
    if (fingerprint === lastFingerprintRef.current) return;

    const previous = lastFingerprintRef.current;
    lastFingerprintRef.current = fingerprint;

    if (
      previous.trim().length > 0 &&
      fingerprint.trim().length > 0 &&
      fingerprint !== previous
    ) {
      setAwaitingFollowup(false);
    }
  }, [isLoading, fingerprint]);

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
    setPeakPercent((prev) => Math.max(prev, timed.percent));
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
