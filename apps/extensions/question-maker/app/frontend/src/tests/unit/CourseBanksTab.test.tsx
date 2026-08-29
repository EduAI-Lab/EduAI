/**
 * Unit tests for CourseBanksTab (#1544): loading skeleton, empty state,
 * create-bank flow, error display, and bank card navigation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CourseBanksTab } from "@/pages/course-detail/CourseBanksTab";

afterEach(cleanup);

const banks = [
  { id: "b1", name: "Midterm bank", description: "Questions for midterm", isDefault: true },
  { id: "b2", name: "Final bank", description: "", isDefault: false },
] as any;

describe("CourseBanksTab", () => {
  it("renders a loading skeleton", () => {
    const { container } = render(
      <CourseBanksTab
        banks={[]}
        canWrite
        isLoading
        isCanvasLinked
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows empty state with writable copy when canWrite", () => {
    render(
      <CourseBanksTab
        banks={[]}
        canWrite
        isCanvasLinked
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );
    expect(screen.getByText("No question banks yet")).toBeInTheDocument();
    expect(screen.getByText(/Create a named bank/)).toBeInTheDocument();
  });

  it("shows read-only empty state copy when canWrite is false", () => {
    render(
      <CourseBanksTab
        banks={[]}
        canWrite={false}
        isCanvasLinked
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );
    expect(screen.getByText("No banks are available for this course.")).toBeInTheDocument();
    expect(screen.queryByTestId("banks-tab-new-bank")).not.toBeInTheDocument();
  });

  it("shows a load error message", () => {
    render(
      <CourseBanksTab
        banks={[]}
        canWrite
        loadError="Failed to load banks"
        isCanvasLinked
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load banks");
  });

  it("creates a bank via the inline form", async () => {
    const onCreateBank = vi.fn().mockResolvedValue(undefined);
    render(
      <CourseBanksTab
        banks={[]}
        canWrite
        isCanvasLinked
        onCreateBank={onCreateBank}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("banks-tab-new-bank"));
    const input = screen.getByLabelText("New bank name");
    fireEvent.change(input, { target: { value: "New Bank" } });
    fireEvent.click(screen.getByText("Create"));
    expect(onCreateBank).toHaveBeenCalledWith("New Bank");
  });

  it("cancels the create form on Escape", () => {
    render(
      <CourseBanksTab
        banks={[]}
        canWrite
        isCanvasLinked
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("banks-tab-new-bank"));
    const input = screen.getByLabelText("New bank name");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("New bank name")).not.toBeInTheDocument();
  });

  it("calls onSyncFromCanvas when the sync button is clicked", () => {
    const onSyncFromCanvas = vi.fn();
    render(
      <CourseBanksTab
        banks={[]}
        canWrite
        isCanvasLinked
        onCreateBank={vi.fn()}
        onSyncFromCanvas={onSyncFromCanvas}
        onOpenBank={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("sync-canvas-bank-btn"));
    expect(onSyncFromCanvas).toHaveBeenCalled();
  });

  it("hides the Canvas sync action when the course is not linked to Canvas", () => {
    render(
      <CourseBanksTab
        banks={[]}
        canWrite
        isCanvasLinked={false}
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("sync-canvas-bank-btn")).not.toBeInTheDocument();
  });

  it("renders bank cards with default badge and opens a bank on click", () => {
    const onOpenBank = vi.fn();
    render(
      <CourseBanksTab
        banks={banks}
        canWrite
        isCanvasLinked
        onCreateBank={vi.fn()}
        onSyncFromCanvas={vi.fn()}
        onOpenBank={onOpenBank}
      />,
    );
    expect(screen.getByText("Midterm bank")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("No description")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Midterm bank"));
    expect(onOpenBank).toHaveBeenCalledWith("b1");
  });
});
