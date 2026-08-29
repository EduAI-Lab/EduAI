/**
 * Coverage for CanvasImportDialog (#1545) — the permission gate, the
 * disconnected / no-course / unlinked branches, the quiz and topic selects,
 * validation, import success (with skipped-question reporting), and failure.
 *
 * #1652 scoped the dialog to the course in context: neither the Canvas course
 * nor the local course is picked here any more, so there is no connect form
 * and no course cascade — quizzes come from the Canvas course this course is
 * linked to, and the assessment lands in this course.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// jsdom doesn't implement scrollIntoView; Radix Select's viewport-scroll effect calls it.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Cold module transforms (large @eduai/ui / radix graph) can push first-run tests past
// the 5s default in this environment.
vi.setConfig({ testTimeout: 20000 });

const getIntegration = vi.fn();
const getCourseMapping = vi.fn();
const getQuizzes = vi.fn();
const importQuiz = vi.fn();
const toastError = vi.fn();
const toastFn = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => (toastFn as any)(...args), { error: toastError }),
}));

vi.mock("@/services/canvasService", () => ({
  default: {
    getIntegration: (...args: unknown[]) => getIntegration(...args),
    getCourseMapping: (...args: unknown[]) => getCourseMapping(...args),
    getQuizzes: (...args: unknown[]) => getQuizzes(...args),
    importQuiz: (...args: unknown[]) => importQuiz(...args),
  },
}));

const getCourseTopics = vi.fn();
vi.mock("@/services/courseService", () => ({
  courseService: {
    getCourseTopics: (...args: unknown[]) => getCourseTopics(...args),
  },
}));

let canManageCanvas = true;
vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => ({ canManageCanvas }),
}));

const { CanvasImportDialog } = await import("@/components/canvas/CanvasImportDialog");

function renderDialog(overrides: Partial<React.ComponentProps<typeof CanvasImportDialog>> = {}) {
  const onClose = vi.fn();
  const onImportSuccess = vi.fn();
  render(
    <CanvasImportDialog
      open
      onClose={onClose}
      courseId={7}
      onImportSuccess={onImportSuccess}
      {...overrides}
    />,
  );
  return { onClose, onImportSuccess };
}

async function selectByLabel(labelText: string, optionText: string) {
  // Radix's SelectTrigger is a <button role="combobox">, which RTL's getByLabelText
  // doesn't treat as a labelable control even though the <label for> association is
  // valid — query by combobox role + accessible name instead.
  const combo = await screen.findByRole("combobox", { name: labelText });
  fireEvent.click(combo);
  const option = await screen.findByText(optionText);
  fireEvent.click(option);
}

/** Connected, linked to Canvas course 11, with one quiz and one topic. */
function mockLinkedCourse(quizzes: any[] = [{ id: 55, title: "Week 1 Quiz", published: true }]) {
  getIntegration.mockResolvedValue({ isConnected: true });
  getCourseMapping.mockResolvedValue({ canvasCourseId: 11, canvasCourseName: "Canvas Intro CS" });
  getQuizzes.mockResolvedValue(quizzes);
  getCourseTopics.mockResolvedValue([{ id: "topic-cuid-1", name: "Mechanics" }]);
}

/**
 * Fills in the quiz and name the submit button gates on. The primary topic
 * defaults to the course's first topic, so it needs no selection here.
 */
async function completeForm(quizLabel = "Week 1 Quiz (Published)") {
  await selectByLabel("Quiz", quizLabel);
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Primary Topic (Required)" })).toHaveTextContent(
      "Mechanics",
    ),
  );
  const nameInput = await screen.findByLabelText("Assessment Name");
  fireEvent.change(nameInput, { target: { value: "Imported Quiz" } });
  return nameInput;
}

describe("CanvasImportDialog", () => {
  beforeEach(() => {
    cleanup();
    canManageCanvas = true;
    getIntegration.mockReset();
    getCourseMapping.mockReset();
    getQuizzes.mockReset();
    importQuiz.mockReset();
    getCourseTopics.mockReset().mockResolvedValue([]);
    toastError.mockReset();
    toastFn.mockReset();
  });

  it("shows the restricted message when the user cannot manage Canvas", async () => {
    canManageCanvas = false;
    getIntegration.mockResolvedValue({ isConnected: false });
    renderDialog();

    expect(
      await screen.findByText(/available to instructors and administrators only/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-import-submit")).not.toBeInTheDocument();
  });

  it("points at EduAI settings instead of a connect form when Canvas is disconnected", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    renderDialog();

    expect(await screen.findByText(/Connect Canvas in your EduAI settings/i)).toBeInTheDocument();
    expect(getCourseMapping).not.toHaveBeenCalled();
    expect(screen.getByTestId("canvas-import-submit")).toBeDisabled();
  });

  it("blocks import when opened without a course in context", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    renderDialog({ courseId: null });

    expect(await screen.findByText(/Select a course before importing/i)).toBeInTheDocument();
    expect(getCourseMapping).not.toHaveBeenCalled();
    expect(getCourseTopics).not.toHaveBeenCalled();
  });

  it("blocks import when the open course has no linked Canvas course", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourseMapping.mockResolvedValue(null);
    renderDialog();

    expect(await screen.findByText(/not linked to a Canvas course/i)).toBeInTheDocument();
    expect(getQuizzes).not.toHaveBeenCalled();
    expect(screen.getByTestId("canvas-import-submit")).toBeDisabled();
  });

  it("loads quizzes from the linked Canvas course and topics from the open course", async () => {
    mockLinkedCourse();
    renderDialog();

    await waitFor(() => expect(getQuizzes).toHaveBeenCalledWith(11));
    expect(getCourseTopics).toHaveBeenCalledWith(7);
    expect(await screen.findByTestId("linked-canvas-course")).toHaveTextContent("Canvas Intro CS");
  });

  it("names an unnamed linked Canvas course by its id", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourseMapping.mockResolvedValue({ canvasCourseId: 11, canvasCourseName: null });
    getQuizzes.mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByTestId("linked-canvas-course")).toHaveTextContent("Canvas course 11");
  });

  it("prefills the assessment name from the selected quiz", async () => {
    mockLinkedCourse();
    renderDialog();

    await selectByLabel("Quiz", "Week 1 Quiz (Published)");
    await waitFor(() =>
      expect(screen.getByLabelText("Assessment Name")).toHaveValue("Week 1 Quiz"),
    );
  });

  it("imports the selected quiz, keeping the topic id a CUID", async () => {
    mockLinkedCourse();
    importQuiz.mockResolvedValue({
      assessmentId: 3,
      assessmentName: "Imported Quiz",
      questionsImported: 4,
    });
    const { onClose, onImportSuccess } = renderDialog();

    await waitFor(() => expect(getQuizzes).toHaveBeenCalled());
    await completeForm();
    await selectByLabel("Assessment Type", "Midterm");

    const submit = screen.getByTestId("canvas-import-submit");
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() =>
      // parseInt would turn the CUID into NaN and fail the route's topic check.
      expect(importQuiz).toHaveBeenCalledWith(11, 55, 7, {
        assessmentType: "Midterm",
        assessmentName: "Imported Quiz",
        primaryTopicId: "topic-cuid-1",
      }),
    );
    await waitFor(() =>
      expect(onImportSuccess).toHaveBeenCalledWith({
        assessmentId: 3,
        assessmentName: "Imported Quiz",
      }),
    );
    expect(toastFn).toHaveBeenCalledWith(
      "Import successful!",
      expect.objectContaining({ description: "Imported 4 questions from Canvas." }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("reports skipped questions after a partial import", async () => {
    mockLinkedCourse();
    importQuiz.mockResolvedValue({
      assessmentId: 3,
      assessmentName: "Imported Quiz",
      questionsImported: 1,
      questionsSkipped: 1,
      skippedQuestions: [{ position: 2, name: "Essay", type: "essay_question", reason: "type" }],
    });
    renderDialog();

    await waitFor(() => expect(getQuizzes).toHaveBeenCalled());
    await completeForm();
    fireEvent.click(screen.getByTestId("canvas-import-submit"));

    // A single import and a single skip are both reported in the singular.
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        "Import successful!",
        expect.objectContaining({
          description:
            "Imported 1 question from Canvas. 1 question was skipped due to unsupported question types.",
        }),
      ),
    );
    // Only a handful skipped, so no second toast — the console warning carries it.
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it("shows an extra toast when more than three questions are skipped", async () => {
    mockLinkedCourse();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    importQuiz.mockResolvedValue({
      assessmentId: 3,
      assessmentName: "Imported Quiz",
      questionsImported: 2,
      questionsSkipped: 4,
      skippedQuestions: [1, 2, 3, 4].map((position) => ({
        position,
        name: `Q${position}`,
        type: "essay_question",
        reason: "type",
      })),
    });
    renderDialog();

    await waitFor(() => expect(getQuizzes).toHaveBeenCalled());
    await completeForm();
    fireEvent.click(screen.getByTestId("canvas-import-submit"));

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        "Some questions were skipped",
        expect.objectContaining({
          description: expect.stringContaining("4 questions with unsupported types"),
        }),
      ),
    );
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("surfaces a toast when the import fails", async () => {
    mockLinkedCourse();
    importQuiz.mockRejectedValue({ response: { data: { error: "Canvas rejected the quiz" } } });
    renderDialog();

    await waitFor(() => expect(getQuizzes).toHaveBeenCalled());
    await completeForm();
    fireEvent.click(screen.getByTestId("canvas-import-submit"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Import failed",
        expect.objectContaining({ description: "Canvas rejected the quiz" }),
      ),
    );
  });

  it("falls back to a generic description when the import error carries no message", async () => {
    mockLinkedCourse();
    importQuiz.mockRejectedValue(new Error("socket hang up"));
    renderDialog();

    await waitFor(() => expect(getQuizzes).toHaveBeenCalled());
    await completeForm();
    fireEvent.click(screen.getByTestId("canvas-import-submit"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Import failed",
        expect.objectContaining({ description: "Failed to import quiz from Canvas." }),
      ),
    );
  });

  it("shows empty states for quizzes and topics", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourseMapping.mockResolvedValue({ canvasCourseId: 11, canvasCourseName: "Canvas Intro CS" });
    getQuizzes.mockResolvedValue([]);
    getCourseTopics.mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByText(/No quizzes found in this course/i)).toBeInTheDocument();
    expect(screen.getByText(/No topics found/i)).toBeInTheDocument();
    expect(screen.getByTestId("canvas-import-submit")).toBeDisabled();
  });

  it("marks unpublished quizzes in the picker", async () => {
    mockLinkedCourse([{ id: 55, title: "Draft Quiz", published: false }]);
    renderDialog();

    const combo = await screen.findByRole("combobox", { name: "Quiz" });
    fireEvent.click(combo);
    expect(await screen.findByText("Draft Quiz (Unpublished)")).toBeInTheDocument();
  });

  it("surfaces a toast and clears quizzes when loading quizzes fails", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourseMapping.mockResolvedValue({ canvasCourseId: 11, canvasCourseName: "Canvas Intro CS" });
    getQuizzes.mockRejectedValue({ response: { data: { error: "Canvas is down" } } });
    getCourseTopics.mockResolvedValue([{ id: "topic-cuid-1", name: "Mechanics" }]);
    renderDialog();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to load quizzes",
        expect.objectContaining({ description: "Canvas is down" }),
      ),
    );
    expect(await screen.findByText(/No quizzes found in this course/i)).toBeInTheDocument();
  });

  it("logs and clears topics when loading topics fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourseMapping.mockResolvedValue({ canvasCourseId: 11, canvasCourseName: "Canvas Intro CS" });
    getQuizzes.mockResolvedValue([]);
    getCourseTopics.mockRejectedValue(new Error("topics down"));
    renderDialog();

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("Failed to load topics:", expect.any(Error)),
    );
    expect(await screen.findByText(/No topics found/i)).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("logs when loading the integration fails and stays disconnected", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getIntegration.mockRejectedValue(new Error("integration down"));
    renderDialog();

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to load Canvas integration:",
        expect.any(Error),
      ),
    );
    expect(await screen.findByText(/Connect Canvas in your EduAI settings/i)).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("calls onClose from the Cancel footer button", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    const { onClose } = renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
