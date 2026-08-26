// @vitest-environment node
//
// #1659: createInstructorChatTools is a small, read-only, course-pinned slice
// of the admin tool surface. These tests cover the manifest (exactly the 4
// intended tools — no platform-wide reads/writes leaked in) and that every
// tool is hard-pinned to ctx.effectiveCourseId rather than to any argument a
// model might supply.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  getAccessibleCourse: vi.fn(),
  listAdminCourseEnrollments: vi.fn(),
  listAdminCourseTopics: vi.fn(),
  getAdminCourseTopic: vi.fn(),
}));

import { createInstructorChatTools } from "~/lib/agent-tools/create-instructor-chat-tools";
import type { ChatToolContext } from "~/lib/agent-tools/chat-mode";
import {
  getAccessibleCourse,
  listAdminCourseEnrollments,
  listAdminCourseTopics,
  getAdminCourseTopic,
} from "~/lib/agent-tools/admin-context.server";

const rbacUser = { id: "instructor-1", role: "INSTRUCTOR" };

function makeCtx(overrides: Partial<ChatToolContext> = {}): ChatToolContext {
  return {
    user: rbacUser,
    effectiveCourseId: "course-1",
    effectiveCourseCode: "COSC 101",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createInstructorChatTools manifest coverage (#1659)", () => {
  it("exposes exactly the intended course-scoped read tools — no platform-wide reads/writes", () => {
    const tools = createInstructorChatTools(makeCtx());
    expect(Object.keys(tools).sort()).toEqual(
      ["getCourse", "getCourseTopic", "listCourseEnrollments", "listCourseTopics"].sort(),
    );
  });
});

describe("createInstructorChatTools read execute — pinned to ctx.effectiveCourseId", () => {
  it("getCourse reads the ctx course, ignoring any tool-call arguments", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({ course: { id: "course-1" } } as never);
    const tools = createInstructorChatTools(makeCtx());

    const result = await tools.getCourse.execute({}, { messages: [], toolCallId: "t1" });

    expect(getAccessibleCourse).toHaveBeenCalledWith(rbacUser, "course-1");
    expect(result).toEqual({ course: { id: "course-1" } });
  });

  it("listCourseEnrollments passes filters through but always targets ctx.effectiveCourseId", async () => {
    vi.mocked(listAdminCourseEnrollments).mockResolvedValue({ enrollments: [] } as never);
    const tools = createInstructorChatTools(makeCtx());

    await tools.listCourseEnrollments.execute(
      { limit: 10, isActive: true },
      { messages: [], toolCallId: "t2" },
    );

    expect(listAdminCourseEnrollments).toHaveBeenCalledWith(rbacUser, "course-1", {
      limit: 10,
      isActive: true,
    });
  });

  it("listCourseTopics reads the ctx course", async () => {
    vi.mocked(listAdminCourseTopics).mockResolvedValue({ topics: [] } as never);
    const tools = createInstructorChatTools(makeCtx());

    await tools.listCourseTopics.execute({}, { messages: [], toolCallId: "t3" });

    expect(listAdminCourseTopics).toHaveBeenCalledWith(rbacUser, "course-1");
  });

  it("getCourseTopic reads the ctx course plus the requested topicId", async () => {
    vi.mocked(getAdminCourseTopic).mockResolvedValue({ topic: { id: "topic-1" } } as never);
    const tools = createInstructorChatTools(makeCtx());

    await tools.getCourseTopic.execute({ topicId: "topic-1" }, { messages: [], toolCallId: "t4" });

    expect(getAdminCourseTopic).toHaveBeenCalledWith(rbacUser, "course-1", "topic-1");
  });
});

describe("createInstructorChatTools with no course selected", () => {
  it("every tool returns a no-course error without calling the underlying admin-context helpers", async () => {
    const tools = createInstructorChatTools(makeCtx({ effectiveCourseId: null }));

    const results = await Promise.all([
      tools.getCourse.execute({}, { messages: [], toolCallId: "t5" }),
      tools.listCourseEnrollments.execute({}, { messages: [], toolCallId: "t6" }),
      tools.listCourseTopics.execute({}, { messages: [], toolCallId: "t7" }),
      tools.getCourseTopic.execute({ topicId: "x" }, { messages: [], toolCallId: "t8" }),
    ]);

    for (const result of results) {
      expect(result).toEqual({ error: "No course selected for this instructor chat" });
    }
    expect(getAccessibleCourse).not.toHaveBeenCalled();
    expect(listAdminCourseEnrollments).not.toHaveBeenCalled();
    expect(listAdminCourseTopics).not.toHaveBeenCalled();
    expect(getAdminCourseTopic).not.toHaveBeenCalled();
  });
});
