// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  chat: { findMany: vi.fn(), findFirst: vi.fn() },
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
}));

import { loader as courseChatsLoader } from "~/routes/api/courses.chats.$";
import { loader as unitChatsLoader } from "~/routes/api/units.chats.$";
import { loader as chatDetailLoader } from "~/routes/api/chats.$chatId";
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
});

// ---------------------------------------------------------------------------
// GET /api/courses/:courseId/chats
// ---------------------------------------------------------------------------

function courseArgs(courseId = "c1") {
  return {
    request: new Request(`http://localhost/api/courses/${courseId}/chats`),
    params: { courseId },
    context: {} as never,
  };
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
    // Only chats tagged with this course are returned.
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: "c1" } }),
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

function unitArgs(department = "COSC") {
  return {
    request: new Request(`http://localhost/api/units/${department}/chats`),
    params: { department },
    context: {} as never,
  };
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
    const res = await unitChatsLoader(unitArgs("COSC"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chats[0]).toMatchObject({ courseCode: "COSC 101" });
    // Aggregate is scoped to courses in this department only.
    expect(prismaMock.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { course: { department: "COSC", deletedAt: null } } }),
    );
  });

  it("ADMIN reads any unit aggregate without a flag (200)", async () => {
    session("ADMIN");
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await unitChatsLoader(unitArgs("COSC"));
    expect(res.status).toBe(200);
    expect(getPolicy).not.toHaveBeenCalled();
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
  };
}

const CHAT_ROW = {
  id: "chat-1",
  userId: "owner-1",
  courseId: "c1",
  systemPrompt: null,
  title: "Q",
  adhdAssist: false,
  createdAt: AT,
  updatedAt: AT,
  messages: [{ messageId: "m1", role: "user", content: "hi", position: 1 }],
};

describe("GET /api/chats/:chatId (course-authorized viewer)", () => {
  it("lets the owner read their chat", async () => {
    session("STUDENT", "owner-1");
    prismaMock.chat.findFirst.mockResolvedValue(CHAT_ROW);
    const res = await chatDetailLoader(detailArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("userId"); // owner/course ids stripped
    expect(body.messages).toHaveLength(1);
  });

  it("lets a course INSTRUCTOR read it when instructors.canViewCourseChats is on", async () => {
    session("INSTRUCTOR", "instr-1");
    prismaMock.chat.findFirst.mockResolvedValue(CHAT_ROW);
    access("instructor", 2);
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await chatDetailLoader(detailArgs());
    expect(res.status).toBe(200);
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
