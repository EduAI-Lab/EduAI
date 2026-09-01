import { describe, expect, it } from "vitest";
import { resolveCourseChangeAction } from "~/components/chat/chat-course-change";

describe("resolveCourseChangeAction", () => {
  it("starts a new course-scoped chat when a persisted chat changes course", () => {
    expect(
      resolveCourseChangeAction({
        currentCourseId: "course-1",
        nextCourseId: "course-2",
        chatId: "chat-1",
      }),
    ).toEqual({
      kind: "new-chat",
      courseId: "course-2",
      to: "/chat?courseId=course-2",
    });
  });

  it("updates the selection in place before a chat has been persisted", () => {
    expect(
      resolveCourseChangeAction({
        currentCourseId: "course-1",
        nextCourseId: "course-2",
        chatId: null,
      }),
    ).toEqual({ kind: "update", courseId: "course-2" });
  });

  it("does nothing when the selected course did not change", () => {
    expect(
      resolveCourseChangeAction({
        currentCourseId: "course-1",
        nextCourseId: "course-1",
        chatId: "chat-1",
      }),
    ).toEqual({ kind: "noop" });
  });
});
