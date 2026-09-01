/**
 * Unit tests for CourseOverviewTab (#1544): stat cards, quick actions gating,
 * and the analytics/empty-state branch logic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CourseOverviewTab } from "@/pages/course-detail/CourseOverviewTab";

afterEach(cleanup);

const baseAnalytics = {
  typeComposition: [],
  difficulty: [],
  totalQuestions: 0,
  totalVariants: 0,
  aiCount: 0,
  humanCount: 0,
  reviewedCount: 0,
} as any;

describe("CourseOverviewTab", () => {
  it("renders stat counts", () => {
    render(
      <CourseOverviewTab
        questionsCount={3}
        assessmentsCount={2}
        topicsCount={1}
        analytics={baseAnalytics}
        canWrite
        canManageAssessment
        onAddQuestion={vi.fn()}
        onNewAssessment={vi.fn()}
        onImportFromCanvas={vi.fn()}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("hides quick actions when canWrite is false", () => {
    render(
      <CourseOverviewTab
        questionsCount={3}
        assessmentsCount={2}
        topicsCount={1}
        analytics={baseAnalytics}
        canWrite={false}
        canManageAssessment={false}
        onAddQuestion={vi.fn()}
        onNewAssessment={vi.fn()}
        onImportFromCanvas={vi.fn()}
      />,
    );
    expect(screen.queryByText("Add question")).not.toBeInTheDocument();
  });

  it("invokes quick action handlers when clicked", () => {
    const onAddQuestion = vi.fn();
    const onNewAssessment = vi.fn();
    const onImportFromCanvas = vi.fn();
    render(
      <CourseOverviewTab
        questionsCount={3}
        assessmentsCount={2}
        topicsCount={1}
        analytics={baseAnalytics}
        canWrite
        canManageAssessment
        onAddQuestion={onAddQuestion}
        onNewAssessment={onNewAssessment}
        onImportFromCanvas={onImportFromCanvas}
      />,
    );
    fireEvent.click(screen.getByText("Add question"));
    expect(onAddQuestion).toHaveBeenCalled();
    fireEvent.click(screen.getByText("New assessment"));
    expect(onNewAssessment).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Import from Canvas"));
    expect(onImportFromCanvas).toHaveBeenCalled();
  });

  it("shows an empty state with add-your-first-question when there are no questions", () => {
    const onAddQuestion = vi.fn();
    render(
      <CourseOverviewTab
        questionsCount={0}
        assessmentsCount={0}
        topicsCount={0}
        analytics={baseAnalytics}
        canWrite
        canManageAssessment
        onAddQuestion={onAddQuestion}
        onNewAssessment={vi.fn()}
        onImportFromCanvas={vi.fn()}
      />,
    );
    expect(screen.getByText("No questions yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add your first question"));
    expect(onAddQuestion).toHaveBeenCalled();
  });

  it("does not show the add-first-question button when canWrite is false", () => {
    render(
      <CourseOverviewTab
        questionsCount={0}
        assessmentsCount={0}
        topicsCount={0}
        analytics={baseAnalytics}
        canWrite={false}
        canManageAssessment={false}
        onAddQuestion={vi.fn()}
        onNewAssessment={vi.fn()}
        onImportFromCanvas={vi.fn()}
      />,
    );
    expect(screen.queryByText("Add your first question")).not.toBeInTheDocument();
  });

  it("shows an unavailable message when analytics fail to load", () => {
    render(
      <CourseOverviewTab
        questionsCount={5}
        assessmentsCount={0}
        topicsCount={0}
        analytics={baseAnalytics}
        analyticsStatus="unavailable"
        canWrite
        canManageAssessment
        onAddQuestion={vi.fn()}
        onNewAssessment={vi.fn()}
        onImportFromCanvas={vi.fn()}
      />,
    );
    expect(screen.getByText("Analytics unavailable")).toBeInTheDocument();
  });

  it("shows a loading message while analytics load", () => {
    render(
      <CourseOverviewTab
        questionsCount={5}
        assessmentsCount={0}
        topicsCount={0}
        analytics={baseAnalytics}
        analyticsStatus="loading"
        canWrite
        canManageAssessment
        onAddQuestion={vi.fn()}
        onNewAssessment={vi.fn()}
        onImportFromCanvas={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading course analytics…")).toBeInTheDocument();
  });
});
