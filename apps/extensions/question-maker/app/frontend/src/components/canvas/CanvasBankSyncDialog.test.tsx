/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { CanvasBankSyncDialog } from "./CanvasBankSyncDialog";

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
    getQuestionBanks: vi.fn(),
    importQuestionBank: vi.fn(),
  },
}));

vi.mock("../../services/courseService", () => ({
  courseService: {
    getCourseTopics: vi.fn(),
  },
}));

vi.mock("../../services/questionBankService", () => ({
  questionBankService: {
    listBanks: vi.fn(),
  },
}));

import canvasService from "../../services/canvasService";
import { courseService } from "../../services/courseService";
import { questionBankService } from "../../services/questionBankService";

describe("CanvasBankSyncDialog", () => {
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
    vi.mocked(canvasService.getQuestionBanks).mockResolvedValue([
      { id: 10, title: "Chapter 1", question_count: 2 },
    ]);
    vi.mocked(canvasService.importQuestionBank).mockResolvedValue({
      bankId: "core_bank_1",
      created: 2,
      updated: 0,
      skipped: 0,
    });
    vi.mocked(courseService.getCourseTopics).mockResolvedValue([
      { id: "topic_cuid_3", name: "Topic A", courseId: 9, createdAt: "", updatedAt: "" },
    ]);
    vi.mocked(questionBankService.listBanks).mockResolvedValue([
      { id: "core_bank_1", courseId: 9, name: "Course bank", isDefault: true },
    ]);
  });

  it("disables sync until a Canvas bank is selected", async () => {
    render(<CanvasBankSyncDialog open onClose={vi.fn()} localCourseId={9} />);

    await waitFor(() => {
      expect(screen.getByText("Sync question bank from Canvas")).toBeInTheDocument();
    });

    const syncBtn = await screen.findByTestId("sync-bank-submit");
    expect(syncBtn).toBeDisabled();
  });

  it("loads banks from the Canvas course linked to the open course", async () => {
    render(<CanvasBankSyncDialog open onClose={vi.fn()} localCourseId={9} />);

    await waitFor(() => {
      expect(canvasService.getQuestionBanks).toHaveBeenCalledWith(1);
    });
    expect(canvasService.getCourses).not.toHaveBeenCalled();
    expect(await screen.findByText("CS 101")).toBeInTheDocument();
  });

  it("blocks sync when the open course has no linked Canvas course", async () => {
    vi.mocked(canvasService.getCourseMapping).mockResolvedValue(null);

    render(<CanvasBankSyncDialog open onClose={vi.fn()} localCourseId={9} />);

    expect(
      await screen.findByText(
        /This course is not linked to a Canvas course\. Sync the course from Canvas/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sync-bank-submit")).toBeDisabled();
    expect(canvasService.getQuestionBanks).not.toHaveBeenCalled();
  });

  it("points at EduAI settings instead of a connect form when Canvas is disconnected", async () => {
    vi.mocked(canvasService.getIntegration).mockResolvedValue(null);

    render(<CanvasBankSyncDialog open onClose={vi.fn()} localCourseId={9} />);

    expect(await screen.findByText(/Canvas is not connected/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Canvas Instance URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Change Connection")).not.toBeInTheDocument();
    expect(screen.getByTestId("sync-bank-submit")).toBeDisabled();
  });
});
