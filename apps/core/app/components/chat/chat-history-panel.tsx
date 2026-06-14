/**
 * ChatHistoryPanel — slide-over list of the current user's own conversations.
 *
 * Owner-scoped (scope=own): every chat here is editable/restorable by the
 * viewer. Selecting one restores it into the live chat screen; staff/admin view
 * OTHER users' history read-only elsewhere (course detail, admin), never here.
 */
import { useState } from "react";
import {
  IconPlus,
  IconMessageCircle,
  IconTrash,
  IconLoader2,
  IconBook,
} from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Button,
} from "@eduai/ui";
import { apiFetch } from "~/hooks/api/config";
import { useChatHistory, type ChatHistoryItem } from "~/hooks/api/use-chat-history";

interface ChatHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
}

function relativeTime(iso: string): string {
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function rowLabel(chat: ChatHistoryItem): string {
  return chat.title || chat.preview || "New conversation";
}

export function ChatHistoryPanel({
  open,
  onOpenChange,
  activeChatId,
  onSelect,
  onNewChat,
}: ChatHistoryPanelProps) {
  const { chats, isLoading, error, refresh } = useChatHistory({
    scope: "own",
    limit: 50,
    enabled: open,
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setDeletingId(chatId);
    try {
      await apiFetch<void>(`/api/chats/${chatId}`, { method: "DELETE" });
      if (chatId === activeChatId) onNewChat();
      await refresh();
    } catch {
      // Surface nothing destructive; list simply stays as-is on failure.
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[340px] sm:w-[380px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle className="text-[15px]">Chat history</SheetTitle>
          <SheetDescription className="text-[13px]">
            Your saved conversations. Select one to pick up where you left off.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 py-3 border-b border-border">
          <Button
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              onNewChat();
              onOpenChange(false);
            }}
          >
            <IconPlus className="h-4 w-4 mr-1.5" />
            New chat
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hover">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <IconLoader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <div className="px-5 py-10 text-center">
              <p className="text-[13px] text-destructive">{error}</p>
            </div>
          ) : chats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
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
          ) : (
            <div className="flex flex-col">
              {chats.map((chat) => {
                const isActive = chat.id === activeChatId;
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => onSelect(chat.id)}
                    className={`group flex items-start gap-3 px-5 py-3 text-left border-b border-border transition-colors hover:bg-muted/40 ${
                      isActive ? "bg-muted/60" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">
                        {rowLabel(chat)}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {chat.courseCode && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-text">
                            <IconBook size={11} />
                            {chat.courseCode}
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {relativeTime(chat.updatedAt)}
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
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
