/**
 * ChatHistoryRail — persistent left sidebar for the user's own conversations (#695).
 *
 * Visible on md+ viewports; mobile uses ChatHistoryPanel (Sheet) instead.
 */
import { IconPlus } from "@tabler/icons-react";
import { cn } from "~/lib/utils";
import { ChatHistoryList, type ChatHistoryListProps } from "~/components/chat/chat-history-list";

export type ChatHistoryRailProps = Omit<ChatHistoryListProps, "className"> & {
  className?: string;
  onNewChat: () => void;
};

export function ChatHistoryRail({
  className,
  onNewChat,
  ...listProps
}: ChatHistoryRailProps) {
  return (
    <aside
      className={cn(
        "chat-history-rail assistive-focus-chrome hidden md:flex flex-col flex-shrink-0 h-full min-h-0 w-[260px] lg:w-[280px] border-r border-border bg-background",
        className,
      )}
      aria-label="Chat history"
    >
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-shrink-0 px-3 py-3 border-b border-border">
          <button
            type="button"
            onClick={onNewChat}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted/60 transition-colors"
          >
            <IconPlus className="h-4 w-4" stroke={2} />
            New chat
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hover scroll-smooth overscroll-contain px-1">
          <ChatHistoryList {...listProps} />
        </div>
      </div>
    </aside>
  );
}
