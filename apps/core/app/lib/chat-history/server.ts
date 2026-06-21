import type { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";

/**
 * Chat-history access control (#chat-history).
 *
 * This legacy listing path (GET /api/chats, GET /api/chats/:id/messages) is
 * scoped to OWN chats only, plus ADMIN who sees everything. Staff oversight of
 * student course chats is a policy-gated, student-owner-scoped capability served
 * exclusively by the §5c endpoints (/api/courses/:id/chats, /api/units/:dept/chats,
 * /api/chats/:id) via courseChatViewPolicyKey — it is intentionally NOT granted
 * here, so an instructor/TA/unit-admin cannot read another user's chats through
 * this path regardless of any flag.
 *
 * EDIT (append/continue) is owner-only. The visibility filter is composed as a
 * Prisma WHERE so listing is secure by construction: narrowing by courseId/userId
 * can never widen what a viewer is allowed to see.
 */

export type ChatHistoryViewer = {
  id: string;
  role?: string | null;
  authorizedUnits?: string[];
};

export type ChatHistoryItem = {
  id: string;
  title: string | null;
  preview: string | null;
  courseId: string | null;
  courseCode: string | null;
  courseName: string | null;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ListChatsOptions = {
  /** Restrict to a single course. Combined with the visibility filter. */
  courseId?: string;
  /** Restrict to a single chat owner. Combined with the visibility filter. */
  userId?: string;
  /** Force own-chats-only regardless of role (used by the chat sidebar). */
  scope?: "own" | "all";
  limit?: number;
};

/** Pull a short plain-text preview out of a stored ChatMessage `content` JSON. */
function extractText(content: Prisma.JsonValue | null | undefined): string | null {
  if (!content) return null;
  if (typeof content === "string") return content.trim() || null;
  if (typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.content === "string" && obj.content.trim()) return obj.content.trim();
    if (Array.isArray(obj.parts)) {
      const text = obj.parts
        .filter((p): p is { type: string; text: string } =>
          !!p && typeof p === "object" && (p as any).type === "text" && typeof (p as any).text === "string",
        )
        .map((p) => p.text)
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return null;
}

function truncate(text: string | null, max = 120): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/**
 * Prisma WHERE filter scoping chat listing to what `viewer` may read on this
 * legacy path. ADMIN gets an empty filter (everything); every other viewer is
 * scoped to their OWN chats. Policy-gated staff oversight of student course
 * chats is served only by the §5c endpoints and is never widened here.
 */
export async function buildChatVisibilityFilter(
  viewer: ChatHistoryViewer,
): Promise<Prisma.ChatWhereInput> {
  // ADMIN oversight is unconditional (courseChatViewPolicyKey('admin') ===
  // 'always'); everyone else sees only the chats they own.
  if (viewer.role === "ADMIN") return {};
  return { userId: viewer.id };
}

/**
 * Resolve read/edit access for a single chat. Returns `chat: null` when the
 * chat does not exist OR the viewer may not read it (callers should answer 404
 * either way — no existence leak).
 */
export async function canAccessChat(
  viewer: ChatHistoryViewer,
  chatId: string,
): Promise<{
  chat:
    | {
        id: string;
        userId: string;
        courseId: string | null;
        systemPrompt: string | null;
        title: string | null;
        adhdAssist: boolean;
        createdAt: Date;
        updatedAt: Date;
        course: { id: string; code: string; name: string } | null;
        user: { id: string; name: string | null; email: string };
      }
    | null;
  canView: boolean;
  canEdit: boolean;
}> {
  const visibility = await buildChatVisibilityFilter(viewer);
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, ...visibility },
    select: {
      id: true,
      userId: true,
      courseId: true,
      systemPrompt: true,
      title: true,
      adhdAssist: true,
      createdAt: true,
      updatedAt: true,
      course: { select: { id: true, code: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!chat) return { chat: null, canView: false, canEdit: false };

  return {
    chat,
    canView: true,
    canEdit: chat.userId === viewer.id,
  };
}

/**
 * List chats visible to `viewer`, optionally narrowed by course/owner. Results
 * are newest-first and carry a lightweight first-user-message preview so the UI
 * has something to show (chat titles are not auto-generated).
 */
export async function listChats(
  viewer: ChatHistoryViewer,
  options: ListChatsOptions = {},
): Promise<ChatHistoryItem[]> {
  const { courseId, userId, scope, limit = 30 } = options;

  const visibility =
    scope === "own"
      ? { userId: viewer.id }
      : await buildChatVisibilityFilter(viewer);

  const where: Prisma.ChatWhereInput = {
    AND: [
      visibility,
      ...(courseId ? [{ courseId }] : []),
      ...(userId ? [{ userId }] : []),
    ],
  };

  const chats = await prisma.chat.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      title: true,
      courseId: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
      course: { select: { code: true, name: true } },
      user: { select: { name: true, email: true } },
      _count: { select: { messages: true } },
    },
  });

  if (chats.length === 0) return [];

  // One extra query for first-user-message previews across the listed chats.
  const firstMessages = await prisma.chatMessage.findMany({
    where: { chatId: { in: chats.map((c) => c.id) }, role: "user" },
    orderBy: { position: "asc" },
    distinct: ["chatId"],
    select: { chatId: true, content: true },
  });
  const previewByChat = new Map<string, string | null>(
    firstMessages.map((m) => [m.chatId, truncate(extractText(m.content))]),
  );

  return chats.map((c) => ({
    id: c.id,
    title: c.title,
    preview: previewByChat.get(c.id) ?? null,
    courseId: c.courseId,
    courseCode: c.course?.code ?? null,
    courseName: c.course?.name ?? null,
    userId: c.userId,
    userName: c.user?.name ?? null,
    userEmail: c.user?.email ?? null,
    messageCount: c._count.messages,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

/** Load the full ordered message list for a chat (no access check — callers gate). */
export async function getChatMessages(chatId: string) {
  const rows = await prisma.chatMessage.findMany({
    where: { chatId },
    orderBy: { position: "asc" },
    select: { messageId: true, role: true, content: true },
  });
  return rows;
}
