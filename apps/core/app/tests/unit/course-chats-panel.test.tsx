import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CourseChatsPanel, CourseChatsTab } from '~/components/courses/course-chats-panel'
import type { CourseChatSummary } from '~/hooks/api/use-course-chats'

const useChatDetailMock = vi.fn()
const useCourseChatsMock = vi.fn()

vi.mock('~/hooks/api/use-course-chats', () => ({
  useChatDetail: (chatId: string | null) => useChatDetailMock(chatId),
  useCourseChats: (courseId: string | undefined) => useCourseChatsMock(courseId),
}))

const CHAT_A: CourseChatSummary = {
  id: 'chat-1',
  title: 'Help with homework',
  ownerId: 'user-1',
  ownerName: 'Alice',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
}

const CHAT_B: CourseChatSummary = {
  id: 'chat-2',
  title: null,
  ownerId: 'user-2',
  ownerName: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-03T00:00:00.000Z',
}

const DEFAULT_CHAT_DETAIL = {
  chat: null,
  loading: false,
  error: null,
  hasMore: false,
  loadingMore: false,
  loadMore: vi.fn(),
}

beforeEach(() => {
  useChatDetailMock.mockReset()
  useChatDetailMock.mockReturnValue(DEFAULT_CHAT_DETAIL)
  useCourseChatsMock.mockReset()
})

describe('CourseChatsPanel', () => {
  it('renders loading state', () => {
    render(<CourseChatsPanel chats={[]} loading />)
    expect(screen.getByText(/loading chats/i)).toBeInTheDocument()
  })

  it('renders error state', () => {
    render(<CourseChatsPanel chats={[]} error="Something broke" />)
    expect(screen.getByText('Something broke')).toBeInTheDocument()
  })

  it('renders empty state when there are no chats and no more to load', () => {
    render(<CourseChatsPanel chats={[]} hasMore={false} />)
    expect(screen.getByText(/no chats yet/i)).toBeInTheDocument()
  })

  it('does not render empty state when chats is empty but hasMore is true', () => {
    render(<CourseChatsPanel chats={[]} hasMore />)
    expect(screen.queryByText(/no chats yet/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /load more chats/i })).toBeInTheDocument()
  })

  it('renders the chat list with title, owner, and date', () => {
    render(<CourseChatsPanel chats={[CHAT_A]} />)
    expect(screen.getByText('Help with homework')).toBeInTheDocument()
    expect(screen.getByText(/alice/i)).toBeInTheDocument()
  })

  it('falls back to "Untitled chat" and ownerId when title/ownerName are missing', () => {
    render(<CourseChatsPanel chats={[CHAT_B]} />)
    expect(screen.getByText('Untitled chat')).toBeInTheDocument()
    expect(screen.getByText('user-2')).toBeInTheDocument()
  })

  it('renders secondaryLabel next to the owner when provided', () => {
    render(
      <CourseChatsPanel
        chats={[CHAT_A]}
        secondaryLabel={(chatId) => (chatId === CHAT_A.id ? 'COSC 101' : null)}
      />
    )
    expect(screen.getByText(/COSC 101/)).toBeInTheDocument()
  })

  it('shows the "Select a chat" placeholder before any chat is selected', () => {
    render(<CourseChatsPanel chats={[CHAT_A]} />)
    expect(screen.getByText(/select a chat to view its messages/i)).toBeInTheDocument()
  })

  it('selects a chat on click and shows loading state for its messages', () => {
    useChatDetailMock.mockReturnValue({ ...DEFAULT_CHAT_DETAIL, loading: true })
    render(<CourseChatsPanel chats={[CHAT_A]} />)
    fireEvent.click(screen.getByText('Help with homework'))
    expect(useChatDetailMock).toHaveBeenCalledWith('chat-1')
    expect(screen.getByText(/loading chat…/i)).toBeInTheDocument()
  })

  it('shows an error message for the selected chat', () => {
    useChatDetailMock.mockReturnValue({ ...DEFAULT_CHAT_DETAIL, error: 'Chat failed to load' })
    render(<CourseChatsPanel chats={[CHAT_A]} />)
    fireEvent.click(screen.getByText('Help with homework'))
    expect(screen.getByText('Chat failed to load')).toBeInTheDocument()
  })

  it('renders "No messages in this chat." when the chat has zero messages', () => {
    useChatDetailMock.mockReturnValue({
      ...DEFAULT_CHAT_DETAIL,
      chat: {
        id: 'chat-1',
        title: 'Help with homework',
        systemPrompt: null,
        adhdAssist: false,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        messages: [],
        nextCursor: null,
      },
    })
    render(<CourseChatsPanel chats={[CHAT_A]} />)
    fireEvent.click(screen.getByText('Help with homework'))
    expect(screen.getByText(/no messages in this chat/i)).toBeInTheDocument()
  })

  it('renders messages with various content shapes via messageText extraction', () => {
    useChatDetailMock.mockReturnValue({
      ...DEFAULT_CHAT_DETAIL,
      chat: {
        id: 'chat-1',
        title: 'Help with homework',
        systemPrompt: null,
        adhdAssist: false,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        messages: [
          { messageId: 'm1', role: 'user', content: 'plain string content', position: 0 },
          { messageId: 'm2', role: 'assistant', content: { content: 'nested content string' }, position: 1 },
          { messageId: 'm3', role: 'assistant', content: { parts: [{ text: 'part one ' }, { text: 'part two' }] }, position: 2 },
          { messageId: 'm4', role: 'assistant', content: { content: [{ text: 'array content text' }] }, position: 3 },
          { messageId: 'm5', role: 'assistant', content: 12345, position: 4 },
        ],
        nextCursor: null,
      },
    })
    render(<CourseChatsPanel chats={[CHAT_A]} />)
    fireEvent.click(screen.getByText('Help with homework'))
    expect(screen.getByText('plain string content')).toBeInTheDocument()
    expect(screen.getByText('nested content string')).toBeInTheDocument()
    expect(screen.getByText('part one part two')).toBeInTheDocument()
    expect(screen.getByText('array content text')).toBeInTheDocument()
    // m5's content is a number, which messageText() reduces to '' — role labels
    // still render for every message including this one.
    expect(screen.getAllByText('user')).toHaveLength(1)
    expect(screen.getAllByText('assistant')).toHaveLength(4)
  })

  it('shows and triggers "Load more messages" when the selected chat has more', () => {
    const loadMore = vi.fn()
    useChatDetailMock.mockReturnValue({
      ...DEFAULT_CHAT_DETAIL,
      chat: {
        id: 'chat-1',
        title: 'Help with homework',
        systemPrompt: null,
        adhdAssist: false,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        messages: [{ messageId: 'm1', role: 'user', content: 'hi', position: 0 }],
        nextCursor: 'cursor-2',
      },
      hasMore: true,
      loadMore,
    })
    render(<CourseChatsPanel chats={[CHAT_A]} />)
    fireEvent.click(screen.getByText('Help with homework'))
    const btn = screen.getByRole('button', { name: /load more messages/i })
    fireEvent.click(btn)
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('disables and relabels the "Load more messages" button while loadingMore', () => {
    useChatDetailMock.mockReturnValue({
      ...DEFAULT_CHAT_DETAIL,
      chat: {
        id: 'chat-1',
        title: 'Help with homework',
        systemPrompt: null,
        adhdAssist: false,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        messages: [],
        nextCursor: 'cursor-2',
      },
      hasMore: true,
      loadingMore: true,
    })
    render(<CourseChatsPanel chats={[CHAT_A]} />)
    fireEvent.click(screen.getByText('Help with homework'))
    const btn = screen.getByRole('button', { name: /^loading…$/i })
    expect(btn).toBeDisabled()
  })

  it('calls onLoadMore when the "Load more chats" button is clicked', () => {
    const onLoadMore = vi.fn()
    render(<CourseChatsPanel chats={[CHAT_A]} hasMore onLoadMore={onLoadMore} />)
    fireEvent.click(screen.getByRole('button', { name: /load more chats/i }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('disables and relabels the "Load more chats" button while loadingMore', () => {
    render(<CourseChatsPanel chats={[CHAT_A]} hasMore loadingMore />)
    const buttons = screen.getAllByRole('button', { name: /^loading…$/i })
    expect(buttons.length).toBeGreaterThanOrEqual(1)
    expect(buttons[0]).toBeDisabled()
  })
})

describe('CourseChatsTab', () => {
  it('wires useCourseChats output into CourseChatsPanel', () => {
    const loadMore = vi.fn()
    useCourseChatsMock.mockReturnValue({
      chats: [CHAT_A],
      loading: false,
      error: null,
      hasMore: true,
      loadingMore: false,
      loadMore,
    })
    render(<CourseChatsTab courseId="course-1" />)
    expect(useCourseChatsMock).toHaveBeenCalledWith('course-1')
    expect(screen.getByText('Help with homework')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /load more chats/i }))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('shows the loading state from useCourseChats', () => {
    useCourseChatsMock.mockReturnValue({
      chats: [],
      loading: true,
      error: null,
      hasMore: false,
      loadingMore: false,
      loadMore: vi.fn(),
    })
    render(<CourseChatsTab courseId="course-1" />)
    expect(screen.getByText(/loading chats/i)).toBeInTheDocument()
  })
})
