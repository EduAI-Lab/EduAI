import { useEffect, useState } from "react";

import {
  activeToolNameFromMessage,
  assistantMessageHasText,
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
  /** Slimmer row under an already-streaming bubble (multi-step / late tools). */
  compactProgress: boolean;
} {
  const {
    isLoading,
    messages,
    adhdAssist,
    streamingRoutedRegistryId = null,
  } = args;

  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setElapsedMs(0);
      return;
    }

    const startedAt = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => window.clearInterval(id);
  }, [isLoading]);

  const lastMessage = messages[messages.length - 1] as MessageLike | undefined;
  const inFlightAssistant =
    isLoading && lastMessage?.role === "assistant" ? lastMessage : null;
  const hasAssistantText = assistantMessageHasText(inFlightAssistant);
  const activeToolName = activeToolNameFromMessage(inFlightAssistant);
  const hasRoutedModel = Boolean(
    streamingRoutedRegistryId && streamingRoutedRegistryId.trim().length > 0,
  );

  const stage = resolveChatProgressStage({
    elapsedMs,
    hasAssistantText,
    hasRoutedModel,
    activeToolName,
    adhdAssist,
  });

  // Keep feedback for the whole in-flight turn — including multi-step gaps
  // after the first tokens — so slow second generations are never silent.
  const showProgressIndicator = isLoading;
  const compactProgress = hasAssistantText;

  return {
    elapsedMs,
    stage,
    hasAssistantText,
    showProgressIndicator,
    compactProgress,
  };
}
