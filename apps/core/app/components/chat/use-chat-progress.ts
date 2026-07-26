import { useEffect, useRef, useState } from "react";

import {
  CHAT_PROGRESS_TEXT_IDLE_MS,
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
 * Tick interval stays light so fast cloud models are not delayed.
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
  const [textIdle, setTextIdle] = useState(false);
  const lastFingerprintRef = useRef("");
  const lastTextChangeAtRef = useRef<number | null>(null);

  const lastMessage = messages[messages.length - 1] as MessageLike | undefined;
  const inFlightAssistant =
    isLoading && lastMessage?.role === "assistant" ? lastMessage : null;
  const hasAssistantText = assistantMessageHasText(inFlightAssistant);
  const activeToolName = activeToolNameFromMessage(inFlightAssistant);
  const fingerprint = assistantTextFingerprint(inFlightAssistant);
  const hasRoutedModel = Boolean(
    streamingRoutedRegistryId && streamingRoutedRegistryId.trim().length > 0,
  );

  useEffect(() => {
    if (!isLoading) {
      setElapsedMs(0);
      setTextIdle(false);
      lastFingerprintRef.current = "";
      lastTextChangeAtRef.current = null;
      return;
    }

    const startedAt = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
      const changedAt = lastTextChangeAtRef.current;
      if (changedAt != null) {
        setTextIdle(Date.now() - changedAt >= CHAT_PROGRESS_TEXT_IDLE_MS);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) return;
    if (fingerprint === lastFingerprintRef.current) return;

    lastFingerprintRef.current = fingerprint;
    if (fingerprint.trim().length > 0) {
      lastTextChangeAtRef.current = Date.now();
    } else {
      lastTextChangeAtRef.current = null;
    }
    setTextIdle(false);
  }, [isLoading, fingerprint]);

  const stage = resolveChatProgressStage({
    elapsedMs,
    hasAssistantText,
    hasRoutedModel,
    activeToolName,
    adhdAssist,
  });

  const hasActiveTool = Boolean(activeToolName);
  // Prefer streaming tokens while text is still arriving. Re-show for tools or
  // after a short idle gap (second generation / post-tool wait).
  const showProgressIndicator =
    isLoading && (!hasAssistantText || hasActiveTool || textIdle);
  const compactProgress = hasAssistantText && showProgressIndicator;

  return {
    elapsedMs,
    stage,
    hasAssistantText,
    showProgressIndicator,
    compactProgress,
  };
}
