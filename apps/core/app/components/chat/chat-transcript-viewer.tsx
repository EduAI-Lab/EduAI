/**
 * ChatTranscriptViewer — read-only rendering of a stored conversation.
 *
 * Used wherever someone views chat history they do NOT own (course-detail
 * staff view, admin per-user history). There is deliberately NO composer: a
 * reader can never append to or edit another user's chat. The owner restores
 * and continues their own chats through the live chat screen instead.
 *
 * When `continueChatId` is provided the viewer renders a "Continue in chat"
 * button that deep-links to /chat/<id> — only pass this when the
 * current user is the owner of the chat (canEdit === true).
 */
import { type Message } from "ai";
import { Spinner } from "@eduai/ui";
import { IconEye, IconMessageCircle, IconArrowRight } from "@tabler/icons-react";
import { Link } from "react-router";
import { Button } from "@eduai/ui";
import { ChatMessage } from "~/components/chat/chat-message";

interface ChatTranscriptViewerProps {
  messages: Array<Record<string, unknown>>;
  /** Owner display name — shown in the read-only banner. */
  ownerName?: string | null;
  courseCode?: string | null;
  isLoading?: boolean;
  className?: string;
  /**
   * When provided, renders a "Continue in chat" action that opens this chat
   * in the live chat screen. Only pass this when the current user owns the
   * chat (i.e. canEdit === true from ChatTranscript).
   */
  continueChatId?: string;
}

export function ChatTranscriptViewer({
  messages,
  ownerName,
  courseCode,
  isLoading = false,
  className,
  continueChatId,
}: ChatTranscriptViewerProps) {
  return (
    <div className={className}>
      {/* Read-only banner */}
      <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-muted/50 px-4 py-2.5 mb-5">
        <IconEye size={15} className="text-muted-foreground flex-shrink-0" stroke={1.7} />
        <p className="text-[13px] text-muted-foreground">
          Read-only transcript
        </p>
        <div className="ml-auto flex items-center gap-2">
          {continueChatId && (
            <Button asChild size="sm" variant="default" className="h-7 px-3 text-[12px] gap-1.5">
              <Link to={`/chat/${continueChatId}`}>
                Continue in chat
                <IconArrowRight size={13} stroke={2} />
              </Link>
            </Button>
          )}
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-background text-muted-foreground border border-border">
            View only
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Spinner size="md" />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div
            className="w-14 h-14 rounded-[14px] flex items-center justify-center mb-4"
            style={{ background: "var(--muted)" }}
          >
            <IconMessageCircle size={26} className="text-muted-foreground" stroke={1.5} />
          </div>
          <p className="text-[15px] font-semibold text-foreground mb-1">No messages</p>
          <p className="text-[13px] text-muted-foreground">
            This conversation has no recorded messages.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {messages.map((message, index) => (
            <ChatMessage
              key={typeof message.id === "string" && message.id ? message.id : `msg-${index}`}
              message={message as unknown as Message}
            />
          ))}
        </div>
      )}
    </div>
  );
}
