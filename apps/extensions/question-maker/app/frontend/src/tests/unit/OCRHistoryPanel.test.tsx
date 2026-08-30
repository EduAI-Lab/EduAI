/**
 * Unit tests for `OCRHistoryPanel` (#1546): date-bucketed job grouping
 * (in-progress / today / yesterday / earlier), collapsed-by-default "Earlier"
 * group, empty state, and the panel's toggle/clear actions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { OCRHistoryPanel } from "@/components/ocr/OCRHistoryPanel";
import type { OCRJob } from "@/types/ocr";

afterEach(() => cleanup());

function makeJob(overrides: Partial<OCRJob>): OCRJob {
  return {
    id: overrides.id ?? "job",
    fileName: "scan.pdf",
    courseId: 1,
    courseName: "CPSC 101",
    model: "vllm:qwen2.5-32b-instruct",
    status: "success",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const baseProps = {
  currentCourseId: 1,
  isOpen: true,
  onToggle: vi.fn(),
  onSelectJob: vi.fn(),
  onRemoveJob: vi.fn(),
  onClearHistory: vi.fn(),
};

describe("OCRHistoryPanel", () => {
  it("renders nothing inside when closed", () => {
    render(<OCRHistoryPanel {...baseProps} isOpen={false} jobs={[]} />);
    expect(screen.queryByText("Upload History")).toBeNull();
  });

  it("shows the empty state when there are no jobs", () => {
    render(<OCRHistoryPanel {...baseProps} jobs={[]} />);
    expect(screen.getByText("No recent uploads")).toBeInTheDocument();
  });

  it('groups an in-progress job under "In Progress" with a badge count', () => {
    const jobs = [makeJob({ id: "p1", status: "processing" })];
    render(<OCRHistoryPanel {...baseProps} jobs={jobs} />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it('groups a today job under "Today"', () => {
    const jobs = [makeJob({ id: "t1", createdAt: new Date().toISOString() })];
    render(<OCRHistoryPanel {...baseProps} jobs={jobs} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it('groups a job from 2 days ago under "Earlier" and collapses it by default', () => {
    const old = new Date();
    old.setDate(old.getDate() - 5);
    const jobs = [makeJob({ id: "e1", createdAt: old.toISOString() })];
    render(<OCRHistoryPanel {...baseProps} jobs={jobs} />);

    expect(screen.getByText("Earlier")).toBeInTheDocument();
    expect(screen.queryByText("scan.pdf")).toBeNull();

    fireEvent.click(screen.getByText("Earlier"));
    expect(screen.getByText("scan.pdf")).toBeInTheDocument();
  });

  it("calls onToggle when the close button is clicked", () => {
    const onToggle = vi.fn();
    render(<OCRHistoryPanel {...baseProps} jobs={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("Close history panel"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("calls onClearHistory when Clear History is clicked, and hides it when empty", () => {
    const onClearHistory = vi.fn();
    const jobs = [makeJob({ id: "j1" })];
    render(<OCRHistoryPanel {...baseProps} jobs={jobs} onClearHistory={onClearHistory} />);
    fireEvent.click(screen.getByText("Clear History"));
    expect(onClearHistory).toHaveBeenCalled();

    cleanup();
    render(<OCRHistoryPanel {...baseProps} jobs={[]} onClearHistory={onClearHistory} />);
    expect(screen.queryByText("Clear History")).toBeNull();
  });

  it("forwards onSelectJob/onRemoveJob to the underlying job cards", () => {
    const onSelectJob = vi.fn();
    const onRemoveJob = vi.fn();
    const jobs = [makeJob({ id: "j1", storedQuestions: [{ id: "q1", text: "Q", type: "mcq" }] })];
    render(
      <OCRHistoryPanel
        {...baseProps}
        jobs={jobs}
        onSelectJob={onSelectJob}
        onRemoveJob={onRemoveJob}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Remove scan.pdf/));
    expect(onRemoveJob).toHaveBeenCalledWith("j1");
  });
});
