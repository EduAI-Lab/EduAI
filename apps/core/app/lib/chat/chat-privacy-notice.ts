export const CHAT_PRIVACY_NOTICE_KEY = "eduai:chat-privacy-notice";
import { isBrowser } from "@eduai/ui/runtime-env";

function storageKey(userId: string): string {
  return `${CHAT_PRIVACY_NOTICE_KEY}:${userId}`;
}

export function hasAcknowledgedChatPrivacyNotice(userId: string): boolean {
  if (!isBrowser()) return true;
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function acknowledgeChatPrivacyNotice(userId: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(storageKey(userId), "1");
  } catch {
    // Private browsing / quota — dialog may reappear next visit; chat still usable.
  }
}
