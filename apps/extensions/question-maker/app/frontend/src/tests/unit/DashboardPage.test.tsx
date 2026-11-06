/**
 * Unit tests for DashboardPage (#2119). Hooks and the presentational
 * QmDashboardView are mocked so we exercise the page's wiring: role copy,
 * bug-report loading, and the admin AI models cell.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useDisplayCourses: vi.fn(),
  useQuestionStats: vi.fn(),
  useAllQuestions: vi.fn(),
  useAllAssessments: vi.fn(),
  useQmPermissions: vi.fn(),
  useAiServicesStatus: vi.fn(),
  useCanvasLinks: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.useAuth() }));
vi.mock("@/hooks/useDisplayCourses", () => ({
  useDisplayCourses: () => mocks.useDisplayCourses(),
}));
vi.mock("@/hooks/useQuestionStats", () => ({ useQuestionStats: () => mocks.useQuestionStats() }));
vi.mock("@/hooks/useAllQuestions", () => ({ useAllQuestions: () => mocks.useAllQuestions() }));
vi.mock("@/hooks/useAllAssessments", () => ({
  useAllAssessments: () => mocks.useAllAssessments(),
}));
vi.mock("@/hooks/useQmPermissions", () => ({ useQmPermissions: () => mocks.useQmPermissions() }));
vi.mock("@/hooks/useAiServicesStatus", () => ({
  useAiServicesStatus: () => mocks.useAiServicesStatus(),
}));
vi.mock("@/hooks/useCanvasLinks", () => ({
  useCanvasLinks: (...args: number[][]) => mocks.useCanvasLinks(...args),
}));
vi.mock("@/services/bugReportApi", () => ({ bugReportApi: { list: mocks.list } }));

let lastProps: any;
vi.mock("@/components/dashboard/QmDashboardView", () => ({
  QmDashboardView: (props: any) => {
    lastProps = props;
    return <div>dashboard-view</div>;
  },
}));

import DashboardPage from "@/pages/DashboardPage";

const course = (id: number, accessLevel = "instructor") => ({
  id,
  code: `C${id}`,
  name: `Course ${id}`,
  accessLevel,
});

function setup(
  o: {
    user?: any;
    courses?: any[];
    questionsError?: string;
    canTriage?: boolean;
    coursesLoading?: boolean;
    assessmentsError?: string;
  } = {},
) {
  mocks.useAuth.mockReturnValue({
    user: o.user ?? { name: "Jane Doe", role: "INSTRUCTOR", questionMakerRole: "INSTRUCTOR" },
  });
  mocks.useDisplayCourses.mockReturnValue({
    displayCourses: o.courses ?? [course(1)],
    isLoading: o.coursesLoading ?? false,
  });
  mocks.useQuestionStats.mockReturnValue({ stats: { totalQuestions: 10 } });
  mocks.useAllQuestions.mockReturnValue({
    questions: [{ id: 1, courseId: 1, variants: [{ isDraft: true }] }],
    isLoading: false,
    error: o.questionsError ?? null,
  });
  mocks.useAllAssessments.mockReturnValue({
    assessments: [],
    isLoading: false,
    error: o.assessmentsError ?? null,
  });
  mocks.useQmPermissions.mockReturnValue({
    canTriageBugReports: o.canTriage ?? false,
    canManageCanvas: false,
  });
  mocks.useAiServicesStatus.mockReturnValue({
    ubc: { state: "operational" },
    cloud: { state: "outage" },
  });
  mocks.useCanvasLinks.mockReturnValue(new Set());
}

beforeEach(() => {
  mocks.list.mockReset();
  mocks.list.mockResolvedValue([{ status: "unhandled" }, { status: "resolved" }]);
});
afterEach(cleanup);

describe("DashboardPage", () => {
  it("ADMIN: loads bug reports once and shows the AI models cell", async () => {
    setup({
      user: { name: "Jane Doe", role: "ADMIN", questionMakerRole: "ADMIN" },
      canTriage: true,
    });
    render(<DashboardPage />);
    expect(lastProps.heading).toBe("Welcome back, Jane.");
    expect(lastProps.subheading).toMatch(/platform/);
    await waitFor(() =>
      expect(lastProps.attentionRows.some((r: any) => /unhandled bug report/.test(r.text))).toBe(
        true,
      ),
    );
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith({ source: "QUESTION_MAKER" });
    const cell = lastProps.stats.find((s: any) => s.label === "AI models");
    render(<div>{cell.value}</div>);
    expect(screen.getByText("UBC OK")).toBeTruthy();
    expect(screen.getByText("CLOUD FAILED")).toBeTruthy();
  });

  it("UNIT_ADMIN: no bug call, two sections", () => {
    setup({
      user: { name: "Jane", role: "UNIT_ADMIN", questionMakerRole: "UNIT_ADMIN" },
      courses: [course(1), course(2, "unit")],
    });
    render(<DashboardPage />);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(lastProps.sections).toHaveLength(2);
  });

  it("INSTRUCTOR and TA get the instructor copy", () => {
    setup();
    render(<DashboardPage />);
    expect(lastProps.subheading).toBe("Your courses and question writing.");
    setup({ user: { name: "Tia", role: "STUDENT", questionMakerRole: "TA" } });
    render(<DashboardPage />);
    expect(lastProps.subheading).toBe("Your courses and question writing.");
  });

  it("a rejected bug list hides the bug row and the page still renders", async () => {
    mocks.list.mockRejectedValue(new Error("boom"));
    setup({ user: { name: "Jane", role: "ADMIN", questionMakerRole: "ADMIN" }, canTriage: true });
    render(<DashboardPage />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(screen.getByText("dashboard-view")).toBeTruthy();
    expect(lastProps.attentionRows.some((r: any) => /bug report/.test(r.text))).toBe(false);
  });

  it("a questions error hides the drafts row", () => {
    setup();
    render(<DashboardPage />);
    expect(lastProps.attentionRows.some((r: any) => /waiting for review/.test(r.text))).toBe(true);
    cleanup();
    setup({ questionsError: "cap" });
    render(<DashboardPage />);
    expect(lastProps.attentionRows.some((r: any) => /waiting for review/.test(r.text))).toBe(false);
  });

  it("keeps the side column loading while courses load", () => {
    setup({ coursesLoading: true });
    render(<DashboardPage />);
    expect(lastProps.sideLoading).toBe(true);
  });

  it("shows a dash for Assessments when the assessments fetch failed", () => {
    setup({ assessmentsError: "boom" });
    render(<DashboardPage />);
    expect(lastProps.stats.find((s: any) => s.label === "Assessments").value).toBe("—");
  });
});
