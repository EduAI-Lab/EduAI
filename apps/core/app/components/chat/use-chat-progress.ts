import { useEffect, useRef, useState } from "react";

import {
  activeToolNameFromMessage,
  assistantMessageHasText,
  assistantTextFingerprint,
  resolveChatProgressStage,
  type ChatProgressStage,
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
 */
export function useChatProgress(args: {
  isLoading: boolean;
  messages: MessageLike[];
  adhdAssist: boolean;
  streamingRoutedRegistryId?: string | null;
}): {
  elapsedMs: number;
  stage: ChatProgressStage;
  hasAssistantText: boolean;
  showProgressIndicator: boolean;
  /** Slimmer row under an already-streaming assistant bubble (multi-step). */
  compactProgress: boolean;
} {
  const {
    isLoading,
    messages,
    adhdAssist,
    streamingRoutedRegistryId = null,
  } = args;

  const [elapsedMs, setElapsedMs] = useState(0);
  const [awaitingFollowup, setAwaitingFollowup] = useState(false);
  const prevHadActiveToolRef = useRef(false);
  const lastFingerprintRef = useRef("");

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

  useEffect(() => {
    if (!isLoading) {
      setElapsedMs(0);
      setAwaitingFollowup(false);
      prevHadActiveToolRef.current = false;
      lastFingerprintRef.current = "";
      return;
    }

    const startedAt = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => window.clearInterval(id);
  }, [isLoading]);

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
      setAwaitingFollowup(true);
    }
  }, [isLoading, hasActiveTool, hasAssistantText]);

  // New assistant text clears the post-tool wait (follow-up generation started).
  useEffect(() => {
    if (!isLoading) return;
    if (fingerprint === lastFingerprintRef.current) return;

    const previous = lastFingerprintRef.current;
    lastFingerprintRef.current = fingerprint;

    if (
      awaitingFollowup &&
      previous.trim().length > 0 &&
      fingerprint.trim().length > 0 &&
      fingerprint !== previous
    ) {
      setAwaitingFollowup(false);
    }
  }, [isLoading, fingerprint, awaitingFollowup]);

  const stage = resolveChatProgressStage({
    elapsedMs,
    hasAssistantText,
    hasRoutedModel,
    activeToolName,
    adhdAssist,
    awaitingFollowup,
  });

  // Prefer streaming tokens while text is arriving. Re-show only for tools or
  // the post-tool follow-up gap — never for inter-token silence alone.
  const showProgressIndicator =
    isLoading && (!hasAssistantText || hasActiveTool || awaitingFollowup);
  const compactProgress = hasAssistantText && showProgressIndicator;

  return {
    elapsedMs,
    stage,
    hasAssistantText,
    showProgressIndicator,
    compactProgress,
  };
}
