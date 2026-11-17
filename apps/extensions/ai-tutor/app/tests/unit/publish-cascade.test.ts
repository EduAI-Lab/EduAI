import { describe, expect, it, vi } from "vitest";

const mockPublishLesson = vi.fn();
vi.mock("~/lib/api", () => ({
  default: { publishLesson: (...args: unknown[]) => mockPublishLesson(...args) },
  FULL_TREE_READ_PAGE_SIZE: 200,
}));

import { lessonPublishBlockedReason, publishLessons } from "~/lib/publish-cascade";

const lesson = { title: "L1", isPublished: false };
const published = { title: "P", isPublished: true };
const draft = { title: "D", isPublished: false };

describe("lessonPublishBlockedReason", () => {
  it("names the course first, then the module", () => {
    expect(lessonPublishBlockedReason(lesson, draft, draft)).toBe(
      "D is unpublished, so you can't publish L1.",
    );
    expect(lessonPublishBlockedReason(lesson, published, { ...draft, title: "M" })).toBe(
      "M is unpublished, so you can't publish L1.",
    );
  });

  it("is null when both parents are published or the lesson already is", () => {
    expect(lessonPublishBlockedReason(lesson, published, published)).toBeNull();
    expect(lessonPublishBlockedReason({ ...lesson, isPublished: true }, draft, draft)).toBeNull();
  });
});

describe("publishLessons", () => {
  it("keeps going past a failure and counts it", async () => {
    mockPublishLesson.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("x"));
    const rows = [
      { id: 1, title: "a", position: 0, isPublished: false },
      { id: 2, title: "b", position: 1, isPublished: false },
    ];
    await expect(publishLessons(rows)).resolves.toEqual({ published: 1, failed: 1 });
    expect(mockPublishLesson).toHaveBeenCalledTimes(2);
  });
});
