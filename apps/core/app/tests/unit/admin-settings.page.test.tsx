/**
 * The admin Settings page's tabs: General (the General policy card and the
 * help assistant), AI & limits (daily caps, Bedrock overflow) and Roles (Instructors,
 * Teaching Assistants, Unit Admins, in that order), with the selected tab kept
 * in `?tab=` and General as the default.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

vi.mock("~/components/layout/core-app-shell", () => ({
  CoreAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("~/components/settings/chat-daily-limit-settings", () => ({
  ChatDailyLimitSettingsCard: () => <section aria-label="Local chatbot daily caps" />,
}));
vi.mock("~/components/settings/assistant-settings-cards", () => ({
  AssistantToggleCard: () => <section aria-label="Help assistant" />,
}));
vi.mock("~/components/settings/bedrock-overflow-settings", () => ({
  BedrockOverflowSettingsCard: () => <section aria-label="AWS Bedrock overflow" />,
}));
vi.mock("~/hooks/api/use-policies", () => ({
  usePolicies: () => ({
    policies: {},
    isLoading: false,
    error: null,
    setPolicy: vi.fn(),
    definitions: [
      {
        key: "chat.webToolsEnabled",
        label: "Web search tools enabled",
        description: "",
        default: true,
      },
      {
        key: "auth.allowPublicRegistration",
        label: "Allow public registration",
        description: "",
        default: false,
      },
      {
        key: "unitAdmins.canInvite",
        label: "Unit admins can invite",
        description: "",
        default: false,
      },
      {
        key: "instructors.canCreateCourses",
        label: "Instructors can create courses",
        description: "",
        default: true,
      },
      {
        key: "tas.canManageMaterials",
        label: "TAs can manage materials",
        description: "",
        default: false,
      },
    ],
  }),
}));
vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession: vi.fn() }));
vi.mock("~/lib/not-found.server", () => ({ notFound: vi.fn() }));

import AdminSettingsPage from "~/routes/admin.settings";

function renderPage(path = "/admin/settings") {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/settings",
        element: <AdminSettingsPage />,
        loader: () => ({
          user: { id: "admin-1", role: "ADMIN", name: "Admin", email: "admin@eduai.test" },
          environmentHealth: { missingKeys: [] },
          chatDailyLimits: { studentLimit: 50, instructorLimit: 200 },
          bedrockSettings: {},
          bedrockTokenConfigured: false,
          assistantSettings: {},
        }),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const cardTitles = () =>
  Array.from(document.querySelectorAll("[data-slot='card-title']")).map((el) => el.textContent);

describe("Admin Settings — tabs", () => {
  it("opens on General, showing the General card and the help assistant", async () => {
    renderPage();
    expect(await screen.findByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(cardTitles()).toEqual(["General"]);
    expect(screen.getByText("Web search tools enabled")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Help assistant" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Local chatbot daily caps")).not.toBeInTheDocument();
  });

  it("falls back to General for an unknown tab", async () => {
    renderPage("/admin/settings?tab=nope");
    expect(await screen.findByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows the AI & limits cards in order on ?tab=ai", async () => {
    renderPage("/admin/settings?tab=ai");
    await screen.findByRole("tab", { name: "AI & limits" });
    const sections = screen.getAllByRole("region").map((el) => el.getAttribute("aria-label"));
    expect(sections).toEqual(["Local chatbot daily caps", "AWS Bedrock overflow"]);
    expect(cardTitles()).toEqual([]);
  });

  it("shows Instructors, Teaching Assistants and Unit Admins in that order on ?tab=roles", async () => {
    renderPage("/admin/settings?tab=roles");
    await screen.findByRole("tab", { name: "Roles" });
    expect(cardTitles()).toEqual(["Instructors", "Teaching Assistants", "Unit Admins"]);
  });

  it("puts the selected tab in the URL", async () => {
    const router = renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Roles" }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=roles"));
    expect(cardTitles()).toEqual(["Instructors", "Teaching Assistants", "Unit Admins"]);
  });
});
