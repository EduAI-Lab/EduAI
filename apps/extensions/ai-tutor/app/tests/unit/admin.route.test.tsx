/**
 * Coverage for admin.tsx: the ADMIN-only fetch gating in clientLoader (bug
 * reports + AI settings hit ADMIN-only server routes, so UNIT_ADMIN must not
 * request them), and the tab set/content rendered per role.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/admin";

const mockRequireClientUser = vi.fn();
vi.mock("~/lib/client-auth", () => ({
  requireClientUser: (...args: unknown[]) => mockRequireClientUser(...args),
}));

const mockListAdminBugReports = vi.fn();
const mockAdminAiTraces = vi.fn();
vi.mock("~/lib/api", () => ({
  default: {
    listAdminBugReports: (...args: unknown[]) => mockListAdminBugReports(...args),
    adminAiTraces: (...args: unknown[]) => mockAdminAiTraces(...args),
  },
}));

const mockLoadAdminSettingsData = vi.fn();
vi.mock("~/lib/admin-settings", () => ({
  loadAdminSettingsData: (...args: unknown[]) => mockLoadAdminSettingsData(...args),
  getApiKeySourceTag: (status: { configured: boolean; source?: string }) => {
    if (!status.configured) return null;
    if (status.source === "ADMIN") return { label: "Admin override" };
    return { label: "From .env" };
  },
}));

vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));

// Real Radix-backed PageTabs needs pointer capture jsdom doesn't implement;
// reduce it to plain state so a click reliably switches the active panel
// (same pattern used by CourseDetailPage.test.tsx in question-maker).

vi.mock("~/components/admin/BugReportsTab", () => ({
  default: ({ initialReports }: { initialReports: unknown[] }) => (
    <div data-testid="bug-reports-tab">{initialReports.length} reports</div>
  ),
}));
vi.mock("~/components/admin/AdminSettingsPanel", () => ({
  AdminSettingsPanel: () => <div data-testid="admin-settings-panel" />,
}));
vi.mock("~/components/admin/AiOversightPanel", () => ({
  AiOversightPanel: ({ initialTraces }: { initialTraces: unknown[] }) => (
    <div data-testid="ai-oversight-panel">{initialTraces.length} traces</div>
  ),
}));

import AdminHome, { clientLoader, shouldRevalidate } from "~/routes/admin";

describe("admin route — clientLoader ADMIN-only gating", () => {
  beforeEach(() => {
    mockListAdminBugReports.mockReset().mockResolvedValue([{ id: 1 }]);
    mockAdminAiTraces.mockReset().mockResolvedValue([{ id: "trace-1" }]);
    mockLoadAdminSettingsData.mockReset().mockResolvedValue({
      status: { configured: true, source: "ADMIN" },
      aiPolicy: null,
      aiModels: [],
      aiPolicyAvailable: true,
      aiPolicyError: null,
    });
  });

  it("verifies ADMIN role and fetches all admin data", async () => {
    mockRequireClientUser.mockResolvedValue({ id: "u1", role: "ADMIN" });

    const result = await clientLoader({} as unknown as Route.ClientLoaderArgs);

    expect(mockRequireClientUser).toHaveBeenCalledWith(["ADMIN"]);
    expect(mockListAdminBugReports).toHaveBeenCalled();
    expect(mockLoadAdminSettingsData).toHaveBeenCalled();
    expect(mockAdminAiTraces).toHaveBeenCalledWith({ limit: 50 });
    expect(result.bugReports).toEqual([{ id: 1 }]);
    expect(result.aiTraces).toEqual([{ id: "trace-1" }]);
  });

  it("rejects when user is not an ADMIN", async () => {
    mockRequireClientUser.mockRejectedValue(new Response("Not Found", { status: 404 }));

    await expect(clientLoader({} as unknown as Route.ClientLoaderArgs)).rejects.toThrow();
  });
});

function wrap(overrides: Partial<Route.ComponentProps["loaderData"]> = {}, path = "/admin") {
  const props = {
    loaderData: {
      adminSettings: {
        status: { configured: true, source: "ADMIN" },
        aiPolicy: null,
        aiModels: [],
        aiPolicyAvailable: true,
        aiPolicyError: null,
      },
      bugReports: [{ id: 1 }],
      aiTraces: [{ id: "trace-1" }],
      ...overrides,
    },
  } as unknown as Route.ComponentProps;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminHome {...props} />
    </MemoryRouter>,
  );
}

describe("admin route — rendering", () => {
  it("opens on Bug reports, with no tab set (sections live in the shell's Administration menu)", () => {
    wrap();

    expect(screen.getByRole("heading", { name: "Bug reports" })).toBeInTheDocument();
    expect(screen.getByTestId("bug-reports-tab")).toHaveTextContent("1 reports");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-settings-panel")).not.toBeInTheDocument();
  });

  it("falls back to Bug reports for an unknown ?tab=", () => {
    wrap({}, "/admin?tab=nope");
    expect(screen.getByRole("heading", { name: "Bug reports" })).toBeInTheDocument();
  });

  it("?tab=ai-settings renders the settings panel and source badge", () => {
    wrap({}, "/admin?tab=ai-settings");

    expect(screen.getByRole("heading", { name: "AI settings" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-settings-panel")).toBeInTheDocument();
    expect(screen.getByText("Admin override")).toBeInTheDocument();
    expect(screen.queryByTestId("bug-reports-tab")).not.toBeInTheDocument();
  });

  it("?tab=ai-oversight renders the oversight panel", () => {
    wrap({}, "/admin?tab=ai-oversight");

    expect(screen.getByRole("heading", { name: "AI oversight" })).toBeInTheDocument();
    expect(screen.getByTestId("ai-oversight-panel")).toHaveTextContent("1 traces");
  });

  it("hides the AI settings content when the key status is not configured (no source tag)", () => {
    wrap(
      {
        adminSettings: {
          status: {
            configured: false,
            source: "NONE",
            hasAdminOverride: false,
            envConfigured: false,
            updatedAt: null,
          },
          aiPolicy: null,
          aiModels: [],
          aiPolicyAvailable: true,
          aiPolicyError: null,
        },
      },
      "/admin?tab=ai-settings",
    );

    expect(screen.queryByTestId("admin-settings-panel")).not.toBeInTheDocument();
  });

  it('shows a "From .env" badge for an ENV-sourced key', () => {
    wrap(
      {
        adminSettings: {
          status: {
            configured: true,
            source: "ENV",
            hasAdminOverride: false,
            envConfigured: true,
            updatedAt: null,
          },
          aiPolicy: null,
          aiModels: [],
          aiPolicyAvailable: true,
          aiPolicyError: null,
        },
      },
      "/admin?tab=ai-settings",
    );

    expect(screen.getByText("From .env")).toBeInTheDocument();
  });
});

describe("admin route — shouldRevalidate", () => {
  const args = (from: string, to: string, formMethod?: string) =>
    ({
      currentUrl: new URL(`http://x${from}`),
      nextUrl: new URL(`http://x${to}`),
      formMethod,
      defaultShouldRevalidate: true,
    }) as Parameters<typeof shouldRevalidate>[0];

  it("skips the reload when only the section changes", () => {
    expect(shouldRevalidate(args("/admin", "/admin?tab=ai-oversight"))).toBe(false);
  });

  it("reloads after a form submission or a move to another page", () => {
    expect(shouldRevalidate(args("/admin", "/admin?tab=ai-settings", "POST"))).toBe(true);
    expect(shouldRevalidate(args("/dashboard", "/admin"))).toBe(true);
  });
});
