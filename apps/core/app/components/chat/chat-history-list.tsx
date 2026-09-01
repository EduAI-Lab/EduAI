import { useState } from "react";
import { IconBook, IconLoader2, IconMessageCircle, IconTrash } from "@tabler/icons-react";
import { ConfirmDialog } from "@eduai/ui";
import { toast } from "sonner";
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleDelete = async () => {
    const chatId = pendingDeleteId;
    if (!chatId) return;

    setDeletingId(chatId);
    try {
      await apiFetch<void>(`/api/chats/${chatId}`, { method: "DELETE" });
      setPendingDeleteId(null);
      if (chatId === activeChatId) onNewChat();
      try {
        await onRefresh();
      } catch {
        toast.error("Conversation deleted, but history could not refresh", {
          description: "Refresh the page to update the conversation list.",
        });
      }
    } catch (deleteError) {
      toast.error("Could not delete conversation", {
        description: deleteError instanceof Error ? deleteError.message : "Please try again.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div
        className={cn("flex items-center justify-center py-16 text-muted-foreground", className)}
      >
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
          className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
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
          <div
            key={chat.id}
            className={cn(
              "group mx-1 flex items-start rounded-lg transition-colors duration-150 hover:bg-muted/40",
              isActive && "bg-muted/55",
            )}
          >
            <button
              type="button"
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelect(chat.id)}
              className="min-w-0 flex-1 px-2 py-2.5 text-left"
            >
              <p className="truncate text-[13px] font-medium text-foreground">
                {chatHistoryRowLabel(chat)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
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
            </button>
            <button
              type="button"
              aria-label="Delete conversation"
              disabled={deletingId !== null}
              onClick={() => setPendingDeleteId(chat.id)}
              className="mr-1 mt-1.5 flex-shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 disabled:pointer-events-none group-hover:opacity-100"
            >
              {deletingId === chat.id ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <IconTrash className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        );
      })}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open && deletingId === null) setPendingDeleteId(null);
        }}
        title="Delete conversation?"
        description="This permanently deletes this conversation. This action cannot be undone."
        confirmLabel="Delete"
        isLoading={deletingId !== null}
        closeOnConfirm={false}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
