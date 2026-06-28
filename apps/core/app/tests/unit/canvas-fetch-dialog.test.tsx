import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { CanvasFetchDialog } from "~/components/canvas/canvas-fetch-dialog";
import { listCanvasCourses } from "~/lib/canvas/client";

vi.mock("~/lib/canvas/client", () => ({
  listCanvasCourses: vi.fn(),
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
      const link = screen.getByRole("link", { name: /Intro to CS/ });
      expect(link).toHaveAttribute("href", "/courses/core-1");
    });
  });

  it("renders unsynced courses as non-clickable disabled rows", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Data Structures")).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: /Data Structures/ })).not.toBeInTheDocument();
    expect(screen.getByText("Not yet fetched into EduAI")).toBeInTheDocument();
  });

  it("shows empty state when no Canvas courses exist", async () => {
    vi.mocked(listCanvasCourses).mockResolvedValue([]);

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText(/no canvas courses found/i)).toBeInTheDocument();
    });
  });

  it("does not render checkboxes", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Intro to CS")).toBeInTheDocument();
    });

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
