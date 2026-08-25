/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { CanvasImportDialog } from "./CanvasImportDialog";

const { toast } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast: toastFn };
});

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => ({ canManageCanvas: true }),
}));

vi.mock("../../services/canvasService", () => ({
  default: {
    getIntegration: vi.fn(),
    getCourses: vi.fn(),
    getCourseMapping: vi.fn(),
    connectCanvasWithFallback: vi.fn(),
    getQuizzes: vi.fn(),
    importQuiz: vi.fn(),
  },
}));

vi.mock("../../services/courseService", () => ({
  courseService: {
    getCourses: vi.fn(),
    getCourseTopics: vi.fn(),
  },
}));

import canvasService from "../../services/canvasService";
import { courseService } from "../../services/courseService";

describe("CanvasImportDialog", () => {
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
    vi.mocked(canvasService.getCourseMapping).mockResolvedValue({
      localCourseId: 9,
      canvasCourseId: 1,
      canvasCourseName: "CS 101",
    });
    vi.mocked(canvasService.getQuizzes).mockResolvedValue([
      { id: 20, title: "Midterm quiz", published: true },
    ]);
    vi.mocked(courseService.getCourseTopics).mockResolvedValue([
      { id: "topic_cuid_3", name: "Topic A", courseId: 9, createdAt: "", updatedAt: "" },
    ]);
  });

  it("loads quizzes from the Canvas course linked to the open course", async () => {
    render(<CanvasImportDialog open onClose={vi.fn()} courseId={9} />);

    await waitFor(() => {
      expect(canvasService.getQuizzes).toHaveBeenCalledWith(1);
    });
    expect(canvasService.getCourses).not.toHaveBeenCalled();
    expect(await screen.findByText("CS 101")).toBeInTheDocument();
  });

  it("loads topics for the open course without asking for a local course", async () => {
    render(<CanvasImportDialog open onClose={vi.fn()} courseId={9} />);

    await waitFor(() => {
      expect(courseService.getCourseTopics).toHaveBeenCalledWith(9);
    });
    expect(courseService.getCourses).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Local Course")).not.toBeInTheDocument();
  });

  it("blocks import when the open course has no linked Canvas course", async () => {
    vi.mocked(canvasService.getCourseMapping).mockResolvedValue(null);

    render(<CanvasImportDialog open onClose={vi.fn()} courseId={9} />);

    expect(
      await screen.findByText(
        /This course is not linked to a Canvas course\. Sync the course from Canvas/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("canvas-import-submit")).toBeDisabled();
    expect(canvasService.getQuizzes).not.toHaveBeenCalled();
  });

  it("points at EduAI settings instead of a connect form when Canvas is disconnected", async () => {
    vi.mocked(canvasService.getIntegration).mockResolvedValue(null);

    render(<CanvasImportDialog open onClose={vi.fn()} courseId={9} />);

    expect(await screen.findByText(/Canvas is not connected/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Canvas Instance URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Change Connection")).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas-import-submit")).toBeDisabled();
  });

  it("blocks import when opened without a course in context", async () => {
    render(<CanvasImportDialog open onClose={vi.fn()} courseId={null} />);

    expect(
      await screen.findByText(/Select a course before importing from Canvas/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("canvas-import-submit")).toBeDisabled();
    expect(canvasService.getCourseMapping).not.toHaveBeenCalled();
  });
});
