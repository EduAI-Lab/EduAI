/**
 * AI Tutor's ADMIN dashboard (Core's admin layout, AI Tutor data): headline
 * numbers, "Needs your attention" with Core's unhandled bug reports first and
 * badges coloured by severity (0 is success), AI tutor health badges, recent
 * tutor replies, the courses preview with its #1208 notice, the inline admin
 * checklist, and the cards that degrade when a call failed.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@eduai/ui/weekly-usage-chart", () => ({
  default: ({ data, seriesLabel }: { data: unknown[]; seriesLabel: string }) => (
    <div data-testid="usage-chart">
      {seriesLabel}: {data.length}
    </div>
  ),
}));

import { AdminDashboard, type AdminDashboardProps } from "~/components/dashboard/AdminDashboard";
import type { AdminDashboardData } from "~/lib/api-schemas";
import type { Course } from "~/lib/types";

const DATA: AdminDashboardData = {
  content: { activities: 42 },
  tutoring: { sessions: 120, sessionsThisWeek: 9, learnersThisWeek: 1 },
  submissions: { total: 300, toReview: 12 },
  ratings: { average: 3.9, count: 25 },
  attention: [
    {
      id: "failed-replies",
      title: "Tutor replies that failed",
      description: "2 replies errored or fell back in the last 7 days.",
      count: 2,
      severity: "destructive",
      href: "/admin?tab=ai-oversight",
    },
    {
      id: "low-rated-activities",
      title: "Low-rated activities",
      description: "No activity averages below 2.5 stars.",
      count: 0,
      severity: "warning",
      href: "/instructor",
    },
    {
      id: "submissions-to-review",
      title: "Submissions waiting to be graded",
      description: "12 submissions are waiting for a grade.",
      count: 12,
      severity: "warning",
      href: "/instructor",
    },
  ],
  health: [
    { id: "eduai-api-key", name: "EduAI API key", status: "ok", detail: "From the environment" },
    {
      id: "model-catalog",
      name: "Model catalog (Core)",
      status: "failed",
      detail: "AI model catalog unavailable",
    },
    { id: "reviewer-model", name: "Reviewer model", status: "not-set", detail: "Review is off" },
  ],
  weeklySessions: [
    { weekStart: "2026-10-26", count: 3 },
    { weekStart: "2026-11-02", count: 5 },
  ],
};

const COURSES = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  title: `Course ${i + 1}`,
  code: `CRS ${100 + i}`,
  isPublished: true,
})) as unknown as Course[];

function renderDashboard(props: Partial<AdminDashboardProps> = {}) {
  return render(
    <MemoryRouter>
      <AdminDashboard
        userId="admin-1"
        courses={COURSES}
        courseTotal={30}
        dashboardStats={{
          totalCourses: 30,
          publishedCourses: 21,
          draftCourses: 9,
          openBugReports: 4,
        }}
        data={DATA}
        recentTraces={[
          {
            id: 7,
            finalOutcome: "safe_fallback",
            createdAt: new Date().toISOString(),
            user: { id: "s1", name: "Devon Singh" },
            activity: { id: 3, title: "Limits quiz" },
            courseTitle: "MATH 100",
          },
        ]}
        {...props}
      />
    </MemoryRouter>,
  );
}

function rowFor(title: string) {
  return screen.getByText(title).closest("li") as HTMLElement;
}

const badgeIn = (row: HTMLElement) => within(row).getByText(/^\d+$/).closest("[data-slot='badge']");

beforeEach(() => {
  window.localStorage.clear();
});

describe("AI Tutor AdminDashboard", () => {
  it("shows course totals and the content & tutoring numbers, with no user counts", () => {
    renderDashboard();
    expect(screen.getByText("21 published · 9 unpublished")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("9 this week · 1 learner")).toBeInTheDocument();
    expect(screen.getByText("12 to grade")).toBeInTheDocument();
    expect(screen.getByText("3.9")).toBeInTheDocument();
    expect(screen.queryByText(/Users by role|Platform users/)).not.toBeInTheDocument();
  });

  it("puts Core's unhandled bug reports first and colours badges by severity", () => {
    renderDashboard();
    const list = rowFor("Unhandled bug reports").parentElement as HTMLElement;
    expect(list.firstElementChild).toBe(rowFor("Unhandled bug reports"));

    expect(badgeIn(rowFor("Unhandled bug reports"))?.className).toContain("color-error");
    expect(badgeIn(rowFor("Low-rated activities"))?.className).toContain("color-success");
    expect(badgeIn(rowFor("Submissions waiting to be graded"))?.className).toContain(
      "color-warning",
    );
    expect(within(rowFor("Unhandled bug reports")).getByRole("link")).toHaveAttribute(
      "href",
      "/admin?tab=bug-reports",
    );
  });

  it("shows a status badge per AI tutor health row and links to AI settings", () => {
    renderDashboard();
    const badge = (name: string, label: string) =>
      within(rowFor(name)).getByText(label, { selector: "[data-slot='badge']" });
    expect(badge("EduAI API key", "OK")).toBeInTheDocument();
    expect(badge("Model catalog (Core)", "Failed")).toBeInTheDocument();
    expect(badge("Reviewer model", "Not set")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View AI settings/ })).toHaveAttribute(
      "href",
      "/admin?tab=ai-settings",
    );
  });

  it("charts tutoring sessions per week", async () => {
    renderDashboard();
    expect(await screen.findByTestId("usage-chart")).toHaveTextContent("Tutoring sessions: 2");
  });

  it("lists recent tutor replies with their outcome and links to AI oversight", () => {
    renderDashboard();
    const row = rowFor("Limits quiz");
    expect(within(row).getByText(/MATH 100/)).toBeInTheDocument();
    expect(within(row).getByText("Devon Singh")).toBeInTheDocument();
    expect(within(row).getByText("Safe fallback")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All interactions/ })).toHaveAttribute(
      "href",
      "/admin?tab=ai-oversight",
    );
  });

  it("previews four courses and says the list is longer", () => {
    renderDashboard();
    expect(screen.getByText("CRS 103")).toBeInTheDocument();
    expect(screen.queryByText("CRS 104")).not.toBeInTheDocument();
    expect(screen.getByText(/4 of 30/)).toBeInTheDocument();
  });

  it("puts the admin Getting started checklist inline", () => {
    renderDashboard();
    for (const label of [
      "Check the EduAI API key",
      "Review tutor and reviewer models",
      "Look at AI oversight",
      "Triage bug reports",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Close getting started" })).toBeNull();
  });

  it("degrades card by card when the AI Tutor rollup or traces could not load", () => {
    renderDashboard({ data: null, recentTraces: null });
    expect(screen.getAllByText("Couldn't load this right now.")).toHaveLength(5);
    expect(screen.getByText("21 published · 9 unpublished")).toBeInTheDocument();
  });
});
