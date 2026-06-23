import { useState } from "react";
import {
  IconBook,
  IconLoader2,
  IconMessageCircle,
  IconTrash,
} from "@tabler/icons-react";
import { cn } from "~/lib/utils";
import { apiFetch } from "~/hooks/api/config";
import type { ChatHistoryItem } from "~/hooks/api/use-chat-history";
import { chatHistoryRowLabel, relativeChatTime } from "~/components/chat/chat-history-utils";

export interface ChatHistoryListProps {
  chats: ChatHistoryItem[];
  isLoading: boolean;
  error: string | null;
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
  onRefresh: () => Promise<void>;
  className?: string;
}

export function ChatHistoryList({
  chats,
  isLoading,
  error,
  activeChatId,
  onSelect,
  onNewChat,
  onRefresh,
  className,
}: ChatHistoryListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setDeletingId(chatId);
    try {
      await apiFetch<void>(`/api/chats/${chatId}`, { method: "DELETE" });
      if (chatId === activeChatId) onNewChat();
      await onRefresh();
    } catch {
      // List stays as-is on failure.
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-16 text-muted-foreground", className)}>
        <IconLoader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("px-5 py-10 text-center", className)}>
        <p className="text-[13px] text-destructive">{error}</p>
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-16 px-6 text-center",
          className,
        )}
      >
        <div
          className="w-12 h-12 rounded-[12px] flex items-center justify-center mb-3"
          style={{ background: "var(--muted)" }}
        >
          <IconMessageCircle size={22} className="text-muted-foreground" stroke={1.5} />
        </div>
        <p className="text-[14px] font-semibold text-foreground mb-1">No conversations yet</p>
        <p className="text-[12px] text-muted-foreground">
          Start chatting and your history will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {chats.map((chat) => {
        const isActive = chat.id === activeChatId;
        return (
          <button
            key={chat.id}
            type="button"
            onClick={() => onSelect(chat.id)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "group flex items-start gap-2 px-3 py-2.5 mx-1 text-left rounded-lg transition-colors duration-150 hover:bg-muted/50",
              isActive && "bg-muted/70",
            )}
          >
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground truncate">
                {chatHistoryRowLabel(chat)}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {chat.courseCode && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-text">
                    <IconBook size={11} />
                    {chat.courseCode}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {relativeChatTime(chat.updatedAt)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  · {chat.messageCount} msg{chat.messageCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            <span
              role="button"
              tabIndex={-1}
              aria-label="Delete conversation"
              onClick={(e) => handleDelete(e, chat.id)}
              className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              {deletingId === chat.id ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <IconTrash className="h-3.5 w-3.5" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
