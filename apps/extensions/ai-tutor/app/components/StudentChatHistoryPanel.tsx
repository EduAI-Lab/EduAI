import { useCallback, useEffect, useState } from 'react';
import {
  IconLoader2,
  IconMessageCircle,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@eduai/ui';
import {
  deleteChatSession,
  listChatSessions,
  type StoredChatSession,
} from '~/lib/student-chat-history';

type StudentChatHistoryPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: number | undefined;
  activeSessionId: string | null;
  onSelect: (session: StoredChatSession) => void;
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

const TAB_LABELS: Record<string, string> = {
  teach: 'Teach',
  guide: 'Guide',
  custom: 'Custom',
};

export function StudentChatHistoryPanel({
  open,
  onOpenChange,
  activityId,
  activeSessionId,
  onSelect,
  onNewChat,
}: StudentChatHistoryPanelProps) {
  const [sessions, setSessions] = useState<StoredChatSession[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!activityId) {
      setSessions([]);
      return;
    }
    setSessions(listChatSessions(activityId));
  }, [activityId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    deleteChatSession(id);
    if (id === activeSessionId) onNewChat();
    refresh();
    setDeletingId(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[340px] flex-col p-0 sm:w-[380px]">
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

        <div className="flex-1 overflow-y-auto">
          {!activityId ? (
            <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
              Open an activity to view chat history.
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div
                className="mb-3 flex h-12 w-12 items-center justify-center rounded-[12px]"
                style={{ background: 'var(--muted)' }}
              >
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
                const isActive = session.id === activeSessionId;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      onSelect(session);
                      onOpenChange(false);
                    }}
                    className={`group flex items-start gap-3 border-b border-border px-5 py-3 text-left transition-colors hover:bg-muted/40 ${
                      isActive ? 'bg-muted/60' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {session.preview}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-primary-text">
                          {TAB_LABELS[session.tab] ?? session.tab}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {relativeTime(session.updatedAt)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          · {session.messages.length} msg
                          {session.messages.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label="Delete conversation"
                      onClick={(e) => handleDelete(e, session.id)}
                      className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    >
                      {deletingId === session.id ? (
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
