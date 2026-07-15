import { useCallback, useEffect, useRef, useState } from 'react';
import { IconAlertCircle, IconLoader2, IconMessageCircle, IconPlus } from '@tabler/icons-react';
import {
  Badge,
  Button,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@eduai/ui';
import { listChatSessions, type ApiChatSession } from '~/lib/student-chat-history';
import { cn } from '~/lib/utils';

type StudentChatHistoryPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: number | undefined;
  activeChatId: string | null;
  onSelect: (session: ApiChatSession) => void;
  onNewChat: () => void;
};

function relativeTime(iso: string): string {
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const MODE_LABELS: Record<string, string> = {
  teach: 'Teach',
  guide: 'Guide',
  custom: 'Custom',
};

export function StudentChatHistoryPanel({
  open,
  onOpenChange,
  activityId,
  activeChatId,
  onSelect,
  onNewChat,
}: StudentChatHistoryPanelProps) {
  const [sessions, setSessions] = useState<ApiChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Guards against out-of-order completions: rapid Retry clicks, reopening the
  // panel, or an activityId change can otherwise let an older rejection (or
  // stale rows) overwrite the newest request's result.
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    if (!activityId) {
      setSessions([]);
      setLoadError(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await listChatSessions(activityId);
      if (seq !== refreshSeqRef.current) return;
      setSessions(rows);
    } catch {
      if (seq !== refreshSeqRef.current) return;
      setSessions([]);
      setLoadError(true);
    } finally {
      if (seq === refreshSeqRef.current) setLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[340px] flex-col gap-0 p-0 sm:w-[380px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="border-b border-border px-5 pb-3 pt-5">
          <SheetTitle className="text-[15px]">Chat history</SheetTitle>
          <SheetDescription className="text-[13px]">
            Saved conversations for this activity. Select one to restore it.
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-border px-4 py-3">
          <Button
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              onNewChat();
              onOpenChange(false);
            }}
          >
            <IconPlus className="mr-1.5 h-4 w-4" />
            New chat
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {!activityId ? (
            <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
              Open an activity to view chat history.
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-16">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
                <IconAlertCircle size={22} className="text-destructive" stroke={1.5} />
              </div>
              <p className="mb-1 text-[14px] font-semibold text-foreground">
                Couldn&apos;t load history
              </p>
              <p className="mb-4 text-[12px] text-muted-foreground">
                Check your connection and try again.
              </p>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <IconMessageCircle size={22} className="text-muted-foreground" stroke={1.5} />
              </div>
              <p className="mb-1 text-[14px] font-semibold text-foreground">No conversations yet</p>
              <p className="text-[12px] text-muted-foreground">
                Start chatting and your history will appear here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {sessions.map((session) => {
                const isActive = session.chatId === activeChatId;
                return (
                  <button
                    key={session.chatId}
                    type="button"
                    onClick={() => {
                      onSelect(session);
                      onOpenChange(false);
                    }}
                    className={cn(
                      'flex items-center gap-3 border-b border-border px-5 py-3 text-left transition-colors hover:bg-muted/40',
                      isActive && 'bg-muted/60',
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Badge variant="secondary" size="sm">
                        {MODE_LABELS[session.mode] ?? session.mode}
                      </Badge>
                      <p className="text-[11px] text-muted-foreground">
                        {relativeTime(session.updatedAt)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
