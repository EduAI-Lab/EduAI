/**
 * Unit tests for `QmAdminDashboard`: the ADMIN "Question Maker overview" —
 * heading, the attention and health rows, content and course stats, the
 * two-line usage chart, recent activity, and the failed-load state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const { getMock, chartProps } = vi.hoisted(() => ({
  getMock: vi.fn(),
  chartProps: { current: null as any },
}));

vi.mock("@/services/adminDashboardService", () => ({
  adminDashboardService: { get: () => getMock() },
}));

vi.mock("@eduai/ui/weekly-usage-chart", () => ({
  default: (props: any) => {
    chartProps.current = props;
    return <div>usage-chart</div>;
  },
}));

import { QmAdminDashboard } from "@/components/dashboard/QmAdminDashboard";
import type { AdminDashboardData } from "@/services/adminDashboardService";

const DATA: AdminDashboardData = {
  content: { questions: 40, versions: 120, drafts: 30, reviewed: 90, aiGenerated: 60, shared: 12 },
  courses: { total: 9, withQuestions: 6, canvasLinked: 4 },
  assessments: {
    total: 9,
    byType: [
      { type: "Quiz", count: 7 },
      { type: "Lab", count: 0 },
      { type: "Final", count: 2 },
    ],
  },
  attention: [
    {
      id: "open-bug-reports",
      title: "Unhandled bug reports",
      description: "2 reports need triage.",
      count: 2,
      severity: "destructive",
      href: "/admin/bug-reports",
    },
    {
      id: "stale-ai-drafts",
      title: "AI drafts waiting for review",
      description: "No AI draft is older than 14 days.",
      count: 0,
      severity: "warning",
      href: "/library",
    },
  ],
  health: [
    { id: "ubc-ai", name: "UBC-hosted AI", status: "degraded", detail: "Slow" },
    { id: "generation-model", name: "Generation model", status: "ok", detail: "Qwen 9B" },
  ],
  weeklyVersions: [{ weekStart: "2026-11-09", ai: 4, manual: 2 }],
  recentActivity: [
    {
      id: "question-1",
      kind: "question",
      label: "Define entropy",
      href: "/courses/3?tab=questions",
      by: "Ada",
      updatedAt: new Date().toISOString(),
    },
  ],
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <QmAdminDashboard userId="admin-1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  chartProps.current = null;
  localStorage.clear();
});
afterEach(cleanup);

describe("QmAdminDashboard", () => {
  it("names the platform in the heading", async () => {
    getMock.mockResolvedValue(DATA);
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Question Maker overview" })).toBeInTheDocument();
    await screen.findByText("Unhandled bug reports");
  });

  it("lists attention items as links with their counts", async () => {
    getMock.mockResolvedValue(DATA);
    renderDashboard();
    const link = await screen.findByRole("link", { name: /Unhandled bug reports/ });
    expect(link).toHaveAttribute("href", "/admin/bug-reports");
    expect(within(link).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("No AI draft is older than 14 days.")).toBeInTheDocument();
  });

  it("shows each health row with its status", async () => {
    getMock.mockResolvedValue(DATA);
    renderDashboard();
    expect(await screen.findByText("UBC-hosted AI")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("Qwen 9B")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("shows content and course numbers", async () => {
    getMock.mockResolvedValue(DATA);
    renderDashboard();
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.getByText("60 of 120 versions")).toBeInTheDocument();
    expect(screen.getByText("90 reviewed · 30 drafts")).toBeInTheDocument();
    expect(screen.getByText("6 with questions")).toBeInTheDocument();
    expect(screen.getByText("of 9 courses")).toBeInTheDocument();
    // Types with no assessments are left out.
    expect(screen.getByText("7 Quiz · 2 Final")).toBeInTheDocument();
  });

  it("charts AI-generated and hand-written versions as two lines", async () => {
    getMock.mockResolvedValue(DATA);
    renderDashboard();
    await screen.findByText("usage-chart");
    expect(chartProps.current.data).toEqual(DATA.weeklyVersions);
    expect(chartProps.current.series.map((s: any) => s.key)).toEqual(["ai", "manual"]);
  });

  it("links recent activity to where it was edited, with its author", async () => {
    getMock.mockResolvedValue(DATA);
    renderDashboard();
    const link = await screen.findByRole("link", { name: /Define entropy/ });
    expect(link).toHaveAttribute("href", "/courses/3?tab=questions");
    expect(within(link).getByText("Question · Ada")).toBeInTheDocument();
  });

  it("includes the admin Getting started checklist", async () => {
    getMock.mockResolvedValue(DATA);
    renderDashboard();
    expect(await screen.findByText("Triage bug reports")).toBeInTheDocument();
  });

  it("says the cards couldn't load when the request fails, keeping the page", async () => {
    getMock.mockRejectedValue(new Error("502"));
    renderDashboard();
    const notices = await screen.findAllByText("Couldn't load this right now.");
    expect(notices).toHaveLength(6);
    expect(screen.getByRole("heading", { name: "Question Maker overview" })).toBeInTheDocument();
  });
});
