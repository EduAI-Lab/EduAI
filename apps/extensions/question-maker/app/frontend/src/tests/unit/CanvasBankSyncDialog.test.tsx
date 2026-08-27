/**
 * Unit tests for CanvasBankSyncDialog (#1545): permission gate, connect-form
 * vs picker branches, cascading Canvas course -> bank loads, and the sync
 * submit flow. Radix Select triggers have no htmlFor/id pairing here, so
 * comboboxes are addressed by their render order (course, bank, topic,
 * destination bank) rather than accessible name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  useQmPermissionsForCourseMock,
  canvasService,
  courseService,
  questionBankService,
  toastFn,
} = vi.hoisted(() => {
  const toast = vi.fn() as any;
  toast.error = vi.fn();
  return {
    useQmPermissionsForCourseMock: vi.fn(),
    canvasService: {
      getIntegration: vi.fn(),
      getCourses: vi.fn(),
      getQuestionBanks: vi.fn(),
      connectCanvasWithFallback: vi.fn(),
      importQuestionBank: vi.fn(),
    },
    courseService: { getCourseTopics: vi.fn() },
    questionBankService: { listBanks: vi.fn() },
    toastFn: toast,
  };
});

vi.mock("sonner", () => ({ toast: toastFn }));
vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: (...a: any[]) => useQmPermissionsForCourseMock(...a),
}));
vi.mock("@/services/canvasService", () => ({ default: canvasService }));
vi.mock("@/services/courseService", () => ({ courseService }));
vi.mock("@/services/questionBankService", () => ({ questionBankService }));

import { CanvasBankSyncDialog } from "@/components/canvas/CanvasBankSyncDialog";

afterEach(cleanup);

async function selectOption(index: number, optionText: string) {
  const combo = screen.getAllByRole("combobox")[index];
  fireEvent.click(combo);
  const option = await screen.findByText(optionText);
  fireEvent.click(option);
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof CanvasBankSyncDialog>> = {}) {
  return render(<CanvasBankSyncDialog open onClose={vi.fn()} localCourseId={5} {...overrides} />);
}

beforeEach(() => {
  useQmPermissionsForCourseMock.mockReturnValue({ canManageCanvas: true });
  courseService.getCourseTopics.mockResolvedValue([{ id: "t1", name: "Topic One" }]);
  questionBankService.listBanks.mockResolvedValue([{ id: "b1", name: "Existing bank" }]);
});

describe("CanvasBankSyncDialog", () => {
  it("shows a restricted message when the user cannot manage Canvas", async () => {
    useQmPermissionsForCourseMock.mockReturnValue({ canManageCanvas: false });
    canvasService.getIntegration.mockResolvedValue({ isConnected: false });
    renderDialog();
    await waitFor(() =>
      expect(
        screen.getByText(/available to instructors and administrators only/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows the connect form when Canvas is not connected", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: false });
    renderDialog();
    expect(await screen.findByLabelText("Canvas Instance URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeDisabled();
  });

  it("connects successfully and loads Canvas courses", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: false });
    canvasService.connectCanvasWithFallback.mockResolvedValue({
      integration: { isConnected: true },
      usedTestMode: false,
    });
    canvasService.getCourses.mockResolvedValue([{ id: 1, name: "Intro CS", course_code: "CS101" }]);
    renderDialog();
    await screen.findByLabelText("Canvas Instance URL");
    fireEvent.change(screen.getByLabelText("Canvas Instance URL"), {
      target: { value: "https://canvas.ubc.ca" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));
    await waitFor(() => expect(canvasService.getCourses).toHaveBeenCalled());
    expect(await screen.findByText("Canvas question bank")).toBeInTheDocument();
  });

  it("shows a test-mode toast when fallback test mode is used", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: false });
    canvasService.connectCanvasWithFallback.mockResolvedValue({
      integration: { isConnected: true },
      usedTestMode: true,
    });
    canvasService.getCourses.mockResolvedValue([]);
    renderDialog();
    await screen.findByLabelText("Canvas Instance URL");
    fireEvent.change(screen.getByLabelText("Canvas Instance URL"), {
      target: { value: "https://canvas.ubc.ca" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith("Canvas test mode", expect.any(Object)),
    );
  });

  it("shows an error toast when connecting fails", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: false });
    canvasService.connectCanvasWithFallback.mockRejectedValue({
      response: { data: { error: "Bad creds" } },
    });
    renderDialog();
    await screen.findByLabelText("Canvas Instance URL");
    fireEvent.change(screen.getByLabelText("Canvas Instance URL"), {
      target: { value: "https://canvas.ubc.ca" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Connection failed",
        expect.objectContaining({ description: "Bad creds" }),
      ),
    );
  });

  it("loads Canvas banks when a Canvas course is selected, and syncs", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true });
    canvasService.getCourses.mockResolvedValue([{ id: 1, name: "Intro CS", course_code: "CS101" }]);
    canvasService.getQuestionBanks.mockResolvedValue([
      { id: 9, title: "Midterm Qs", question_count: 5 },
    ]);
    canvasService.importQuestionBank.mockResolvedValue({ created: 3, updated: 1, skipped: 0 });
    const onSyncSuccess = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onSyncSuccess, onClose });

    await selectOption(0, "CS101 - Intro CS");
    await waitFor(() => expect(canvasService.getQuestionBanks).toHaveBeenCalledWith(1));

    await selectOption(1, "Midterm Qs (5)");

    const syncButton = await screen.findByTestId("sync-bank-submit");
    await waitFor(() => expect(syncButton).toBeEnabled());
    fireEvent.click(syncButton);

    await waitFor(() =>
      expect(canvasService.importQuestionBank).toHaveBeenCalledWith(1, 9, 5, {
        primaryTopicId: "t1",
        targetBankId: undefined,
      }),
    );
    await waitFor(() =>
      expect(onSyncSuccess).toHaveBeenCalledWith({ created: 3, updated: 1, skipped: 0 }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("syncs into an existing local bank when selected as the destination", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true });
    canvasService.getCourses.mockResolvedValue([{ id: 1, name: "Intro CS", course_code: "CS101" }]);
    canvasService.getQuestionBanks.mockResolvedValue([{ id: 9, title: "Midterm Qs" }]);
    canvasService.importQuestionBank.mockResolvedValue({ created: 1, updated: 0, skipped: 0 });
    renderDialog();

    await selectOption(0, "CS101 - Intro CS");
    await waitFor(() => expect(canvasService.getQuestionBanks).toHaveBeenCalled());
    await selectOption(1, "Midterm Qs");
    // Destination bank select is the 4th combobox; pick the existing bank.
    await selectOption(3, "Existing bank");

    fireEvent.click(await screen.findByTestId("sync-bank-submit"));
    await waitFor(() =>
      expect(canvasService.importQuestionBank).toHaveBeenCalledWith(
        1,
        9,
        5,
        expect.objectContaining({ targetBankId: "b1" }),
      ),
    );
  });

  it("shows an error toast when sync fails", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true });
    canvasService.getCourses.mockResolvedValue([{ id: 1, name: "Intro CS", course_code: "CS101" }]);
    canvasService.getQuestionBanks.mockResolvedValue([{ id: 9, title: "Midterm Qs" }]);
    canvasService.importQuestionBank.mockRejectedValue({ response: { data: { error: "boom" } } });
    renderDialog();

    await selectOption(0, "CS101 - Intro CS");
    await waitFor(() => expect(canvasService.getQuestionBanks).toHaveBeenCalled());
    await selectOption(1, "Midterm Qs");
    fireEvent.click(await screen.findByTestId("sync-bank-submit"));
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Sync failed",
        expect.objectContaining({ description: "boom" }),
      ),
    );
  });

  it("lets the user switch back to the connect form", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true });
    canvasService.getCourses.mockResolvedValue([]);
    renderDialog();
    await screen.findByText("Canvas course");
    fireEvent.click(screen.getByText("Change Connection"));
    expect(await screen.findByLabelText("Canvas Instance URL")).toBeInTheDocument();
  });

  it("shows an error toast when loading Canvas courses fails", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true });
    canvasService.getCourses.mockRejectedValue({ message: "network down" });
    renderDialog();
    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Failed to load Canvas courses",
        expect.objectContaining({ description: "network down" }),
      ),
    );
  });
});
