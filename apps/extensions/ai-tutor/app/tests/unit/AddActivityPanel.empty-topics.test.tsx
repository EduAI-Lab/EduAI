import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@eduai/ui";
import type { CourseTopicsState } from "~/hooks/useCourseTopics";
import { CourseTopicsProvider } from "~/hooks/useCourseTopics";
import AddActivityPanel from "~/components/AddActivityPanel";

vi.mock("~/lib/api", () => ({
  default: {
    createActivity: vi.fn(),
  },
}));

function emptyTopicsState(overrides: Partial<CourseTopicsState> = {}): CourseTopicsState {
  return {
    topics: [],
    total: 0,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createTopic: vi.fn(),
    loadMore: vi.fn().mockResolvedValue(false),
    loadingMore: false,
    ...overrides,
  };
}

function renderPanel(topicsState: CourseTopicsState) {
  return render(
    <CourseTopicsProvider value={topicsState}>
      <Dialog open>
        <DialogContent>
          <AddActivityPanel lessonId={1} onActivityCreated={vi.fn()} />
        </DialogContent>
      </Dialog>
    </CourseTopicsProvider>,
  );
}

describe("AddActivityPanel empty-topics hint (#1021)", () => {
  it("points at EduAI Core when the course has no topics", () => {
    renderPanel(emptyTopicsState());

    expect(
      screen.getByText(/No topics on this course yet\. Add some on EduAI Core, then try again\./i),
    ).toBeTruthy();
  });

  it("hides the empty-topics hint while topics are loading", () => {
    renderPanel(emptyTopicsState({ loading: true }));

    expect(screen.queryByText(/No topics on this course yet/i)).toBeNull();
  });

  it("hides the empty-topics hint when topics exist", () => {
    renderPanel(
      emptyTopicsState({
        topics: [{ id: 1, name: "Recursion" }],
      }),
    );

    expect(screen.queryByText(/No topics on this course yet/i)).toBeNull();
    expect(screen.getByText("Recursion")).toBeTruthy();
  });
});
