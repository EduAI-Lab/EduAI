// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// buildChatVisibilityFilter takes no DB calls on the non-admin path and an empty
// filter on the admin path, so a bare prisma mock is enough to import the module.
const prismaMock = vi.hoisted(() => ({
  chat: { findFirst: vi.fn(), findMany: vi.fn() },
  chatMessage: { findMany: vi.fn() },
  enrollment: { findFirst: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessGate: vi.fn(),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn(),
}));

import {
  buildChatVisibilityFilter,
  resolveChatReadAccess,
  listChats,
  getChatMessages,
} from "~/lib/chat-history/server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { getPolicy } from "~/lib/policy.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildChatVisibilityFilter — legacy listing path (#5c)", () => {
  it("ADMIN sees every chat (empty filter)", async () => {
    expect(await buildChatVisibilityFilter({ id: "a1", role: "ADMIN" })).toEqual({});
  });

  // Regression for the legacy-oversight bypass: staff roles must NOT gain
  // course-chat visibility through this path — oversight is policy-gated and
  // served only by the §5c endpoints. Every non-admin viewer is scoped to own.
  it.each(["INSTRUCTOR", "TA", "UNIT_ADMIN", "STUDENT", null] as const)(
    "role=%s is scoped to own chats only — no course-oversight branches",
    async (role) => {
      const filter = await buildChatVisibilityFilter({ id: "u1", role });
      expect(filter).toEqual({ userId: "u1" });
    },
  );
});

const BASE_CHAT_ROW = {
  id: "chat-1",
  userId: "owner-1",
  courseId: null as string | null,
  systemPrompt: null,
  title: "Test chat",
  adhdAssist: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  course: null,
  user: { id: "owner-1", name: "Alex Patel", email: "student1@eduai.local" },
};

describe("resolveChatReadAccess", () => {
  it("returns null when the chat does not exist", async () => {
    prismaMock.chat.findFirst.mockResolvedValue(null);

    const result = await resolveChatReadAccess({ id: "u1", role: "STUDENT" }, "missing");

    expect(result).toBeNull();
    expect(resolveCourseAccessGate).not.toHaveBeenCalled();
  });

  it("grants the owner access without consulting course access", async () => {
    prismaMock.chat.findFirst.mockResolvedValue(BASE_CHAT_ROW);

    const result = await resolveChatReadAccess({ id: "owner-1", role: "STUDENT" }, "chat-1");

    expect(result).toEqual({ chat: BASE_CHAT_ROW, isOwner: true, canEdit: true });
    expect(resolveCourseAccessGate).not.toHaveBeenCalled();
  });

  it("grants ADMIN access without consulting course access", async () => {
    prismaMock.chat.findFirst.mockResolvedValue(BASE_CHAT_ROW);

    const result = await resolveChatReadAccess({ id: "other-1", role: "ADMIN" }, "chat-1");

    expect(result).toEqual({ chat: BASE_CHAT_ROW, isOwner: false, canEdit: false });
    expect(resolveCourseAccessGate).not.toHaveBeenCalled();
  });

  it("denies a non-owner, non-admin viewer when the chat has no course", async () => {
    prismaMock.chat.findFirst.mockResolvedValue(BASE_CHAT_ROW);

    const result = await resolveChatReadAccess({ id: "other-1", role: "INSTRUCTOR" }, "chat-1");

    expect(result).toBeNull();
    expect(resolveCourseAccessGate).not.toHaveBeenCalled();
  });

  it("denies a course viewer whose access level gates to 'never' (e.g. TA)", async () => {
    prismaMock.chat.findFirst.mockResolvedValue({ ...BASE_CHAT_ROW, courseId: "c1" });
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" } as never,
      access: { level: "ta", rank: 1 },
    });

    const result = await resolveChatReadAccess({ id: "ta-1", role: "INSTRUCTOR" }, "chat-1");

    expect(result).toBeNull();
    expect(getPolicy).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
  });

  it("denies an instructor when the course-chat-view policy flag is off", async () => {
    prismaMock.chat.findFirst.mockResolvedValue({ ...BASE_CHAT_ROW, courseId: "c1" });
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" } as never,
      access: { level: "instructor", rank: 2 },
    });
    vi.mocked(getPolicy).mockResolvedValue(false);

    const result = await resolveChatReadAccess({ id: "instr-1", role: "INSTRUCTOR" }, "chat-1");

    expect(result).toBeNull();
    expect(getPolicy).toHaveBeenCalledWith("instructors.canViewCourseChats");
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
  });

  it("denies an instructor when the policy is on but the chat owner is not an active student", async () => {
    prismaMock.chat.findFirst.mockResolvedValue({ ...BASE_CHAT_ROW, courseId: "c1" });
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" } as never,
      access: { level: "instructor", rank: 2 },
    });
    vi.mocked(getPolicy).mockResolvedValue(true);
    prismaMock.enrollment.findFirst.mockResolvedValue(null);

    const result = await resolveChatReadAccess({ id: "instr-1", role: "INSTRUCTOR" }, "chat-1");

    expect(result).toBeNull();
  });

  it("grants a unit admin non-editable oversight access when policy is on and owner is an active student", async () => {
    const chatRow = { ...BASE_CHAT_ROW, courseId: "c1" };
    prismaMock.chat.findFirst.mockResolvedValue(chatRow);
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" } as never,
      access: { level: "unit", rank: 3 },
    });
    vi.mocked(getPolicy).mockResolvedValue(true);
    prismaMock.enrollment.findFirst.mockResolvedValue({ id: "enroll-1" });

    const result = await resolveChatReadAccess({ id: "ua-1", role: "UNIT_ADMIN" }, "chat-1");

    expect(result).toEqual({ chat: chatRow, isOwner: false, canEdit: false });
    expect(getPolicy).toHaveBeenCalledWith("unitAdmins.canViewUnitChats");
    expect(prismaMock.enrollment.findFirst).toHaveBeenCalledWith({
      where: { courseId: "c1", userId: "owner-1", role: "STUDENT", isActive: true },
      select: { id: true },
    });
  });

  it("treats an 'always' gate as open without calling getPolicy", async () => {
    const chatRow = { ...BASE_CHAT_ROW, courseId: "c1" };
    prismaMock.chat.findFirst.mockResolvedValue(chatRow);
    // Contrived but exercises the 'always' branch of the course-oversight gate
    // (courseChatViewPolicyKey('admin') === 'always') independent of viewer.role.
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "c1" } as never,
      access: { level: "admin", rank: 4 },
    });
    prismaMock.enrollment.findFirst.mockResolvedValue({ id: "enroll-1" });

    const result = await resolveChatReadAccess({ id: "weird-1", role: "INSTRUCTOR" }, "chat-1");

    expect(result).toEqual({ chat: chatRow, isOwner: false, canEdit: false });
    expect(getPolicy).not.toHaveBeenCalled();
  });
});

describe("getChatMessages", () => {
  it("loads the ordered message list for a chat with no access check", async () => {
    const rows = [{ messageId: "m1", role: "user", content: "hi" }];
    prismaMock.chatMessage.findMany.mockResolvedValue(rows);

    const result = await getChatMessages("chat-1");

    expect(result).toBe(rows);
    expect(prismaMock.chatMessage.findMany).toHaveBeenCalledWith({
      where: { chatId: "chat-1" },
      orderBy: { position: "asc" },
      select: { messageId: true, role: true, content: true },
    });
  });
});

describe("listChats", () => {
  it("returns [] immediately when no chats match, without a preview query", async () => {
    prismaMock.chat.findMany.mockResolvedValue([]);

    const result = await listChats({ id: "u1", role: "STUDENT" });

    expect(result).toEqual([]);
    expect(prismaMock.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it("forces own-scope filtering regardless of role when scope: 'own'", async () => {
    prismaMock.chat.findMany.mockResolvedValue([]);

    await listChats({ id: "admin-1", role: "ADMIN" }, { scope: "own" });

    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ userId: "admin-1" }] },
      }),
    );
  });

  it("combines courseId and userId narrowing with the visibility filter", async () => {
    prismaMock.chat.findMany.mockResolvedValue([]);

    await listChats(
      { id: "admin-1", role: "ADMIN" },
      { courseId: "c1", userId: "owner-1" },
    );

    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{}, { courseId: "c1" }, { userId: "owner-1" }] },
      }),
    );
  });

  it("clamps limit between 1 and 100", async () => {
    prismaMock.chat.findMany.mockResolvedValue([]);

    await listChats({ id: "u1", role: "STUDENT" }, { limit: 9999 });
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));

    await listChats({ id: "u1", role: "STUDENT" }, { limit: -5 });
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });

  it("builds previews from string, object, and parts-array message content, and skips missing ones", async () => {
    const longText = "x".repeat(130);
    prismaMock.chat.findMany.mockResolvedValue([
      {
        id: "chat-str",
        title: "Chat A",
        courseId: "c1",
        userId: "owner-1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        course: { code: "COSC 101", name: "Intro" },
        user: { name: "Alex", email: "alex@eduai.local" },
        _count: { messages: 3 },
      },
      {
        id: "chat-obj",
        title: "Chat B",
        courseId: null,
        userId: "owner-2",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        course: null,
        user: null,
        _count: { messages: 1 },
      },
      {
        id: "chat-parts",
        title: "Chat C",
        courseId: null,
        userId: "owner-3",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        course: null,
        user: { name: null, email: "c@eduai.local" },
        _count: { messages: 1 },
      },
      {
        id: "chat-none",
        title: "Chat D",
        courseId: null,
        userId: "owner-4",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        course: null,
        user: { name: "Dana", email: "d@eduai.local" },
        _count: { messages: 0 },
      },
      {
        id: "chat-long",
        title: "Chat E",
        courseId: null,
        userId: "owner-5",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        course: null,
        user: { name: "Eli", email: "e@eduai.local" },
        _count: { messages: 1 },
      },
      {
        id: "chat-empty-obj",
        title: "Chat F",
        courseId: null,
        userId: "owner-6",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        course: null,
        user: { name: "Fin", email: "f@eduai.local" },
        _count: { messages: 1 },
      },
    ]);
    prismaMock.chatMessage.findMany.mockResolvedValue([
      { chatId: "chat-str", content: "  hello world  " },
      { chatId: "chat-obj", content: { content: "from object field" } },
      {
        chatId: "chat-parts",
        content: { parts: [{ type: "text", text: "part one" }, { type: "text", text: "part two" }] },
      },
      { chatId: "chat-none", content: null },
      { chatId: "chat-long", content: longText },
      // object with neither a `content` string nor a usable `parts` array —
      // falls through both inner checks to the final `return null`.
      { chatId: "chat-empty-obj", content: { unrelated: true } },
    ]);

    const result = await listChats({ id: "admin-1", role: "ADMIN" });

    expect(result).toHaveLength(6);
    const byId = new Map(result.map((c) => [c.id, c]));
    expect(byId.get("chat-str")).toMatchObject({ preview: "hello world", courseCode: "COSC 101" });
    expect(byId.get("chat-obj")).toMatchObject({ preview: "from object field", userName: null });
    expect(byId.get("chat-parts")).toMatchObject({ preview: "part one part two" });
    expect(byId.get("chat-none")).toMatchObject({ preview: null });
    const longPreview = byId.get("chat-long")!.preview!;
    expect(longPreview.length).toBe(121); // 120 chars + ellipsis
    expect(longPreview.endsWith("…")).toBe(true);
    expect(byId.get("chat-empty-obj")).toMatchObject({ preview: null });
  });
});
