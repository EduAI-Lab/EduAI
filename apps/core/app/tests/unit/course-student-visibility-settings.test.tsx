/**
 * #2002: the course Settings tab's "What students see" section. A save sends only
 * what this manager changed — never the whole topic list from a page that may be
 * stale — so it cannot undo another manager's change to anything else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CourseStudentVisibilitySettings } from "~/components/courses/course-student-visibility-settings";
import type { CourseTopic } from "~/hooks/api/use-course-topics";

const topic = (
  id: string,
  name: string,
  reviewStatus: CourseTopic["reviewStatus"],
  visibleToStudents: boolean,
): CourseTopic => ({
  id,
  courseId: "c1",
  name,
  reviewStatus,
  visibleToStudents,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const TOPICS = [
  topic("t1", "Shown", "ACCEPTED", true),
  topic("t2", "Hidden", "ACCEPTED", false),
  topic("t3", "Suggestion", "SUGGESTED", true),
  topic("t4", "Uncategorized", "ACCEPTED", true),
];

const onSaved = vi.fn();
const fetchMock = vi.fn();

function sentBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

function saveButton() {
  return screen.getByRole("button", { name: "Save what students see" });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(Response.json({ success: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CourseStudentVisibilitySettings (#2002)", () => {
  it("shows the stored settings and offers only approved, named topics", () => {
    render(
      <CourseStudentVisibilitySettings courseId="c1" studentFilesVisible={false} topics={TOPICS} />,
    );

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: "Shown" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Hidden" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Suggestion" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Uncategorized" })).toBeNull();
    // Nothing changed yet, so there is nothing to save.
    expect(saveButton()).toBeDisabled();
  });

  it("sends only the changed topic, then refetches the topics", async () => {
    render(
      <CourseStudentVisibilitySettings
        courseId="c1"
        studentFilesVisible={false}
        topics={TOPICS}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Shown" }));
    fireEvent.click(saveButton());

    await screen.findByText("Saved.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/courses/c1/student-visibility",
      expect.objectContaining({ method: "PATCH" }),
    );
    // The file switch was not touched, so another manager's file change survives.
    expect(sentBodies()).toEqual([{ topics: [{ id: "t1", visibleToStudents: false }] }]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("sends the file switch alone when only it changed", async () => {
    render(
      <CourseStudentVisibilitySettings courseId="c1" studentFilesVisible={false} topics={TOPICS} />,
    );

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(saveButton());

    await screen.findByText("Saved.");
    expect(sentBodies()).toEqual([{ studentFilesVisible: true }]);
  });

  it("does not resend an earlier save's changes with the next one", async () => {
    const { rerender } = render(
      <CourseStudentVisibilitySettings courseId="c1" studentFilesVisible={false} topics={TOPICS} />,
    );

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hidden" }));
    fireEvent.click(saveButton());
    await screen.findByText("Saved.");

    // The refetch brings back what was stored — t2 now shown — and that another
    // manager hid t1 in the meantime.
    rerender(
      <CourseStudentVisibilitySettings
        courseId="c1"
        studentFilesVisible={false}
        topics={[
          topic("t1", "Shown", "ACCEPTED", false),
          topic("t2", "Hidden", "ACCEPTED", true),
          ...TOPICS.slice(2),
        ]}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Shown" })).not.toBeChecked();
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Hidden" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Neither the file switch nor the other manager's t1 is sent again.
    expect(sentBodies()[1]).toEqual({ topics: [{ id: "t2", visibleToStudents: false }] });
  });

  it("has nothing to save once an edit is undone", () => {
    render(
      <CourseStudentVisibilitySettings courseId="c1" studentFilesVisible={false} topics={TOPICS} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Shown" }));
    expect(saveButton()).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Shown" }));
    expect(saveButton()).toBeDisabled();
  });

  it("keeps the edits and reports a refused save", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }));
    render(
      <CourseStudentVisibilitySettings
        courseId="c1"
        studentFilesVisible={false}
        topics={TOPICS}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(saveButton()).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
