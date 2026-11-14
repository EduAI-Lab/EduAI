import type { ChatHistoryItem } from "~/hooks/api/use-chat-history";
import { formatDate, type FormatScope } from "~/lib/hydration-format";

/** Pass `useFormatScope()` as `scope` when the list renders during SSR (#1941). */
export function relativeChatTime(
  iso: string,
  scope: FormatScope = { locale: undefined, timeZone: undefined },
): string {
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(iso, { ...scope, locale: "en-US" }, { month: "short", day: "numeric" });
}

export function chatHistoryRowLabel(chat: ChatHistoryItem): string {
  return chat.preview || chat.title || "New conversation";
}
