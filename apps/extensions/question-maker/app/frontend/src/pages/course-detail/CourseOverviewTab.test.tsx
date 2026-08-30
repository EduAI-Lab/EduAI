/**
 * @vitest-environment jsdom
 *
 * Canvas import is scoped to the Canvas course the local course is linked to,
 * so on an unlinked course the action is withheld — not just the Canvas tab
 * (#1652 review). The tab omits `onImportFromCanvas` in that case, and this
 * component must then not offer the quick action at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CourseOverviewTab } from "./CourseOverviewTab";

const baseProps = {
  questionsCount: 4,
  assessmentsCount: 2,
  topicsCount: 3,
  // The analytics block is not under test; "unavailable" renders a notice
  // instead of the charts.
  analytics: {} as never,
  analyticsStatus: "unavailable" as const,
  canWrite: true,
  onAddQuestion: vi.fn(),
  onNewAssessment: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CourseOverviewTab Canvas quick action", () => {
  it("offers the import action when the course is linked to Canvas", () => {
    render(<CourseOverviewTab {...baseProps} onImportFromCanvas={vi.fn()} />);

    expect(screen.getByText("Import from Canvas")).toBeInTheDocument();
  });

  it("hides the import action when no handler is supplied", () => {
    render(<CourseOverviewTab {...baseProps} />);

    expect(screen.queryByText("Import from Canvas")).not.toBeInTheDocument();
    // The other quick actions are unaffected.
    expect(screen.getByText("Add question")).toBeInTheDocument();
    expect(screen.getByText("New assessment")).toBeInTheDocument();
  });
});
