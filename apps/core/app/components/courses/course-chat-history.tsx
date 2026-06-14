import { useState } from 'react'
import { IconMessageCircle, IconChevronRight, IconLoader2 } from '@tabler/icons-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@eduai/ui'
import { useChatHistory, fetchChatTranscript, type ChatHistoryItem } from '~/hooks/api/use-chat-history'
import { ChatTranscriptViewer } from '~/components/chat/chat-transcript-viewer'

interface CourseChatHistoryProps {
  courseId: string
  courseCode: string
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const secs = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (secs < 60) return 'Just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function CourseChatHistory({ courseId, courseCode }: CourseChatHistoryProps) {
  const { chats, isLoading, error } = useChatHistory({ courseId, limit: 50 })
  const [selectedChat, setSelectedChat] = useState<ChatHistoryItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [transcriptData, setTranscriptData] = useState<{ chat: { ownerName: string | null; courseCode: string | null }; messages: Array<Record<string, unknown>> } | null>(null)

  const handleOpenChat = async (chat: ChatHistoryItem) => {
    setSelectedChat(chat)
    setDialogOpen(true)
    setTranscriptLoading(true)
    setTranscriptData(null)
    const result = await fetchChatTranscript(chat.id)
    if (result) {
      setTranscriptData(result)
    }
    setTranscriptLoading(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-[13px] text-destructive">
        {error}
      </div>
    )
  }

  if (chats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div
          className="w-14 h-14 rounded-[14px] flex items-center justify-center mb-4"
          style={{ background: 'var(--muted)' }}
        >
          <IconMessageCircle size={26} className="text-muted-foreground" stroke={1.5} />
        </div>
        <h2 className="text-[15px] font-semibold text-foreground mb-1">
          No conversations yet for this course.
        </h2>
        <p className="text-[13px] text-muted-foreground max-w-sm">
          Student conversations will appear here once they start chatting about course content.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {chats.map((chat) => (
          <button
            key={chat.id}
            onClick={() => handleOpenChat(chat)}
            className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] border border-border bg-card hover:bg-muted/40 transition-colors text-left w-full"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground truncate">
                {chat.preview || chat.title || 'New conversation'}
              </p>
              <p className="text-[12px] text-muted-foreground mt-1">
                {chat.userName} · {relativeTime(chat.updatedAt)} · {chat.messageCount} msgs
              </p>
            </div>
            <IconChevronRight size={18} className="text-muted-foreground flex-shrink-0" stroke={1.5} />
          </button>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto rounded-[var(--radius-xl)]">
          <DialogHeader>
            <DialogTitle>
              Conversation — {selectedChat?.userName}
            </DialogTitle>
          </DialogHeader>
          {selectedChat && (
            <ChatTranscriptViewer
              messages={transcriptData?.messages ?? []}
              ownerName={selectedChat.userName}
              courseCode={courseCode}
              isLoading={transcriptLoading}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
