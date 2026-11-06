/**
 * The ADMIN dashboard's cards: badge severity in Needs your attention (0 is
 * success), System health status badges, card links, audit entries in plain
 * words, and the inline Getting started checklist with the admin tasks.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

vi.mock("@eduai/ui/weekly-usage-chart", () => ({
  default: ({ data }: { data: unknown[] }) => <div data-testid="usage-chart">{data.length}</div>,
}));

import { AdminDashboard } from "~/components/dashboard/admin-dashboard";
import type { AdminDashboardData } from "~/types/admin-dashboard";

const DATA: AdminDashboardData = {
  users: { total: 16, byRole: { students: 8, instructors: 5, admins: 1, other: 2 } },
  courses: { total: 16, published: 12 },
  materials: { total: 25, ready: 25 },
  aiSessions: { total: 9, thisWeek: 0 },
  attention: [
    {
      id: "unit-admins-without-units",
      title: "Unit Admins with no units",
      description: "They cannot view or create courses.",
      count: 1,
      severity: "destructive",
      href: "/admin/users",
    },
    {
      id: "failed-materials",
      title: "Failed materials",
      description: "No materials failed to process.",
      count: 0,
      severity: "destructive",
      href: "/courses",
    },
    {
      id: "pending-invitations",
      title: "Pending invitations",
      description: "Oldest invitation sent 5 days ago.",
      count: 3,
      severity: "warning",
      href: "/admin/invitations",
    },
  ],
  health: [
    {
      id: "cron:backup-nightly",
      kind: "cron",
      name: "Nightly backup",
      status: "failed",
      detail: null,
      lastRunAt: new Date(Date.now() - 8 * 3_600_000).toISOString(),
    },
    {
      id: "ai:cloud",
      kind: "ai",
      name: "Cloud API",
      status: "not-set",
      detail: "No provider key set",
      lastRunAt: null,
    },
  ],
  weeklyChats: [
    { weekStart: "2026-10-26", count: 3 },
    { weekStart: "2026-11-02", count: 5 },
  ],
  courseList: [
    {
      id: "c1",
      code: "COSC 121",
      name: "Data Structures",
      term: "W1",
      year: 2026,
      isPublished: true,
      callerEnrollmentRole: null,
    },
  ],
  recentActivity: [
    {
      id: "a1",
      actionCode: "USER_ROLE_CHANGED",
      entityLabel: "Brooke Kim",
      actorName: "Alex Morgan",
      createdAt: new Date().toISOString(),
    },
  ],
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AdminDashboard data={DATA} userId="admin-1" />
    </MemoryRouter>,
  );
}

function rowFor(title: string) {
  return screen.getByText(title).closest("li") as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("AdminDashboard", () => {
  it("shows the user total, the role breakdown and the platform counts", () => {
    renderDashboard();
    expect(screen.getByText("8 students · 5 instructors · 1 admin · 2 other")).toBeInTheDocument();
    expect(screen.getByText("12 published")).toBeInTheDocument();
    expect(screen.getByText("25 ready")).toBeInTheDocument();
    expect(screen.getByText("0 this week")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage users/ })).toHaveAttribute(
      "href",
      "/admin/users",
    );
  });

  it("colours attention badges by severity, with 0 always success", () => {
    renderDashboard();
    const badge = (title: string) =>
      within(rowFor(title)).getByText(/^\d+$/).closest("[data-slot='badge']");

    expect(badge("Unit Admins with no units")?.className).toContain("color-error");
    expect(badge("Failed materials")?.className).toContain("color-success");
    expect(badge("Pending invitations")?.className).toContain("color-warning");
    expect(within(rowFor("Pending invitations")).getByRole("link")).toHaveAttribute(
      "href",
      "/admin/invitations",
    );
  });

  it("shows a status badge and last-run line for each health row", () => {
    renderDashboard();
    expect(
      within(rowFor("Nightly backup")).getByText("Failed", { selector: "[data-slot='badge']" }),
    ).toBeInTheDocument();
    expect(within(rowFor("Nightly backup")).getByText(/8h ago/)).toBeInTheDocument();
    expect(
      within(rowFor("Cloud API")).getByText("Not set", { selector: "[data-slot='badge']" }),
    ).toBeInTheDocument();
    expect(within(rowFor("Cloud API")).getByText("No provider key set")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View cron jobs/ })).toHaveAttribute(
      "href",
      "/admin/cron-jobs",
    );
  });

  it("renders the courses with a View all link to the Courses page", () => {
    renderDashboard();
    expect(screen.getByText("COSC 121")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View all/ })).toHaveAttribute("href", "/courses");
  });

  it("describes audit entries in plain words with the actor", () => {
    renderDashboard();
    expect(screen.getByText("Role changed")).toBeInTheDocument();
    expect(screen.getByText(/Brooke Kim/)).toBeInTheDocument();
    expect(screen.getByText("Alex Morgan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All logs/ })).toHaveAttribute("href", "/admin/logs");
  });

  it("renders the weekly usage chart once mounted", async () => {
    renderDashboard();
    expect(await screen.findByTestId("usage-chart")).toHaveTextContent("2");
  });

  it("puts the admin Getting started checklist inline, collapsible but not closable", () => {
    renderDashboard();
    for (const label of [
      "Invite a user",
      "Review user roles",
      "Check AI models",
      "Review bug reports",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close getting started" })).toBeNull();
  });
});
