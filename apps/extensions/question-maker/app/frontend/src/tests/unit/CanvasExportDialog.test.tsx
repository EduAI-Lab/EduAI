/**
 * Coverage for CanvasExportDialog (#1545) — connect flow, course selection,
 * export success/failure, and the permission-gated read-only view.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Cold module transforms (large @eduai/ui / radix graph) can push first-run tests past
// the 5s default in this environment.
vi.setConfig({ testTimeout: 20000 });

const getIntegration = vi.fn();
const getCourses = vi.fn();
const connectCanvasWithFallback = vi.fn();
const exportAssessment = vi.fn();
const toastError = vi.fn();
const toastFn = vi.fn() as unknown as typeof toastFn & { error: typeof toastError };
(toastFn as any).error = toastError;

vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => (toastFn as any)(...args), { error: toastError }),
}));

vi.mock("@/services/canvasService", () => ({
  default: {
    getIntegration: (...args: unknown[]) => getIntegration(...args),
    getCourses: (...args: unknown[]) => getCourses(...args),
    connectCanvasWithFallback: (...args: unknown[]) => connectCanvasWithFallback(...args),
    exportAssessment: (...args: unknown[]) => exportAssessment(...args),
  },
}));

let canManageCanvas = true;
vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => ({ canManageCanvas }),
}));

// jsdom doesn't implement scrollIntoView; Radix Select's viewport-scroll effect calls it.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const { CanvasExportDialog } = await import("@/components/canvas/CanvasExportDialog");

function renderDialog(overrides: Partial<React.ComponentProps<typeof CanvasExportDialog>> = {}) {
  const onClose = vi.fn();
  const onExportSuccess = vi.fn();
  render(
    <CanvasExportDialog
      open
      onClose={onClose}
      assessmentId={1}
      assessmentName="Midterm 1"
      courseId={7}
      onExportSuccess={onExportSuccess}
      {...overrides}
    />,
  );
  return { onClose, onExportSuccess };
}

describe("CanvasExportDialog", () => {
  beforeEach(() => {
    cleanup();
    canManageCanvas = true;
    getIntegration.mockReset();
    getCourses.mockReset();
    connectCanvasWithFallback.mockReset();
    exportAssessment.mockReset();
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

  it("validates required fields before connecting", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    renderDialog();

    await screen.findByLabelText("Canvas Instance URL");
    // Button is disabled without both fields, so directly exercise handleConnect's
    // internal guard is not reachable via click; fill only URL and check button state.
    fireEvent.change(screen.getByLabelText("Canvas Instance URL"), {
      target: { value: "https://canvas.instructure.com" },
    });
    expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret-key" } });
    expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeEnabled();
  });

  it("connects successfully and then loads courses", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    connectCanvasWithFallback.mockResolvedValue({
      integration: { isConnected: true },
      usedTestMode: false,
    });
    getCourses.mockResolvedValue([{ id: 1, name: "Intro to Biology", course_code: "BIO101" }]);
    renderDialog();

    await screen.findByLabelText("Canvas Instance URL");
    fireEvent.change(screen.getByLabelText("Canvas Instance URL"), {
      target: { value: "https://canvas.instructure.com" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));

    await waitFor(() =>
      expect(connectCanvasWithFallback).toHaveBeenCalledWith(
        "https://canvas.instructure.com",
        "secret-key",
      ),
    );
    await waitFor(() => expect(getCourses).toHaveBeenCalled());
    expect(await screen.findByText("Select Canvas Course")).toBeInTheDocument();
  });

  it("shows a test-mode toast when the fallback kicks in", async () => {
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
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        "Canvas test mode",
        expect.objectContaining({ description: expect.stringContaining("mock Canvas data") }),
      ),
    );
  });

  it("surfaces a toast when connecting fails", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    connectCanvasWithFallback.mockRejectedValue({
      response: { data: { error: "Bad credentials" } },
    });
    renderDialog();

    await screen.findByLabelText("Canvas Instance URL");
    fireEvent.change(screen.getByLabelText("Canvas Instance URL"), {
      target: { value: "https://canvas.instructure.com" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to connect Canvas",
        expect.objectContaining({ description: "Bad credentials" }),
      ),
    );
  });

  it("lists courses when already connected and exports on selection", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 42, name: "Organic Chemistry", course_code: "CHEM201" }]);
    exportAssessment.mockResolvedValue({
      quizId: 99,
      canvasUrl: "https://canvas.instructure.com/quizzes/99",
      questionsCreated: 5,
    });
    const { onExportSuccess, onClose } = renderDialog();

    expect(await screen.findByText("Select Canvas Course")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export to canvas/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("combobox"));
    const option = await screen.findByText("CHEM201 - Organic Chemistry");
    fireEvent.click(option);

    const exportButton = screen.getByRole("button", { name: /export to canvas/i });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);

    await waitFor(() => expect(exportAssessment).toHaveBeenCalledWith(1, 42));
    await waitFor(() =>
      expect(onExportSuccess).toHaveBeenCalledWith({
        quizId: 99,
        canvasUrl: "https://canvas.instructure.com/quizzes/99",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an empty state when there are no Canvas courses", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByText(/no courses found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export to canvas/i })).toBeDisabled();
  });

  it("surfaces a toast when export fails", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 42, name: "Chem", course_code: "CHEM201" }]);
    exportAssessment.mockRejectedValue({ response: { data: { error: "Quiz limit reached" } } });
    renderDialog();

    fireEvent.click(await screen.findByRole("combobox"));
    fireEvent.click(await screen.findByText("CHEM201 - Chem"));

    const exportButton = screen.getByRole("button", { name: /export to canvas/i });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Export failed",
        expect.objectContaining({ description: "Quiz limit reached" }),
      ),
    );
  });

  it("switches back to the connect form via Change Connection", async () => {
    getIntegration.mockResolvedValue({ isConnected: true });
    getCourses.mockResolvedValue([{ id: 42, name: "Chem", course_code: "CHEM201" }]);
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Change Connection" }));
    expect(await screen.findByLabelText("Canvas Instance URL")).toBeInTheDocument();
  });

  it("calls onClose from the Cancel footer button", async () => {
    getIntegration.mockResolvedValue({ isConnected: false });
    const { onClose } = renderDialog();

    await screen.findByLabelText("Canvas Instance URL");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
