import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CanvasMaterialSyncDialog } from "~/components/canvas/canvas-material-sync-dialog";
import {
  discoverCanvasMaterials,
  excludeCanvasMaterial,
  syncCanvasMaterials,
  unexcludeCanvasMaterial,
} from "~/lib/canvas/client";

vi.mock("~/lib/canvas/client", () => ({
  discoverCanvasMaterials: vi.fn(),
  syncCanvasMaterials: vi.fn(),
  excludeCanvasMaterial: vi.fn(),
  unexcludeCanvasMaterial: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

const FILES = [
  {
    canvasFileId: "1001",
    displayName: "Lecture 1.txt",
    mimeType: "text/plain",
    sizeBytes: 100,
    canvasUpdatedAt: "2025-01-10T12:00:00.000Z",
    importStatus: "not_imported" as const,
    coreMaterialId: null,
    isPublished: true,
    isExcluded: false,
  },
  {
    canvasFileId: "1002",
    displayName: "Week 1 Notes.txt",
    mimeType: "text/plain",
    sizeBytes: 200,
    canvasUpdatedAt: "2025-01-12T09:00:00.000Z",
    importStatus: "imported" as const,
    coreMaterialId: "mat-1",
    isPublished: true,
    isExcluded: false,
  },
];

describe("CanvasMaterialSyncDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(discoverCanvasMaterials).mockResolvedValue(FILES);
    vi.mocked(syncCanvasMaterials).mockResolvedValue({
      imported: 1,
      updated: 0,
      skipped: 0,
      failed: [],
      skippedItems: [],
    });
  });

  it("loads Canvas files when opened and pre-checks not_imported files", async () => {
    render(
      <CanvasMaterialSyncDialog
        courseId="course-1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Lecture 1.txt")).toBeInTheDocument();
    });

    expect(discoverCanvasMaterials).toHaveBeenCalledWith("course-1");
    expect(screen.getByRole("button", { name: /sync selected \(1\)/i })).toBeInTheDocument();
  });

  it("syncs selected files", async () => {
    const onSynced = vi.fn();
    render(
      <CanvasMaterialSyncDialog
        courseId="course-1"
        open
        onOpenChange={vi.fn()}
        onSynced={onSynced}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Lecture 1.txt")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /sync selected/i }));

    await waitFor(() => {
      expect(syncCanvasMaterials).toHaveBeenCalledWith("course-1", ["1001"]);
      expect(onSynced).toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("Sync complete: 1 imported");
    });
  });

  it("shows failed sync details after refresh", async () => {
    vi.mocked(syncCanvasMaterials).mockResolvedValue({
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: [{ canvasFileId: "1001", message: "Canvas file download failed: 403" }],
      skippedItems: [],
    });

    render(
      <CanvasMaterialSyncDialog
        courseId="course-1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Lecture 1.txt")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /sync selected/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("1 failed");
      expect(screen.getByText(/Canvas file download failed: 403/)).toBeInTheDocument();
    });
  });

  it("disables the checkbox and shows a badge for an unpublished file", async () => {
    vi.mocked(discoverCanvasMaterials).mockResolvedValue([
      {
        canvasFileId: "1001",
        displayName: "Draft Notes.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        canvasUpdatedAt: "2026-01-01T00:00:00.000Z",
        importStatus: "not_imported",
        coreMaterialId: null,
        isPublished: false,
        isExcluded: false,
      },
    ]);

    render(<CanvasMaterialSyncDialog courseId="course-1" open onOpenChange={() => {}} />);

    expect(await screen.findByText("Draft Notes.txt")).toBeInTheDocument();
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("calls excludeCanvasMaterial when the exclude toggle is clicked", async () => {
    vi.mocked(discoverCanvasMaterials).mockResolvedValue([
      {
        canvasFileId: "1001",
        displayName: "Midterm Scores.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        canvasUpdatedAt: "2026-01-01T00:00:00.000Z",
        importStatus: "not_imported",
        coreMaterialId: null,
        isPublished: true,
        isExcluded: false,
      },
    ]);

    render(<CanvasMaterialSyncDialog courseId="course-1" open onOpenChange={() => {}} />);
    await screen.findByText("Midterm Scores.txt");

    fireEvent.click(screen.getByRole("button", { name: /exclude/i }));

    await waitFor(() => expect(excludeCanvasMaterial).toHaveBeenCalledWith("course-1", "1001"));
  });
});
