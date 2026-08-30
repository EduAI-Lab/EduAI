/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CanvasExportDialog } from "./CanvasExportDialog";

const { toast } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast: toastFn };
});

vi.mock("sonner", () => ({ toast }));

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => ({ canManageCanvas: true }),
}));

vi.mock("../../services/canvasService", () => ({
  default: {
    getIntegration: vi.fn(),
    getCourses: vi.fn(),
    exportAssessment: vi.fn(),
    connectCanvasWithFallback: vi.fn(),
  },
}));

import canvasService from "../../services/canvasService";

describe("CanvasExportDialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.mocked(canvasService.getIntegration).mockResolvedValue({
      canvasUrl: "https://canvas.test",
      isTestMode: true,
      isConnected: true,
    });
    vi.mocked(canvasService.getCourses).mockResolvedValue([
      { id: 1, name: "CS 101", course_code: "CS101" },
    ]);
    vi.mocked(canvasService.exportAssessment).mockResolvedValue({
      quizId: 7,
      canvasUrl: "https://canvas.test/courses/1/quizzes/7",
      questionsCreated: 3,
    });
  });

  const renderDialog = () =>
    render(
      <CanvasExportDialog
        open
        onClose={vi.fn()}
        assessmentId={5}
        assessmentName="Midterm 1"
        courseId={9}
      />,
    );

  it("offers a publish choice that is off by default", async () => {
    renderDialog();

    const publish = await screen.findByTestId("export-publish-toggle");
    expect(publish).not.toBeChecked();
  });

  // #1652 review: `AssessmentBuilderPage` keeps this dialog mounted between
  // exports, so a `useState(true)` initializer only ran on first mount — one
  // opt-in silently governed every later export.
  it("re-defaults the publish choice on each open", async () => {
    const view = render(
      <CanvasExportDialog
        open
        onClose={vi.fn()}
        assessmentId={5}
        assessmentName="Midterm 1"
        courseId={9}
      />,
    );

    const publish = await screen.findByTestId("export-publish-toggle");
    fireEvent.click(publish);
    expect(publish).toBeChecked();

    const rerenderWith = (open: boolean) =>
      view.rerender(
        <CanvasExportDialog
          open={open}
          onClose={vi.fn()}
          assessmentId={5}
          assessmentName="Midterm 1"
          courseId={9}
        />,
      );
    rerenderWith(false);
    rerenderWith(true);

    await waitFor(() => expect(screen.getByTestId("export-publish-toggle")).not.toBeChecked());
  });

  it("turns the publish choice on when clicked", async () => {
    renderDialog();

    const publish = await screen.findByTestId("export-publish-toggle");
    fireEvent.click(publish);

    expect(publish).toBeChecked();
  });
});
