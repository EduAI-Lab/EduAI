import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      screen.getByText(/No topics on this course yet\. Add one above to continue\./i),
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

  it("keeps topic creation collapsed until the instructor opens it", async () => {
    const createTopic = vi.fn().mockResolvedValue({ id: 2, name: "Algebra" });
    renderPanel(emptyTopicsState({ createTopic }));

    expect(screen.queryByPlaceholderText("New topic name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add topic" }));
    fireEvent.change(screen.getByPlaceholderText("New topic name"), {
      target: { value: "Algebra" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createTopic).toHaveBeenCalledWith("Algebra"));
    await waitFor(() => expect(screen.queryByPlaceholderText("New topic name")).toBeNull());
  });
});
