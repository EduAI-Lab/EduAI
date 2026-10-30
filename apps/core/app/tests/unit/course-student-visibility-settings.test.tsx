/**
 * #2002: the course Settings tab's "What students see" section — one switch for
 * every topic, and File and topic settings for files and single topics. A save sends only
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
  return screen.getByRole("button", { name: "Save" });
}

function openDetails() {
  fireEvent.click(screen.getByRole("button", { name: "File and topic settings" }));
}

const filesSwitch = () => screen.getByRole("switch", { name: "Let students see course files" });
const topicsSwitch = () => screen.getByRole("switch", { name: "Show topics to students" });

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
    openDetails();

    expect(filesSwitch()).toHaveAttribute("aria-checked", "false");
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
    openDetails();

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
    openDetails();

    fireEvent.click(filesSwitch());
    fireEvent.click(saveButton());

    await screen.findByText("Saved.");
    expect(sentBodies()).toEqual([{ studentFilesVisible: true }]);
  });

  it("does not resend an earlier save's changes with the next one", async () => {
    const { rerender } = render(
      <CourseStudentVisibilitySettings courseId="c1" studentFilesVisible={false} topics={TOPICS} />,
    );
    openDetails();

    fireEvent.click(filesSwitch());
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
    openDetails();
    expect(screen.getByRole("checkbox", { name: "Shown" })).not.toBeChecked();
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Hidden" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Neither the file switch nor the other manager's t1 is sent again.
    expect(sentBodies()[1]).toEqual({
      topics: [{ id: "t2", visibleToStudents: false }],
    });
  });

  it("keeps a saved edit on screen when the refetch leaves the topics stale", async () => {
    render(
      <CourseStudentVisibilitySettings
        courseId="c1"
        studentFilesVisible={false}
        topics={TOPICS}
        onSaved={onSaved}
      />,
    );
    openDetails();

    fireEvent.click(screen.getByRole("checkbox", { name: "Shown" }));
    fireEvent.click(saveButton());

    await screen.findByText("Saved.");
    // onSaved resolved but the topics prop never changed (the GET failed).
    expect(topicsSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/topic names are hidden/i)).toBeInTheDocument();
    openDetails();
    expect(screen.getByRole("checkbox", { name: "Shown" })).not.toBeChecked();
  });

  it("shows every topic in one click, then hides them all", async () => {
    render(
      <CourseStudentVisibilitySettings
        courseId="c1"
        studentFilesVisible={false}
        topics={TOPICS}
        onSaved={onSaved}
      />,
    );

    // One of the two approved topics is shown, so the switch is off.
    expect(topicsSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("1 of 2 topics are shown. Choose which in File and topic settings."),
    ).toBeVisible();

    fireEvent.click(topicsSwitch());
    await screen.findByText("Saved.");
    // Only the hidden approved topic: not the suggestion, Uncategorized, or files.
    expect(sentBodies()).toEqual([{ topics: [{ id: "t2", visibleToStudents: true }] }]);
    expect(topicsSwitch()).toHaveAttribute("aria-checked", "true");
    expect(onSaved).toHaveBeenCalledTimes(1);

    fireEvent.click(topicsSwitch());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBodies()[1]).toEqual({
      topics: [
        { id: "t1", visibleToStudents: false },
        { id: "t2", visibleToStudents: false },
      ],
    });
  });

  it("drops unsaved choices when File and topic settings is closed", () => {
    render(
      <CourseStudentVisibilitySettings courseId="c1" studentFilesVisible={false} topics={TOPICS} />,
    );
    openDetails();

    fireEvent.click(filesSwitch());
    fireEvent.click(screen.getByRole("checkbox", { name: "Shown" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(fetchMock).not.toHaveBeenCalled();
    openDetails();
    expect(filesSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: "Shown" })).toBeChecked();
    expect(saveButton()).toBeDisabled();
  });

  it("disables the switch until a topic is approved", () => {
    render(
      <CourseStudentVisibilitySettings
        courseId="c1"
        studentFilesVisible={false}
        topics={TOPICS.slice(2)}
      />,
    );

    expect(topicsSwitch()).toBeDisabled();
    expect(screen.getByText(/no approved topics yet/i)).toBeInTheDocument();
  });

  it("has nothing to save once an edit is undone", () => {
    render(
      <CourseStudentVisibilitySettings courseId="c1" studentFilesVisible={false} topics={TOPICS} />,
    );
    openDetails();

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
    openDetails();

    fireEvent.click(filesSwitch());
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
    expect(filesSwitch()).toHaveAttribute("aria-checked", "true");
    expect(saveButton()).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
