import { describe, expect, it } from "vitest";
import { resolveCourseChangeAction } from "~/components/chat/chat-course-change";

describe("resolveCourseChangeAction", () => {
  it("starts a new course-scoped chat when a persisted chat changes course", () => {
    expect(
      resolveCourseChangeAction({
        currentCourseCode: "COSC 101",
        nextCourseCode: "PHYS 121",
        chatId: "chat-1",
      }),
    ).toEqual({
      kind: "new-chat",
      courseCode: "PHYS 121",
      to: "/chat?courseCode=PHYS%20121",
    });
  });

  it("updates the selection in place before a chat has been persisted", () => {
    expect(
      resolveCourseChangeAction({
        currentCourseCode: "COSC 101",
        nextCourseCode: "PHYS 121",
        chatId: null,
      }),
    ).toEqual({ kind: "update", courseCode: "PHYS 121" });
  });

  it("does nothing when the selected course did not change", () => {
    expect(
      resolveCourseChangeAction({
        currentCourseCode: "COSC 101",
        nextCourseCode: "COSC 101",
        chatId: "chat-1",
      }),
    ).toEqual({ kind: "noop" });
  });
});
