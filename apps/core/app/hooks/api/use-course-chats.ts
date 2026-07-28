import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '~/hooks/api/config'

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
  nextCursor: string | null
}

/** Lists chats for a course — GET /api/courses/:courseId/chats (§5c). Cursor "load more" (#1042). */
export function useCourseChats(courseId: string | undefined, enabled = true) {
  const [chats, setChats] = useState<CourseChatSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchPage = useCallback(async (cursor: string | null) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    return apiFetch<{ chats: CourseChatSummary[]; nextCursor: string | null }>(
      `/api/courses/${courseId}/chats${query}`,
    )
  }, [courseId])

  const fetchChats = useCallback(async () => {
    if (!courseId || !enabled) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPage(null)
      setChats(data.chats ?? [])
      setNextCursor(data.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch chats')
    } finally {
      setLoading(false)
    }
  }, [courseId, enabled, fetchPage])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await fetchPage(nextCursor)
      setChats((prev) => [...prev, ...(data.chats ?? [])])
      setNextCursor(data.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more chats')
    } finally {
      setLoadingMore(false)
    }
  }, [fetchPage, nextCursor, loadingMore])

  useEffect(() => {
    void fetchChats()
  }, [fetchChats])

  return { chats, loading, error, hasMore: nextCursor !== null, loadingMore, loadMore, refetch: fetchChats }
}

/** Lists chats across a unit — GET /api/units/:department/chats (§5c). Cursor "load more" (#1042). */
export function useUnitChats(department: string | undefined, enabled = true) {
  const [chats, setChats] = useState<UnitChatSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchPage = useCallback(async (cursor: string | null) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    return apiFetch<{ chats: UnitChatSummary[]; nextCursor: string | null }>(
      `/api/units/${encodeURIComponent(department ?? '')}/chats${query}`,
    )
  }, [department])

  const fetchChats = useCallback(async () => {
    if (!department || !enabled) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPage(null)
      setChats(data.chats ?? [])
      setNextCursor(data.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch chats')
    } finally {
      setLoading(false)
    }
  }, [department, enabled, fetchPage])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await fetchPage(nextCursor)
      setChats((prev) => [...prev, ...(data.chats ?? [])])
      setNextCursor(data.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more chats')
    } finally {
      setLoadingMore(false)
    }
  }, [fetchPage, nextCursor, loadingMore])

  useEffect(() => {
    void fetchChats()
  }, [fetchChats])

  return { chats, loading, error, hasMore: nextCursor !== null, loadingMore, loadMore, refetch: fetchChats }
}

/**
 * Reads a single chat (metadata + messages) — GET /api/chats/:chatId (§5c).
 * Messages page in via cursor "load more" (#1042) instead of one unbounded
 * transcript fetch.
 */
export function useChatDetail(chatId: string | null) {
  const [chat, setChat] = useState<ChatDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
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
        const data = await apiFetch<ChatDetail>(`/api/chats/${chatId}`)
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

  const loadMore = useCallback(async () => {
    if (!chatId || !chat?.nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await apiFetch<ChatDetail>(
        `/api/chats/${chatId}?cursor=${encodeURIComponent(chat.nextCursor)}`,
      )
      setChat((prev) =>
        prev ? { ...data, messages: [...prev.messages, ...data.messages] } : data,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more messages')
    } finally {
      setLoadingMore(false)
    }
  }, [chatId, chat?.nextCursor, loadingMore])

  return { chat, loading, error, loadingMore, hasMore: chat?.nextCursor != null, loadMore }
}
