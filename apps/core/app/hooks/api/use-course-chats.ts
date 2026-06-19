import { useCallback, useEffect, useState } from 'react'

/** Chat metadata as returned by the course/unit chat-visibility endpoints (§5). */
export interface CourseChatSummary {
  id: string
  title: string | null
  ownerId: string
  ownerName: string | null
  createdAt: string
  updatedAt: string
}

export interface UnitChatSummary extends CourseChatSummary {
  courseId: string | null
  courseCode: string | null
  courseName: string | null
}

export interface ChatMessageView {
  messageId: string
  role: string
  content: unknown
  position: number
}

export interface ChatDetail {
  id: string
  title: string | null
  systemPrompt: string | null
  adhdAssist: boolean
  createdAt: string
  updatedAt: string
  messages: ChatMessageView[]
}

/** Lists chats for a course — GET /api/courses/:courseId/chats (§5c). */
export function useCourseChats(courseId: string | undefined, enabled = true) {
  const [chats, setChats] = useState<CourseChatSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchChats = useCallback(async () => {
    if (!courseId || !enabled) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/chats`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setChats(data.chats ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch chats')
    } finally {
      setLoading(false)
    }
  }, [courseId, enabled])

  useEffect(() => {
    void fetchChats()
  }, [fetchChats])

  return { chats, loading, error, refetch: fetchChats }
}

/** Lists chats across a unit — GET /api/units/:department/chats (§5c). */
export function useUnitChats(department: string | undefined, enabled = true) {
  const [chats, setChats] = useState<UnitChatSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchChats = useCallback(async () => {
    if (!department || !enabled) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/units/${encodeURIComponent(department)}/chats`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setChats(data.chats ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch chats')
    } finally {
      setLoading(false)
    }
  }, [department, enabled])

  useEffect(() => {
    void fetchChats()
  }, [fetchChats])

  return { chats, loading, error, refetch: fetchChats }
}

/** Reads a single chat (metadata + messages) — GET /api/chats/:chatId (§5c). */
export function useChatDetail(chatId: string | null) {
  const [chat, setChat] = useState<ChatDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!chatId) {
      setChat(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/chats/${chatId}`)
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        if (!cancelled) setChat(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to fetch chat')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chatId])

  return { chat, loading, error }
}
