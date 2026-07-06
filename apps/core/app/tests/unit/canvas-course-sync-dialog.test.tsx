import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CanvasCourseSyncDialog } from "~/components/canvas/canvas-course-sync-dialog";
import { listCanvasCourses, syncCanvasCourses } from "~/lib/canvas/client";

vi.mock("~/lib/canvas/client", () => ({
  listCanvasCourses: vi.fn(),
  syncCanvasCourses: vi.fn(),
}));

const courses = [
  {
    canvasId: "101",
    name: "Intro to CS",
    courseCode: "COSC 111",
    isSynced: true,
    coreCourseId: "core-1",
    lastSyncedAt: "2026-06-08T00:00:00.000Z",
  },
  {
    canvasId: "102",
    name: "Data Structures",
    courseCode: "COSC 211",
    isSynced: false,
    coreCourseId: null,
    lastSyncedAt: null,
  },
];

describe("CanvasCourseSyncDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCanvasCourses).mockResolvedValue(courses);
    vi.mocked(syncCanvasCourses).mockResolvedValue({
      synced: [],
      unsynced: [],
      errors: [],
    });
  });

  it("loads courses when opened and pre-checks synced courses", async () => {
    render(<CanvasCourseSyncDialog open={true} onOpenChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Intro to CS")).toBeInTheDocument();
    });

    expect(listCanvasCourses).toHaveBeenCalled();
    expect(screen.getByLabelText("Intro to CS")).toBeChecked();
    expect(screen.getByLabelText("Data Structures")).not.toBeChecked();
  });

  it("calls syncCanvasCourses with the checked course ids", async () => {
    render(<CanvasCourseSyncDialog open={true} onOpenChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Data Structures")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Data Structures"));
    fireEvent.click(screen.getByRole("button", { name: "Save sync" }));

    await waitFor(() => {
      expect(syncCanvasCourses).toHaveBeenCalledWith({
        canvasCourseIds: ["101", "102"],
      });
    });
  });

  it("disables save when no courses are selected and none are synced yet", async () => {
    vi.mocked(listCanvasCourses).mockResolvedValue([
      {
        canvasId: "102",
        name: "Data Structures",
        courseCode: "COSC 211",
        isSynced: false,
        coreCourseId: null,
        lastSyncedAt: null,
      },
    ]);

    render(<CanvasCourseSyncDialog open={true} onOpenChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Data Structures")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Save sync" })).toBeDisabled();
    expect(
      screen.getByText("Check the courses you want to import, then click Save sync."),
    ).toBeInTheDocument();
  });
});
