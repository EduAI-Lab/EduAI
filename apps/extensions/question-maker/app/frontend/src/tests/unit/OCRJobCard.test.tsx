/**
 * Unit tests for `OCRJobCard` (#1546): status-driven rendering, filename
 * truncation, click-to-restore gating (success/discarded with stored
 * questions, only), and the remove action.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { OCRJobCard } from "@/components/ocr/OCRJobCard";
import type { OCRJob } from "@/types/ocr";

afterEach(() => cleanup());

function makeJob(overrides: Partial<OCRJob> = {}): OCRJob {
  return {
    id: "job-1",
    fileName: "scan.pdf",
    courseId: 1,
    courseName: "CPSC 101",
    model: "vllm:qwen2.5-32b-instruct",
    status: "success",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("OCRJobCard", () => {
  it("renders as non-interactive when there are no stored questions", () => {
    render(<OCRJobCard job={makeJob()} isCurrentCourse />);
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeInTheDocument();
    // The outer card itself should not carry a button role without storedQuestions.
    const outer = screen.getByText("scan.pdf").closest('div[class*="rounded-lg"]');
    expect(outer).not.toHaveAttribute("role", "button");
  });

  it("is clickable and calls onSelect when success with stored questions", () => {
    const onSelect = vi.fn();
    const job = makeJob({ storedQuestions: [{ id: "q1", text: "Q", type: "mcq" }] });
    const { container } = render(<OCRJobCard job={job} isCurrentCourse onSelect={onSelect} />);

    const outer = container.querySelector('[role="button"]') as HTMLElement;
    expect(outer).toBeTruthy();
    fireEvent.click(outer);
    expect(onSelect).toHaveBeenCalledWith(job);
  });

  it("supports keyboard activation (Enter) when clickable", () => {
    const onSelect = vi.fn();
    const job = makeJob({ storedQuestions: [{ id: "q1", text: "Q", type: "mcq" }] });
    const { container } = render(<OCRJobCard job={job} isCurrentCourse onSelect={onSelect} />);

    const outer = container.querySelector('[role="button"]') as HTMLElement;
    fireEvent.keyDown(outer, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(job);
  });

  it("does not call onSelect for a pending job even with a click", () => {
    const onSelect = vi.fn();
    render(<OCRJobCard job={makeJob({ status: "pending" })} isCurrentCourse onSelect={onSelect} />);
    fireEvent.click(screen.getByText("scan.pdf"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onRemove with the job id and stops propagation", () => {
    const onRemove = vi.fn();
    const onSelect = vi.fn();
    const job = makeJob({ storedQuestions: [{ id: "q1", text: "Q", type: "mcq" }] });
    render(<OCRJobCard job={job} isCurrentCourse onSelect={onSelect} onRemove={onRemove} />);

    fireEvent.click(screen.getByLabelText(/Remove scan.pdf/));
    expect(onRemove).toHaveBeenCalledWith("job-1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("truncates long filenames and shows a tooltip target", () => {
    const longName = "a-very-long-filename-that-exceeds-limit.pdf";
    render(<OCRJobCard job={makeJob({ fileName: longName })} isCurrentCourse />);
    expect(screen.getByText(`${longName.slice(0, 21)}...`)).toBeInTheDocument();
  });

  it("shows the course name when not the current course", () => {
    render(<OCRJobCard job={makeJob()} isCurrentCourse={false} />);
    expect(screen.getByText("CPSC 101")).toBeInTheDocument();
  });

  it("shows extracted question count for a successful job", () => {
    render(<OCRJobCard job={makeJob({ questionsCount: 4 })} isCurrentCourse />);
    expect(screen.getByText("4 questions extracted")).toBeInTheDocument();
  });

  it("shows singular wording for exactly one extracted question", () => {
    render(<OCRJobCard job={makeJob({ questionsCount: 1 })} isCurrentCourse />);
    expect(screen.getByText("1 question extracted")).toBeInTheDocument();
  });

  it("shows the error message for a failed job", () => {
    render(
      <OCRJobCard
        job={makeJob({ status: "error", error: "Extraction timed out" })}
        isCurrentCourse
      />,
    );
    expect(screen.getByText("Extraction timed out")).toBeInTheDocument();
  });

  it('shows the "different course" hint when clickable but for another course', () => {
    const job = makeJob({ storedQuestions: [{ id: "q1", text: "Q", type: "mcq" }] });
    render(<OCRJobCard job={job} isCurrentCourse={false} />);
    expect(screen.getByText(/Different course - click to view/)).toBeInTheDocument();
  });
});
