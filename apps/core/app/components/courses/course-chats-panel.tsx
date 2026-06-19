import { useState } from 'react'
import { Card, CardContent } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { useChatDetail, type CourseChatSummary } from '~/hooks/api/use-course-chats'

/** Best-effort plain-text extraction from a stored chat message `content` JSON. */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>
    if (typeof obj.content === 'string') return obj.content
    if (Array.isArray(obj.parts)) {
      return obj.parts
        .map((p) =>
          p && typeof p === 'object' && typeof (p as Record<string, unknown>).text === 'string'
            ? (p as Record<string, unknown>).text
            : '',
        )
        .join('')
    }
    if (Array.isArray(obj.content)) {
      return obj.content
        .map((p) =>
          p && typeof p === 'object' && typeof (p as Record<string, unknown>).text === 'string'
            ? (p as Record<string, unknown>).text
            : '',
        )
        .join('')
    }
  }
  return ''
}

function ChatMessageViewer({ chatId }: { chatId: string }) {
  const { chat, loading, error } = useChatDetail(chatId)

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading chat…</p>
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }
  if (!chat) return null

  return (
    <div className="flex flex-col gap-3">
      {chat.messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages in this chat.</p>
      ) : (
        chat.messages.map((m) => (
          <div key={m.messageId} className="rounded-md border p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground mb-1">{m.role}</p>
            <p className="text-sm whitespace-pre-wrap">{messageText(m.content)}</p>
          </div>
        ))
      )}
    </div>
  )
}

interface Props {
  chats: CourseChatSummary[]
  loading?: boolean
  error?: string | null
  /** Optional extra label rendered next to each chat (e.g. the course code in a unit view). */
  secondaryLabel?: (chatId: string) => string | null
}

/**
 * Read-only viewer for course/unit chats (§5d). Lists chats and shows a selected
 * chat's messages. The backend is the security boundary — this only renders what
 * the gated endpoints already return.
 */
export function CourseChatsPanel({ chats, loading = false, error = null, secondaryLabel }: Props) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
          Loading chats…
        </CardContent>
      </Card>
    )
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
      </Card>
    )
  }
  if (chats.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
          No chats yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
      <div className="grid gap-2 content-start">
        {chats.map((chat) => {
          const extra = secondaryLabel?.(chat.id)
          return (
            <Button
              key={chat.id}
              variant={selectedChatId === chat.id ? 'default' : 'outline'}
              className="h-auto flex-col items-start gap-0.5 py-2 text-left"
              onClick={() => setSelectedChatId(chat.id)}
            >
              <span className="text-sm font-medium truncate w-full">
                {chat.title || 'Untitled chat'}
              </span>
              <span className="text-xs text-muted-foreground truncate w-full">
                {chat.ownerName ?? chat.ownerId}
                {extra ? ` · ${extra}` : ''}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(chat.updatedAt).toLocaleString()}
              </span>
            </Button>
          )
        })}
      </div>
      <Card>
        <CardContent className="pt-6">
          {selectedChatId ? (
            <ChatMessageViewer chatId={selectedChatId} />
          ) : (
            <p className="text-sm text-muted-foreground">Select a chat to view its messages.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
