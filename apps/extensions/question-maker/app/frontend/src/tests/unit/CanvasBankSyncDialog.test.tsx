/**
 * Unit tests for CanvasBankSyncDialog (#1545): the permission gate, the
 * disconnected and unlinked branches, the bank/topic/destination selects, and
 * the sync submit flow.
 *
 * The dialog no longer asks which Canvas course to pull from — #1652 scoped it
 * to the Canvas course the open course is linked to — so there is no connect
 * form and no course picker here. Radix Select triggers have no htmlFor/id
 * pairing, so comboboxes are addressed by render order (Canvas bank, topic,
 * destination bank).
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
      getCourseMapping: vi.fn(),
      getQuestionBanks: vi.fn(),
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

/** Opens the combobox at `index` in render order and clicks the named option. */
async function selectOption(index: number, optionText: string) {
  const combo = screen.getAllByRole("combobox")[index];
  fireEvent.click(combo);
  const option = await screen.findByText(optionText);
  fireEvent.click(option);
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof CanvasBankSyncDialog>> = {}) {
  return render(<CanvasBankSyncDialog open onClose={vi.fn()} localCourseId={5} {...overrides} />);
}

/** The common setup: connected, linked to Canvas course 1, with one Canvas bank. */
function mockLinkedCourse(banks: any[] = [{ id: 9, title: "Midterm Qs", question_count: 5 }]) {
  canvasService.getIntegration.mockResolvedValue({ isConnected: true });
  canvasService.getCourseMapping.mockResolvedValue({
    canvasCourseId: 1,
    canvasCourseName: "Intro CS",
  });
  canvasService.getQuestionBanks.mockResolvedValue(banks);
}

beforeEach(() => {
  vi.clearAllMocks();
  useQmPermissionsForCourseMock.mockReturnValue({ canManageCanvas: true });
  courseService.getCourseTopics.mockResolvedValue([{ id: "t1", name: "Topic One" }]);
  questionBankService.listBanks.mockResolvedValue([{ id: "b1", name: "Existing bank" }]);
});

describe("CanvasBankSyncDialog", () => {
  it("shows a restricted message when the user cannot manage Canvas", async () => {
    useQmPermissionsForCourseMock.mockReturnValue({ canManageCanvas: false });
    canvasService.getIntegration.mockResolvedValue({ isConnected: false });
    canvasService.getCourseMapping.mockResolvedValue(null);
    renderDialog();

    await waitFor(() =>
      expect(
        screen.getByText(/available to instructors and administrators only/i),
      ).toBeInTheDocument(),
    );
    // Without the permission there is no submit at all, only a way out. The
    // footer button reads "Close" rather than "Cancel"; the dialog's own
    // corner dismiss shares that accessible name, so match on the slot.
    expect(screen.queryByTestId("sync-bank-submit")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    const footerClose = screen
      .getAllByRole("button", { name: "Close" })
      .find((b) => b.getAttribute("data-slot") === "button");
    expect(footerClose).toBeDefined();
  });

  it("points at EduAI settings instead of a connect form when Canvas is disconnected", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: false });
    canvasService.getCourseMapping.mockResolvedValue(null);
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText(/Connect Canvas in your EduAI settings/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByTestId("sync-bank-submit")).toBeDisabled();
    expect(canvasService.getCourseMapping).not.toHaveBeenCalled();
  });

  it("blocks sync when the open course has no linked Canvas course", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true });
    canvasService.getCourseMapping.mockResolvedValue(null);
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText(/not linked to a Canvas course/i)).toBeInTheDocument(),
    );
    expect(canvasService.getQuestionBanks).not.toHaveBeenCalled();
    expect(screen.getByTestId("sync-bank-submit")).toBeDisabled();
  });

  it("loads banks from the Canvas course the open course is linked to", async () => {
    mockLinkedCourse();
    renderDialog();

    await waitFor(() => expect(canvasService.getQuestionBanks).toHaveBeenCalledWith(1));
    expect(await screen.findByTestId("linked-canvas-course")).toHaveTextContent("Intro CS");
  });

  it("names an unnamed linked Canvas course by its id", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true });
    canvasService.getCourseMapping.mockResolvedValue({ canvasCourseId: 7, canvasCourseName: null });
    canvasService.getQuestionBanks.mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByTestId("linked-canvas-course")).toHaveTextContent("Canvas course 7");
  });

  it("syncs into a new bank named after the Canvas bank", async () => {
    mockLinkedCourse();
    canvasService.importQuestionBank.mockResolvedValue({
      bankId: "nb1",
      created: 3,
      updated: 1,
      skipped: 0,
    });
    const onSyncSuccess = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onSyncSuccess, onClose });

    await waitFor(() => expect(canvasService.getQuestionBanks).toHaveBeenCalledWith(1));
    await selectOption(0, "Midterm Qs (5)");

    const syncButton = await screen.findByTestId("sync-bank-submit");
    await waitFor(() => expect(syncButton).toBeEnabled());
    fireEvent.click(syncButton);

    await waitFor(() =>
      expect(canvasService.importQuestionBank).toHaveBeenCalledWith(1, 9, 5, {
        primaryTopicId: "t1",
        // "__new__" is a sentinel for the select, never sent to the server.
        targetBankId: undefined,
      }),
    );
    await waitFor(() =>
      expect(onSyncSuccess).toHaveBeenCalledWith({
        bankId: "nb1",
        created: 3,
        updated: 1,
        skipped: 0,
      }),
    );
    expect(toastFn).toHaveBeenCalledWith(
      "Bank synced",
      expect.objectContaining({ description: "Created 3, updated 1, skipped 0" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("syncs into an existing local bank when selected as the destination", async () => {
    mockLinkedCourse([{ id: 9, title: "Midterm Qs" }]);
    canvasService.importQuestionBank.mockResolvedValue({
      bankId: "b1",
      created: 1,
      updated: 0,
      skipped: 0,
    });
    renderDialog();

    await waitFor(() => expect(canvasService.getQuestionBanks).toHaveBeenCalled());
    await selectOption(0, "Midterm Qs");
    // Destination bank is the third combobox (bank, topic, destination).
    await selectOption(2, "Existing bank");

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
    mockLinkedCourse([{ id: 9, title: "Midterm Qs" }]);
    canvasService.importQuestionBank.mockRejectedValue({ response: { data: { error: "boom" } } });
    renderDialog();

    await waitFor(() => expect(canvasService.getQuestionBanks).toHaveBeenCalled());
    await selectOption(0, "Midterm Qs");
    fireEvent.click(await screen.findByTestId("sync-bank-submit"));

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Sync failed",
        expect.objectContaining({ description: "boom" }),
      ),
    );
  });

  it("shows an error toast and clears banks when loading Canvas banks fails", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true });
    canvasService.getCourseMapping.mockResolvedValue({
      canvasCourseId: 1,
      canvasCourseName: "Intro CS",
    });
    canvasService.getQuestionBanks.mockRejectedValue({ message: "banks down" });
    renderDialog();

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Failed to load Canvas banks",
        expect.objectContaining({ description: "banks down" }),
      ),
    );
    // The bank select is still rendered, just empty — sync stays blocked.
    expect(await screen.findByTestId("sync-bank-submit")).toBeDisabled();
  });

  it("preselects the destination bank from selectedLocalBankId", async () => {
    mockLinkedCourse([]);
    questionBankService.listBanks.mockResolvedValue([
      { id: "b1", name: "Existing bank" },
      { id: "b2", name: "Other bank" },
    ]);
    renderDialog({ selectedLocalBankId: "b2" });

    await screen.findByTestId("linked-canvas-course");
    const destinationCombo = screen.getAllByRole("combobox")[2];
    await waitFor(() => expect(destinationCombo).toHaveTextContent("Other bank"));
  });

  it("labels a Canvas bank without a title using its name or id fallback", async () => {
    mockLinkedCourse([{ id: 9, name: "Named Bank" }, { id: 10 }]);
    renderDialog();

    await waitFor(() => expect(canvasService.getQuestionBanks).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    expect(await screen.findByText("Named Bank")).toBeInTheDocument();
    expect(screen.getByText("Bank 10")).toBeInTheDocument();
  });

  it("does nothing when there is no course in context", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true });
    renderDialog({ localCourseId: null });

    await waitFor(() => expect(canvasService.getIntegration).toHaveBeenCalled());
    expect(canvasService.getCourseMapping).not.toHaveBeenCalled();
    expect(courseService.getCourseTopics).not.toHaveBeenCalled();
    expect(screen.getByTestId("sync-bank-submit")).toBeDisabled();
  });
});
