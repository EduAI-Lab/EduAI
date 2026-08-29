/**
 * Unit tests for CourseCanvasTab (#1544): loading skeleton, disconnected empty
 * state, and the connected panels (connection info, import action, export
 * guidance). The tab renders only for Canvas-synced courses, so it no longer
 * restates the course link itself (#1652).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const { canvasService } = vi.hoisted(() => ({
  canvasService: { getIntegration: vi.fn() },
}));

vi.mock("@/services/canvasService", () => ({ canvasService }));

import { CourseCanvasTab } from "@/pages/course-detail/CourseCanvasTab";

afterEach(cleanup);

function renderTab(props: Partial<React.ComponentProps<typeof CourseCanvasTab>> = {}) {
  return render(
    <MemoryRouter>
      <CourseCanvasTab courseId={1} canWrite onImportFromCanvas={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe("CourseCanvasTab", () => {
  it("shows skeletons while the integration is still loading", () => {
    canvasService.getIntegration.mockReturnValue(new Promise(() => {}));
    const { container } = renderTab();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(2);
  });

  it("shows a not-connected empty state when Canvas is not connected", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: false });
    renderTab();
    await waitFor(() => expect(screen.getByText("Canvas isn't connected")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Connect Canvas in Settings/ })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("treats a missing integration as not connected", async () => {
    canvasService.getIntegration.mockResolvedValue(null);
    renderTab();
    await waitFor(() => expect(screen.getByText("Canvas isn't connected")).toBeInTheDocument());
  });

  it("shows the connection panel and export guidance when connected", async () => {
    canvasService.getIntegration.mockResolvedValue({
      isConnected: true,
      isTestMode: false,
      canvasUrl: "https://canvas.example.edu",
    });
    renderTab();
    await waitFor(() => expect(screen.getByText("https://canvas.example.edu")).toBeInTheDocument());
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connection" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByText(/To export, open an assessment/)).toBeInTheDocument();
  });

  it("falls back to a generic label when the integration has no Canvas URL", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true, isTestMode: false });
    renderTab();
    await waitFor(() => expect(screen.getByText("Canvas")).toBeInTheDocument());
  });

  it("badges the connection as test mode when the integration is in test mode", async () => {
    canvasService.getIntegration.mockResolvedValue({
      isConnected: true,
      isTestMode: true,
      canvasUrl: "https://canvas.example.edu",
    });
    renderTab();
    await waitFor(() => expect(screen.getByText("Test mode")).toBeInTheDocument());
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("invokes onImportFromCanvas when the import button is clicked", async () => {
    const onImportFromCanvas = vi.fn();
    canvasService.getIntegration.mockResolvedValue({ isConnected: true, isTestMode: false });
    renderTab({ onImportFromCanvas });
    await waitFor(() => expect(screen.getByText("Import from Canvas")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Import from Canvas"));
    expect(onImportFromCanvas).toHaveBeenCalled();
  });

  it("disables the import button when canWrite is false", async () => {
    canvasService.getIntegration.mockResolvedValue({ isConnected: true, isTestMode: false });
    renderTab({ canWrite: false });
    await waitFor(() =>
      expect(screen.getByText("Import from Canvas").closest("button")).toBeDisabled(),
    );
  });
});
