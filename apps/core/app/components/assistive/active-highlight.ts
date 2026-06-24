/** Latest assistant turn — emphasized under `[data-assistive]`. */
export const CHAT_MESSAGE_ACTIVE_CLASS = "chat-message--active";

/** Older thread content — de-emphasized until hover/focus. */
export const CHAT_MESSAGE_INACTIVE_CLASS = "chat-message--inactive";

/** Subtle anchor on the chat composer when assistive highlighting is on. */
export const ASSISTIVE_INPUT_ANCHOR_CLASS = "assistive-input-anchor";

/** Reserved for optional focus-mode chrome hiding (composer toolbar stays visible). */
export const ASSISTIVE_FOCUS_CHROME_CLASS = "assistive-focus-chrome";

/** Chat surface scope for stronger `:focus-visible` rings. */
export const ASSISTIVE_CHAT_SURFACE_CLASS = "assistive-chat-surface";

export const CHAT_MESSAGE_INPUT_ID = "chat-message-input";

export type MessageHighlightRole = "active" | "inactive" | null;

export function findLastAssistantIndex(messages: ReadonlyArray<{ role: string }>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return i;
  }
  return -1;
}

export function resolveMessageHighlightRole(
  index: number,
  messages: ReadonlyArray<{ role: string }>,
  assistiveEnabled: boolean,
): MessageHighlightRole {
  if (!assistiveEnabled) return null;
  const lastAssistantIndex = findLastAssistantIndex(messages);
  if (lastAssistantIndex < 0) return null;
  if (index === lastAssistantIndex) return "active";
  return "inactive";
}
