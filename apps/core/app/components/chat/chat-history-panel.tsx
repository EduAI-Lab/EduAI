/**
 * ChatHistoryPanel — slide-over list of the current user's own conversations.
 *
 * Owner-scoped (scope=own): every chat here is editable/restorable by the
 * viewer. Selecting one restores it into the live chat screen; staff/admin view
 * OTHER users' history read-only elsewhere (course detail, admin), never here.
 *
 * On md+ viewports the persistent ChatHistoryRail is used instead; this Sheet
 * is the mobile fallback.
 */
import { IconPlus } from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Button,
} from "@eduai/ui";
import { ChatHistoryList, type ChatHistoryListProps } from "~/components/chat/chat-history-list";

type ChatHistoryPanelProps = Omit<ChatHistoryListProps, "className"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChatHistoryPanel({
  open,
  onOpenChange,
  onNewChat,
  onSelect,
  ...listProps
}: ChatHistoryPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[340px] sm:w-[380px] p-0 flex flex-col gap-0 md:hidden"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
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

        <div className="flex-1 overflow-y-auto scrollbar-hover scroll-smooth">
          <ChatHistoryList
            {...listProps}
            onSelect={(id) => {
              onSelect(id);
              onOpenChange(false);
            }}
            onNewChat={() => {
              onNewChat();
              onOpenChange(false);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
