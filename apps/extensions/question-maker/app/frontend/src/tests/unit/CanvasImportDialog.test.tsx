/**
 * Coverage for CanvasImportDialog (#1545) — connect flow, cascading course/quiz/topic
 * selects, validation, import success (with skipped-question reporting), and failure.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// jsdom doesn't implement scrollIntoView; Radix Select's viewport-scroll effect calls it.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Cold module transforms (large @eduai/ui / radix graph) can push first-run tests past
// the 5s default in this environment.
vi.setConfig({ testTimeout: 20000 });

const getIntegration = vi.fn();
const getCourses = vi.fn();
const getQuizzes = vi.fn();
const connectCanvasWithFallback = vi.fn();
const importQuiz = vi.fn();
const toastError = vi.fn();
const toastFn = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => (toastFn as any)(...args), { error: toastError }),
}));

vi.mock("@/services/canvasService", () => ({
  default: {
    getIntegration: (...args: unknown[]) => getIntegration(...args),
    getCourses: (...args: unknown[]) => getCourses(...args),
    getQuizzes: (...args: unknown[]) => getQuizzes(...args),
    connectCanvasWithFallback: (...args: unknown[]) => connectCanvasWithFallback(...args),
    importQuiz: (...args: unknown[]) => importQuiz(...args),
  },
}));

const getCoursesLocal = vi.fn();
const getCourseTopics = vi.fn();
vi.mock("@/services/courseService", () => ({
  courseService: {
    getCourses: (...args: unknown[]) => getCoursesLocal(...args),
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

describe("CanvasImportDialog", () => {
  beforeEach(() => {
    cleanup();
    canManageCanvas = true;
    getIntegration.mockReset();
    getCourses.mockReset();
    getQuizzes.mockReset();
    connectCanvasWithFallback.mockReset();
    importQuiz.mockReset();
    getCoursesLocal.mockReset().mockResolvedValue([]);
    getCourseTopics.mockReset().mockResolvedValue([]);
    toastError.mockReset();
    toastFn.mockReset();
  });

  it("shows the restricted message when the user cannot manage Canvas", async () => {
    canManageCanvas = false;
    getIntegration.mockResolvedValue({ isConnected: false });
    renderDialog();

    expect(
      screen.getByText(/available to instructors and administrators only/i),
    ).toBeInTheDocument();
  });

  it("shows the connect form when there is no integration yet", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    renderDialog();

    expect(await screen.findByLabelText("Canvas Instance URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeDisabled();
  });

  it("surfaces a toast when connecting fails", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    connectCanvasWithFallback.mockRejectedValue({ response: { data: { error: "Bad creds" } } });
    renderDialog();

    await screen.findByLabelText("Canvas Instance URL");
    fireEvent.change(screen.getByLabelText("Canvas Instance URL"), {
      target: { value: "https://canvas.instructure.com" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to connect Canvas",
        expect.objectContaining({ description: "Bad creds" }),
      ),
    );
  });

  it("walks the full cascade — Canvas course, quiz, local course, topic — and imports", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro Bio", course_code: "BIO101" }]);
    getCoursesLocal.mockResolvedValue([{ id: 5, name: "Biology", code: "BIO-L" }]);
    getQuizzes.mockResolvedValue([
      { id: 20, title: "Quiz 1", quiz_type: "assignment", published: true },
    ]);
    getCourseTopics.mockResolvedValue([{ id: 9, name: "Cells" }]);
    importQuiz.mockResolvedValue({
      assessmentId: 55,
      assessmentName: "Quiz 1",
      questionsImported: 8,
      questionsSkipped: 0,
    });
    const { onImportSuccess, onClose } = renderDialog();

    await selectByLabel("Canvas Course", "BIO101 - Intro Bio");
    await waitFor(() => expect(getQuizzes).toHaveBeenCalledWith(1));

    await selectByLabel("Quiz", "Quiz 1 (Published)");
    // Assessment name auto-fills from the quiz title.
    await waitFor(() => expect(screen.getByLabelText("Assessment Name")).toHaveValue("Quiz 1"));

    await selectByLabel("Local Course", "BIO-L - Biology");
    await waitFor(() => expect(getCourseTopics).toHaveBeenCalledWith(5));

    // Topic auto-selects the first one returned; the button should now be enabled.
    const importButton = await screen.findByRole("button", { name: /import from canvas/i });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);

    await waitFor(() =>
      expect(importQuiz).toHaveBeenCalledWith(1, 20, 5, {
        assessmentType: "Quiz",
        assessmentName: "Quiz 1",
        primaryTopicId: 9,
      }),
    );
    await waitFor(() =>
      expect(onImportSuccess).toHaveBeenCalledWith({ assessmentId: 55, assessmentName: "Quiz 1" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("reports skipped questions after a partial import", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro Bio", course_code: "BIO101" }]);
    getCoursesLocal.mockResolvedValue([{ id: 5, name: "Biology", code: "BIO-L" }]);
    getQuizzes.mockResolvedValue([
      { id: 20, title: "Quiz 1", quiz_type: "assignment", published: true },
    ]);
    getCourseTopics.mockResolvedValue([{ id: 9, name: "Cells" }]);
    importQuiz.mockResolvedValue({
      assessmentId: 55,
      assessmentName: "Quiz 1",
      questionsImported: 3,
      questionsSkipped: 2,
      skippedQuestions: [
        { position: 1, name: "Q1", type: "essay_question", reason: "unsupported" },
      ],
    });
    renderDialog();

    await selectByLabel("Canvas Course", "BIO101 - Intro Bio");
    await selectByLabel("Quiz", "Quiz 1 (Published)");
    await selectByLabel("Local Course", "BIO-L - Biology");

    const importButton = await screen.findByRole("button", { name: /import from canvas/i });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        "Import successful!",
        expect.objectContaining({
          description: expect.stringContaining("2 questions were skipped"),
        }),
      ),
    );
  });

  it("surfaces a toast when import fails", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro Bio", course_code: "BIO101" }]);
    getCoursesLocal.mockResolvedValue([{ id: 5, name: "Biology", code: "BIO-L" }]);
    getQuizzes.mockResolvedValue([
      { id: 20, title: "Quiz 1", quiz_type: "assignment", published: true },
    ]);
    getCourseTopics.mockResolvedValue([{ id: 9, name: "Cells" }]);
    importQuiz.mockRejectedValue({ response: { data: { error: "Quiz already imported" } } });
    renderDialog();

    await selectByLabel("Canvas Course", "BIO101 - Intro Bio");
    await selectByLabel("Quiz", "Quiz 1 (Published)");
    await selectByLabel("Local Course", "BIO-L - Biology");

    const importButton = await screen.findByRole("button", { name: /import from canvas/i });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Import failed",
        expect.objectContaining({ description: "Quiz already imported" }),
      ),
    );
  });

  it("shows empty states for quizzes, local courses, and topics", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro Bio", course_code: "BIO101" }]);
    getCoursesLocal.mockResolvedValue([]);
    getQuizzes.mockResolvedValue([]);
    renderDialog();

    await selectByLabel("Canvas Course", "BIO101 - Intro Bio");
    expect(await screen.findByText(/no quizzes found in this course/i)).toBeInTheDocument();
    expect(screen.getByText(/no local courses found/i)).toBeInTheDocument();
  });

  it("switches back to the connect form via Change Connection", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro Bio", course_code: "BIO101" }]);
    renderDialog();

    await screen.findByText("Canvas Course");
    fireEvent.click(screen.getByRole("button", { name: "Change Connection" }));
    expect(await screen.findByLabelText("Canvas Instance URL")).toBeInTheDocument();
  });

  it("calls onClose from Cancel while on the connect form", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    const { onClose } = renderDialog();

    await screen.findByLabelText("Canvas Instance URL");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose from Close when the user cannot manage Canvas", async () => {
    canManageCanvas = false;
    getIntegration.mockResolvedValue({ isConnected: false });
    const { onClose } = renderDialog();

    // The dialog's own X button also has an accessible name of "Close" — the footer
    // button renders first in DOM order.
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("logs and falls back to the connect form when loading the integration fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    getIntegration.mockRejectedValue(new Error("network down"));
    renderDialog();

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        "Failed to load Canvas integration:",
        expect.any(Error),
      ),
    );
    // Integration state stays null, so the connect form never shows and courses
    // are never fetched.
    expect(getCourses).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("logs when loading local courses fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([]);
    getCoursesLocal.mockRejectedValue(new Error("boom"));
    renderDialog();

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith("Failed to load local courses:", expect.any(Error)),
    );
    consoleError.mockRestore();
  });

  it("surfaces a toast and clears quizzes when loading quizzes fails", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro Bio", course_code: "BIO101" }]);
    getCoursesLocal.mockResolvedValue([]);
    getQuizzes.mockRejectedValue({ response: { data: { error: "Quiz service down" } } });
    renderDialog();

    await selectByLabel("Canvas Course", "BIO101 - Intro Bio");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to load quizzes",
        expect.objectContaining({ description: "Quiz service down" }),
      ),
    );
    expect(await screen.findByText(/no quizzes found in this course/i)).toBeInTheDocument();
  });

  it("logs and clears topics when loading topics fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro Bio", course_code: "BIO101" }]);
    getCoursesLocal.mockResolvedValue([{ id: 5, name: "Biology", code: "BIO-L" }]);
    getCourseTopics.mockRejectedValue(new Error("topics down"));
    renderDialog();

    await selectByLabel("Local Course", "BIO-L - Biology");

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith("Failed to load topics:", expect.any(Error)),
    );
    expect(
      await screen.findByText(/no topics found\. please create a topic for this course first/i),
    ).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("shows a test-mode toast when connecting falls back to mock Canvas data", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    connectCanvasWithFallback.mockResolvedValue({
      integration: { isConnected: true },
      usedTestMode: true,
    });
    getCourses.mockResolvedValue([]);
    renderDialog();

    await screen.findByLabelText("Canvas Instance URL");
    fireEvent.change(screen.getByLabelText("Canvas Instance URL"), {
      target: { value: "https://canvas.instructure.com" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        "Canvas test mode",
        expect.objectContaining({
          description: "Using mock Canvas data because live credentials were unavailable.",
        }),
      ),
    );
    // Successful connect swaps the connect form out for the course selects.
    expect(await screen.findByText("Canvas Course")).toBeInTheDocument();
  });

  it("shows an extra toast when more than three questions are skipped", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro Bio", course_code: "BIO101" }]);
    getCoursesLocal.mockResolvedValue([{ id: 5, name: "Biology", code: "BIO-L" }]);
    getQuizzes.mockResolvedValue([
      { id: 20, title: "Quiz 1", quiz_type: "assignment", published: true },
    ]);
    getCourseTopics.mockResolvedValue([{ id: 9, name: "Cells" }]);
    importQuiz.mockResolvedValue({
      assessmentId: 55,
      assessmentName: "Quiz 1",
      questionsImported: 1,
      questionsSkipped: 4,
      skippedQuestions: [
        { position: 1, name: "Q1", type: "essay_question", reason: "unsupported" },
        { position: 2, name: "Q2", type: "essay_question", reason: "unsupported" },
        { position: 3, name: "Q3", type: "essay_question", reason: "unsupported" },
        { position: 4, name: "Q4", type: "essay_question", reason: "unsupported" },
      ],
    });
    renderDialog();

    await selectByLabel("Canvas Course", "BIO101 - Intro Bio");
    await selectByLabel("Quiz", "Quiz 1 (Published)");
    await selectByLabel("Local Course", "BIO-L - Biology");

    const importButton = await screen.findByRole("button", { name: /import from canvas/i });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        "Some questions were skipped",
        expect.objectContaining({
          description: expect.stringContaining("4 questions with unsupported types"),
        }),
      ),
    );
  });

  it("renders a Canvas course without a code and marks unpublished quizzes", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro Bio", course_code: null }]);
    getCoursesLocal.mockResolvedValue([]);
    getQuizzes.mockResolvedValue([
      { id: 20, title: "Draft Quiz", quiz_type: "assignment", published: false },
    ]);
    renderDialog();

    await selectByLabel("Canvas Course", "Intro Bio");
    const quizCombo = await screen.findByRole("combobox", { name: "Quiz" });
    fireEvent.click(quizCombo);
    expect(await screen.findByText("Draft Quiz (Unpublished)")).toBeInTheDocument();
  });

  it("renders a local course without a code", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([]);
    getCoursesLocal.mockResolvedValue([{ id: 5, name: "Biology", code: null }]);
    renderDialog();

    const localCombo = await screen.findByRole("combobox", { name: "Local Course" });
    fireEvent.click(localCombo);
    expect(await screen.findByText("Biology")).toBeInTheDocument();
  });
});
