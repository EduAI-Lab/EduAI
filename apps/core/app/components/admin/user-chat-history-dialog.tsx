import { useEffect, useState } from "react";
import { IconLoader2, IconArrowLeft, IconBook, IconChevronRight } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
} from "@eduai/ui";
import { ChatTranscriptViewer } from "~/components/chat/chat-transcript-viewer";
import { useChatHistory, fetchChatTranscript, type ChatTranscript } from "~/hooks/api/use-chat-history";
import { cn } from "~/lib/utils";

interface UserChatHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
}

function relativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

export function UserChatHistoryDialog({
  open,
  onOpenChange,
  userId,
  userName,
}: UserChatHistoryDialogProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ChatTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const { chats, isLoading, error } = useChatHistory({
    userId,
    limit: 50,
    enabled: open,
  });

  useEffect(() => {
    if (!selectedChatId) return;

    const loadTranscript = async () => {
      setTranscriptLoading(true);
      setTranscript(null);
      const data = await fetchChatTranscript(selectedChatId);
      setTranscript(data);
      setTranscriptLoading(false);
    };

    loadTranscript();
  }, [selectedChatId]);

  useEffect(() => {
    if (!open) {
      setSelectedChatId(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto rounded-[var(--radius-xl)]">
        <DialogHeader>
          <DialogTitle>Chat history — {userName}</DialogTitle>
          <DialogDescription>View all conversations for this user</DialogDescription>
        </DialogHeader>

        {selectedChatId ? (
          <div className="space-y-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedChatId(null)}
              className="gap-1"
            >
              <IconArrowLeft size={16} />
              Back to conversations
            </Button>
            <ChatTranscriptViewer
              messages={transcript?.messages ?? []}
              ownerName={userName}
              courseCode={transcript?.chat.courseCode ?? undefined}
              isLoading={transcriptLoading}
              continueChatId={transcript?.canEdit ? selectedChatId : undefined}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}

            {!isLoading && !error && chats.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">
                No conversations for this user.
              </div>
            )}

            {!isLoading && !error && chats.length > 0 && (
              <div className="space-y-2">
                {chats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => setSelectedChatId(chat.id)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] border border-border bg-card hover:bg-muted/40 w-full text-left transition-colors"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {chat.preview || chat.title || "New conversation"}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                        {chat.courseCode && (
                          <div className="flex items-center gap-1">
                            <IconBook size={11} className="text-primary-text flex-shrink-0" />
                            <span className="text-primary-text font-medium">{chat.courseCode}</span>
                          </div>
                        )}
                        <span className="text-[12px]">
                          {relativeTime(chat.updatedAt)}
                        </span>
                        <span className="text-[12px]">· {chat.messageCount} msgs</span>
                      </div>
                    </div>
                    <IconChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
