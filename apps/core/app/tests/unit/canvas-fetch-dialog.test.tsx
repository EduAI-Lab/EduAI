import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { CanvasFetchDialog } from "~/components/canvas/canvas-fetch-dialog";
import { listCanvasCourses, syncCanvasCourses } from "~/lib/canvas/client";

vi.mock("~/lib/canvas/client", () => ({
  listCanvasCourses: vi.fn(),
  syncCanvasCourses: vi.fn(),
}));

const allCourses = [
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

function renderDialog(open = true) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <CanvasFetchDialog open={open} onOpenChange={vi.fn()} />,
      },
      { path: "/courses/:id", element: <div>Course page</div> },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("CanvasFetchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCanvasCourses).mockResolvedValue(allCourses);
    vi.mocked(syncCanvasCourses).mockResolvedValue({ synced: [], unsynced: [], errors: [] });
  });

  it("shows all Canvas courses — synced and unsynced", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Intro to CS")).toBeInTheDocument();
    });
    expect(screen.getByText("Data Structures")).toBeInTheDocument();
  });

  it("renders fetched courses as links to their EduAI course page", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Intro to CS/ })).toHaveAttribute(
        "href",
        "/courses/core-1",
      );
    });
  });

  it("renders unsynced courses with checkboxes, not as links", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Data Structures")).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: /Data Structures/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("calls syncCanvasCourses with already-synced ids plus newly checked ids", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByLabelText("Data Structures")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Data Structures"));
    fireEvent.click(screen.getByRole("button", { name: /fetch selected/i }));

    await waitFor(() => {
      // "101" (already synced) must be included so the backend delta doesn't unsync it
      expect(syncCanvasCourses).toHaveBeenCalledWith({ canvasCourseIds: ["101", "102"] });
    });
  });

  it("disables the Fetch selected button when no courses are checked", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Data Structures")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /fetch selected/i })).toBeDisabled();
  });

  it("surfaces per-course sync errors instead of failing silently", async () => {
    vi.mocked(syncCanvasCourses).mockResolvedValue({
      synced: [],
      unsynced: [],
      errors: [{ canvasId: "102", message: "Canvas course 102 not found or not taught by this account" }],
    });
    renderDialog();

    await waitFor(() => {
      expect(screen.getByLabelText("Data Structures")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Data Structures"));
    fireEvent.click(screen.getByRole("button", { name: /fetch selected/i }));

    await waitFor(() => {
      expect(screen.getByText(/Course 102: Canvas course 102 not found/)).toBeInTheDocument();
    });
  });

  it("shows empty state when no Canvas courses exist", async () => {
    vi.mocked(listCanvasCourses).mockResolvedValue([]);

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText(/no canvas courses found/i)).toBeInTheDocument();
    });
  });
});
