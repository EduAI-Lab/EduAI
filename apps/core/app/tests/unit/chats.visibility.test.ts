// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  chat: { findMany: vi.fn(), findFirst: vi.fn() },
  chatMessage: { findMany: vi.fn() },
  enrollment: { findFirst: vi.fn(), findMany: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
  getAuthorizedUnits: vi.fn(),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn(),
  logPolicyDenial: vi.fn(),
  denyByPolicy: vi.fn(
    () =>
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}));

import { loader as courseChatsLoader } from "~/routes/api/courses.chats.$";
import { loader as unitChatsLoader } from "~/routes/api/units.chats.$";
import { loader as chatDetailLoader } from "~/routes/api/chats.$chatId";
import { loader as chatMessagesLoader } from "~/routes/api/chats.$chatId.messages";
import { auth } from "~/lib/auth/server";
import {
  resolveCourseAccessWithCourse,
  getAuthorizedUnits,
} from "~/lib/auth/course-access.server";
import { getPolicy } from "~/lib/policy.server";

const AT = new Date("2025-01-01T00:00:00.000Z");

function session(role: string, id = "u1") {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id, role } } as never);
}

function access(level: string | null, rank = 0) {
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: level === null ? null : ({ id: "c1", department: "COSC" } as never),
    access: level === null ? null : ({ level, rank } as never),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.chat.findMany.mockResolvedValue([]);
  prismaMock.chatMessage.findMany.mockResolvedValue([
    { messageId: "m1", role: "user", content: "hi", position: 1 },
  ]);
  prismaMock.enrollment.findFirst.mockResolvedValue(null);
  prismaMock.enrollment.findMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// GET /api/courses/:courseId/chats
// ---------------------------------------------------------------------------

function courseArgs(courseId = "c1") {
  return {
    request: new Request(`http://localhost/api/courses/${courseId}/chats`),
    params: { courseId },
    context: {} as never,
  } as any;
}

describe("GET /api/courses/:courseId/chats", () => {
  it("401s an anonymous request", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await courseChatsLoader(courseArgs());
    expect(res.status).toBe(401);
  });

  it("returns 403 for an INSTRUCTOR when instructors.canViewCourseChats is off", async () => {
    session("INSTRUCTOR");
    access("instructor", 2);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await courseChatsLoader(courseArgs());
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("instructors.canViewCourseChats");
  });

  it("returns 200 for an INSTRUCTOR when the flag is on, excluding non-course chats", async () => {
    session("INSTRUCTOR");
    access("instructor", 2);
    vi.mocked(getPolicy).mockResolvedValue(true);
    prismaMock.chat.findMany.mockResolvedValue([
      { id: "chat-1", title: "Q1", createdAt: AT, updatedAt: AT, user: { id: "s1", name: "Stu" } },
    ]);
    const res = await courseChatsLoader(courseArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chats).toHaveLength(1);
    expect(body.chats[0]).toMatchObject({ id: "chat-1", ownerId: "s1", ownerName: "Stu" });
    // Only chats tagged with this course AND owned by an active STUDENT of the
    // course are returned — staff (instructor/TA/unit-admin) chats are excluded.
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          courseId: "c1",
          user: {
            enrollments: { some: { courseId: "c1", role: "STUDENT", isActive: true } },
          },
        },
      }),
    );
  });

  it("returns 403 for a UNIT_ADMIN when unitAdmins.canViewUnitChats is off", async () => {
    session("UNIT_ADMIN");
    access("unit", 3);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await courseChatsLoader(courseArgs());
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("unitAdmins.canViewUnitChats");
  });

  it("ADMIN reads course chats without any flag (200)", async () => {
    session("ADMIN");
    access("admin", 4);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await courseChatsLoader(courseArgs());
    expect(res.status).toBe(200);
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it("returns 403 for a TA/STUDENT regardless of flags", async () => {
    session("STUDENT");
    access("ta", 1);
    const res = await courseChatsLoader(courseArgs());
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/units/:department/chats
// ---------------------------------------------------------------------------

function unitArgs(department = "COSC", query = "") {
  return {
    request: new Request(`http://localhost/api/units/${department}/chats${query}`),
    params: { department },
    context: {} as never,
  } as any;
}

describe("GET /api/units/:department/chats", () => {
  it("returns 403 for an INSTRUCTOR (no unit aggregate)", async () => {
    session("INSTRUCTOR");
    const res = await unitChatsLoader(unitArgs());
    expect(res.status).toBe(403);
  });

  it("returns 403 for a UNIT_ADMIN outside their authorized units", async () => {
    session("UNIT_ADMIN");
    vi.mocked(getAuthorizedUnits).mockResolvedValue(["MATH"]);
    const res = await unitChatsLoader(unitArgs("COSC"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for a UNIT_ADMIN in-unit when unitAdmins.canViewUnitChats is off", async () => {
    session("UNIT_ADMIN");
    vi.mocked(getAuthorizedUnits).mockResolvedValue(["COSC"]);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await unitChatsLoader(unitArgs("COSC"));
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("unitAdmins.canViewUnitChats");
  });

  it("returns 200 scoped to the department when in-unit and the flag is on", async () => {
    session("UNIT_ADMIN");
    vi.mocked(getAuthorizedUnits).mockResolvedValue(["COSC"]);
    vi.mocked(getPolicy).mockResolvedValue(true);
    prismaMock.chat.findMany.mockResolvedValue([
      {
        id: "chat-1", title: "Q", createdAt: AT, updatedAt: AT,
        user: { id: "s1", name: "Stu" },
        course: { id: "c1", code: "COSC 101", name: "Intro" },
      },
    ]);
    // s1 is an active STUDENT of c1, so their chat survives the owner-role filter.
    prismaMock.enrollment.findMany.mockResolvedValue([{ courseId: "c1", userId: "s1" }]);
    const res = await unitChatsLoader(unitArgs("COSC"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chats[0]).toMatchObject({ courseCode: "COSC 101" });
    // Aggregate is scoped to courses in this department only.
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { course: { department: "COSC", deletedAt: null } } }),
    );
  });

  it("excludes chats NOT owned by an active student of the chat's own course", async () => {
    session("UNIT_ADMIN");
    vi.mocked(getAuthorizedUnits).mockResolvedValue(["COSC"]);
    vi.mocked(getPolicy).mockResolvedValue(true);
    prismaMock.chat.findMany.mockResolvedValue([
      {
        id: "chat-staff", title: "TA notes", createdAt: AT, updatedAt: AT,
        user: { id: "ta1", name: "TA" },
        course: { id: "c1", code: "COSC 101", name: "Intro" },
      },
    ]);
    // ta1 holds no STUDENT enrollment in c1 — their course chat must not appear.
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    const res = await unitChatsLoader(unitArgs("COSC"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chats).toHaveLength(0);
  });

  it("ADMIN reads any unit aggregate without a flag (200)", async () => {
    session("ADMIN");
    vi.mocked(getPolicy).mockResolvedValue(false);
    prismaMock.chat.findMany.mockResolvedValue([
      {
        id: "chat-1", title: "Q", createdAt: AT, updatedAt: AT,
        user: { id: "s1", name: "Stu" },
        course: { id: "c1", code: "COSC 101", name: "Intro" },
      },
    ]);
    prismaMock.enrollment.findMany.mockResolvedValue([{ courseId: "c1", userId: "s1" }]);
    const res = await unitChatsLoader(unitArgs("COSC"));
    expect(res.status).toBe(200);
    expect(getPolicy).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.chats).toHaveLength(1);
  });

  // #1042 — cursor "load more" pagination, including the batched owner-role
  // filter (the chat/enrollment relation can't be correlated in one Prisma
  // `where`, so matching rows are filtered in memory per raw-row batch).
  it("bounds the response to `limit` and resumes from the last raw row scanned", async () => {
    session("ADMIN");
    // Batch of 2 raw rows (limit=2), both owned by active students — a full
    // page with more data behind it.
    prismaMock.chat.findMany.mockResolvedValueOnce([
      { id: "chat-2", title: "B", createdAt: AT, updatedAt: AT, user: { id: "s2", name: "Stu2" }, course: { id: "c1", code: "COSC 101", name: "Intro" } },
      { id: "chat-1", title: "A", createdAt: AT, updatedAt: AT, user: { id: "s1", name: "Stu1" }, course: { id: "c1", code: "COSC 101", name: "Intro" } },
    ]);
    prismaMock.enrollment.findMany.mockResolvedValue([
      { courseId: "c1", userId: "s1" },
      { courseId: "c1", userId: "s2" },
    ]);
    const res = await unitChatsLoader(unitArgs("COSC", "?limit=2"));
    const body = await res.json();
    expect(body.chats).toHaveLength(2);
    expect(body.nextCursor).toBe("chat-1");
  });

  it("does not drop chats that are filtered-in but trimmed by `limit` across batches (regression)", async () => {
    session("ADMIN");
    const row = (id: string, userId: string) => ({
      id, title: id, createdAt: AT, updatedAt: AT,
      user: { id: userId, name: userId },
      course: { id: "c1", code: "COSC 101", name: "Intro" },
    });
    // Batch 1 (raw take=2): chat-4 matches, chat-3 doesn't (staff chat) — only
    // 1 filtered row so far, batch not exhausted (2 raw rows returned, equal
    // to `limit`), loop continues.
    prismaMock.chat.findMany
      .mockResolvedValueOnce([row("chat-4", "s1"), row("chat-3", "staff1")])
      // Batch 2: both rows match — pushes the accumulated filtered count to 3,
      // one past `limit`=2 (overflow within the *loop*, spread across batches).
      .mockResolvedValueOnce([row("chat-2", "s1"), row("chat-1", "s1")]);
    prismaMock.enrollment.findMany.mockResolvedValue([{ courseId: "c1", userId: "s1" }]);

    const res = await unitChatsLoader(unitArgs("COSC", "?limit=2"));
    const body = await res.json();

    expect(body.chats.map((c: { id: string }) => c.id)).toEqual(["chat-4", "chat-2"]);
    // Regression: nextCursor must resume at the last row actually RETURNED
    // (chat-2), not the raw batch cursor (chat-1) — the naive "always resume
    // from the last raw row scanned" version skips chat-1 forever, since it
    // was fetched, matched, but trimmed off before ever reaching the client.
    expect(body.nextCursor).toBe("chat-2");
  });
});

// ---------------------------------------------------------------------------
// GET /api/chats/:chatId — course-authorized viewer extension
// ---------------------------------------------------------------------------

function detailArgs(chatId = "chat-1") {
  return {
    request: new Request(`http://localhost/api/chats/${chatId}`),
    params: { chatId },
    context: {} as never,
  } as any;
}

// Metadata-only row — the loader fetches message bodies separately (and only
// for non-owner oversight reads), so chat.findFirst no longer selects messages.
const CHAT_ROW = {
  id: "chat-1",
  userId: "owner-1",
  courseId: "c1",
  systemPrompt: null,
  title: "Q",
  adhdAssist: false,
  createdAt: AT,
  updatedAt: AT,
};

describe("GET /api/chats/:chatId (course-authorized viewer)", () => {
  it("lets the owner read their chat metadata WITHOUT pulling the transcript", async () => {
    session("STUDENT", "owner-1");
    prismaMock.chat.findFirst.mockResolvedValue(CHAT_ROW);
    const res = await chatDetailLoader(detailArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("userId"); // owner/course ids stripped
    // Owner session-resume reads metadata only — no over-fetch of messages.
    expect(body.messages).toBeUndefined();
    expect(prismaMock.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it("lets a course INSTRUCTOR read a STUDENT chat (with transcript) when the flag is on", async () => {
    session("INSTRUCTOR", "instr-1");
    prismaMock.chat.findFirst.mockResolvedValue(CHAT_ROW);
    access("instructor", 2);
    vi.mocked(getPolicy).mockResolvedValue(true);
    // The chat's owner is an active STUDENT of the course.
    prismaMock.enrollment.findFirst.mockResolvedValue({ id: "e1" });
    const res = await chatDetailLoader(detailArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1); // oversight read includes the transcript
    expect(prismaMock.enrollment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "owner-1", role: "STUDENT", isActive: true }),
      }),
    );
  });

  it("404s an INSTRUCTOR reading a NON-student (e.g. staff) chat even with the flag on", async () => {
    session("INSTRUCTOR", "instr-1");
    prismaMock.chat.findFirst.mockResolvedValue(CHAT_ROW);
    access("instructor", 2);
    vi.mocked(getPolicy).mockResolvedValue(true);
    // Owner is not an active STUDENT of the course (e.g. a co-instructor/TA).
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    const res = await chatDetailLoader(detailArgs());
    expect(res.status).toBe(404);
    expect(prismaMock.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it("404s a non-owner INSTRUCTOR when the flag is off (no existence leak)", async () => {
    session("INSTRUCTOR", "instr-1");
    prismaMock.chat.findFirst.mockResolvedValue(CHAT_ROW);
    access("instructor", 2);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await chatDetailLoader(detailArgs());
    expect(res.status).toBe(404);
  });

  it("ADMIN reads any chat", async () => {
    session("ADMIN", "admin-1");
    prismaMock.chat.findFirst.mockResolvedValue(CHAT_ROW);
    const res = await chatDetailLoader(detailArgs());
    expect(res.status).toBe(200);
  });
});

// The transcript route must honour the SAME §5c oversight gate as the metadata
// route above — both resolve access through `resolveChatReadAccess`, so the two
// can never drift. These cases pin the leaks the shared gate closes: a staff
// viewer with the flag OFF, and a staff viewer reading a non-student chat.
const MSG_CHAT_ROW = {
  ...CHAT_ROW,
  course: { id: "c1", code: "COSC101", name: "Intro" },
  user: { id: "owner-1", name: "Stu Dent", email: "stu@ubc.ca" },
};

function messagesArgs(chatId = "chat-1") {
  return {
    request: new Request(`http://localhost/api/chats/${chatId}/messages`),
    params: { chatId },
    context: {} as never,
  } as any;
}

describe("GET /api/chats/:chatId/messages (transcript oversight gate)", () => {
  it("lets the owner read their own transcript", async () => {
    session("STUDENT", "owner-1");
    prismaMock.chat.findFirst.mockResolvedValue(MSG_CHAT_ROW);
    const res = await chatMessagesLoader(messagesArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.canEdit).toBe(true);
  });

  it("lets a course INSTRUCTOR read a STUDENT transcript when the flag is on", async () => {
    session("INSTRUCTOR", "instr-1");
    prismaMock.chat.findFirst.mockResolvedValue(MSG_CHAT_ROW);
    access("instructor", 2);
    vi.mocked(getPolicy).mockResolvedValue(true);
    prismaMock.enrollment.findFirst.mockResolvedValue({ id: "e1" });
    const res = await chatMessagesLoader(messagesArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.canEdit).toBe(false); // oversight read is never editable
  });

  it("404s a non-owner INSTRUCTOR when the flag is OFF (gate not bypassable via /messages)", async () => {
    session("INSTRUCTOR", "instr-1");
    prismaMock.chat.findFirst.mockResolvedValue(MSG_CHAT_ROW);
    access("instructor", 2);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await chatMessagesLoader(messagesArgs());
    expect(res.status).toBe(404);
    expect(prismaMock.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it("404s an INSTRUCTOR reading a NON-student (staff) transcript even with the flag on", async () => {
    session("INSTRUCTOR", "instr-1");
    prismaMock.chat.findFirst.mockResolvedValue(MSG_CHAT_ROW);
    access("instructor", 2);
    vi.mocked(getPolicy).mockResolvedValue(true);
    prismaMock.enrollment.findFirst.mockResolvedValue(null); // owner is not an active STUDENT
    const res = await chatMessagesLoader(messagesArgs());
    expect(res.status).toBe(404);
    expect(prismaMock.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it("ADMIN reads any transcript", async () => {
    session("ADMIN", "admin-1");
    prismaMock.chat.findFirst.mockResolvedValue(MSG_CHAT_ROW);
    const res = await chatMessagesLoader(messagesArgs());
    expect(res.status).toBe(200);
  });
});
