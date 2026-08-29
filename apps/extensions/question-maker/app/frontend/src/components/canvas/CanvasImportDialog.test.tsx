/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// Radix Select measures and scrolls its listbox; jsdom implements neither.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

/** Opens the Radix select with the given trigger id and takes its first option. */
async function selectFirstOption(triggerId: string) {
  const trigger = document.getElementById(triggerId);
  if (!trigger) throw new Error(`No select trigger #${triggerId}`);
  // Radix opens on Enter; a pointer click needs capture APIs jsdom lacks.
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option"));
}

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

  // #1652 review: local topic ids are CUIDs. `parseInt("topic_cuid_3")` is NaN,
  // which Axios serializes as null, so the route rejected every import as
  // missing a primary topic.
  it("submits the selected topic id unchanged instead of coercing it to a number", async () => {
    vi.mocked(canvasService.importQuiz).mockResolvedValue({
      assessmentId: 7,
      assessmentName: "Midterm quiz",
      questionsImported: 3,
      questionsSkipped: 0,
      skippedQuestions: [],
      sectionId: 1,
    });

    render(<CanvasImportDialog open onClose={vi.fn()} courseId={9} />);

    await waitFor(() => expect(canvasService.getQuizzes).toHaveBeenCalledWith(1));
    // The topic select auto-picks the only topic; the quiz has to be chosen,
    // and choosing it fills the assessment name.
    await selectFirstOption("quiz");

    const submit = await screen.findByTestId("canvas-import-submit");
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(canvasService.importQuiz).toHaveBeenCalled());
    const [canvasCourseId, quizId, localCourseId, options] = vi.mocked(canvasService.importQuiz)
      .mock.calls[0];
    expect(canvasCourseId).toBe(1);
    expect(quizId).toBe(20);
    expect(localCourseId).toBe(9);
    expect(options.primaryTopicId).toBe("topic_cuid_3");
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
