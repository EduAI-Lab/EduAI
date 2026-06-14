/**
 * ChatTranscriptViewer — read-only rendering of a stored conversation.
 *
 * Used wherever someone views chat history they do NOT own (course-detail
 * staff view, admin per-user history). There is deliberately NO composer: a
 * reader can never append to or edit another user's chat. The owner restores
 * and continues their own chats through the live chat screen instead.
 */
import { type Message } from "ai";
import { IconEye, IconMessageCircle, IconLoader2 } from "@tabler/icons-react";
import { ChatMessage } from "~/components/chat/chat-message";

interface ChatTranscriptViewerProps {
  messages: Array<Record<string, unknown>>;
  /** Owner display name — shown in the read-only banner. */
  ownerName?: string | null;
  courseCode?: string | null;
  isLoading?: boolean;
  className?: string;
}

export function ChatTranscriptViewer({
  messages,
  ownerName,
  courseCode,
  isLoading = false,
  className,
}: ChatTranscriptViewerProps) {
  return (
    <div className={className}>
      {/* Read-only banner */}
      <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-muted/50 px-4 py-2.5 mb-5">
        <IconEye size={15} className="text-muted-foreground flex-shrink-0" stroke={1.7} />
        <p className="text-[13px] text-muted-foreground">
          Read-only transcript
          {ownerName ? (
            <>
              {" — "}
              <span className="font-medium text-foreground">{ownerName}</span>
            </>
          ) : null}
          {courseCode ? <span className="text-muted-foreground"> · {courseCode}</span> : null}
        </p>
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-background text-muted-foreground border border-border">
          View only
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <IconLoader2 size={20} className="animate-spin" />
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
              key={(message.id as string) ?? `msg-${index}`}
              message={message as unknown as Message}
            />
          ))}
        </div>
      )}
    </div>
  );
}
