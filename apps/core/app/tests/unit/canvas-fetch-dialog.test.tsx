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

function renderDialog(open = true, onOpenChange = vi.fn()) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <CanvasFetchDialog open={open} onOpenChange={onOpenChange} />,
      },
      { path: "/courses/:id", element: <div>Course page</div> },
    ],
    { initialEntries: ["/"] },
  );
  return { ...render(<RouterProvider router={router} />), onOpenChange };
}

/** Checks "Data Structures" and starts a fetch that never settles. */
async function startPendingFetch(onOpenChange = vi.fn()) {
  vi.mocked(syncCanvasCourses).mockReturnValue(new Promise(() => {}));
  const rendered = renderDialog(true, onOpenChange);

  await waitFor(() => {
    expect(screen.getByLabelText("Data Structures")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByLabelText("Data Structures"));
  fireEvent.click(screen.getByRole("button", { name: /fetch selected/i }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /fetching/i })).toBeInTheDocument();
  });

  return rendered;
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
      errors: [
        { canvasId: "102", message: "Canvas course 102 not found or not taught by this account" },
      ],
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

  describe("while a fetch is in flight", () => {
    it("does not close when the user presses Escape", async () => {
      const onOpenChange = vi.fn();
      await startPendingFetch(onOpenChange);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /fetching/i })).toBeInTheDocument();
    });

    it("does not close when the user clicks outside the dialog", async () => {
      const onOpenChange = vi.fn();
      await startPendingFetch(onOpenChange);

      // Radix only treats an outside pointerdown as a dismissal once the
      // matching click lands, so both events are needed to exercise the path.
      fireEvent.pointerDown(document.body);
      fireEvent.click(document.body);

      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /fetching/i })).toBeInTheDocument();
    });

    // The synced-course link is a dismissal path too: following it unmounts
    // the dialog, so a mid-fetch click navigated away and lost the result the
    // rest of this guard exists to report (#1681 review).
    it("does not follow an already-fetched course link", async () => {
      const onOpenChange = vi.fn();
      await startPendingFetch(onOpenChange);

      const link = screen.getByRole("link", { name: /Intro to CS/ });
      expect(link).toHaveAttribute("aria-disabled", "true");

      fireEvent.click(link);

      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.queryByText("Course page")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /fetching/i })).toBeInTheDocument();
    });

    it("takes the course link out of the tab order while it is inert", async () => {
      await startPendingFetch();

      expect(screen.getByRole("link", { name: /Intro to CS/ })).toHaveAttribute("tabindex", "-1");
    });

    it("hides the corner close button so every dismiss path is consistent", async () => {
      const { baseElement } = await startPendingFetch();

      // The footer also renders a "Close" button, so target the corner X by slot.
      expect(baseElement.querySelector('[data-slot="dialog-close"]')).toBeNull();
    });
  });

  it("still follows an already-fetched course link when no fetch is running", async () => {
    const { onOpenChange } = renderDialog();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Intro to CS/ })).toBeInTheDocument();
    });
    const link = screen.getByRole("link", { name: /Intro to CS/ });
    expect(link).not.toHaveAttribute("aria-disabled");

    fireEvent.click(link);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("still closes on Escape when no fetch is running", async () => {
    const { onOpenChange } = renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Data Structures")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
