import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router";

import { GlobalNavRail, NavLinkProvider, type NavTrayKey } from "@eduai/ui";
import { useCoreNavModel } from "~/components/layout/core-nav-model";
import { PolicyProvider, type PolicyValues } from "~/components/policy/policy-gate";
import type { User } from "~/lib/auth/types";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [{ id: "c1", code: "BIOL 116", name: "Intro Biology", term: "W1", year: 2026 }],
        }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** The shell's wiring of the rail, reduced to the state the rail itself needs. */
function RailHarness({ user, onReportBug }: { user: User; onReportBug: () => void }) {
  const model = useCoreNavModel(user, onReportBug);
  const [collapsed, setCollapsed] = React.useState(false);
  const [openTray, setOpenTray] = React.useState<NavTrayKey | null>(null);
  return (
    <NavLinkProvider LinkComponent={Link}>
      <GlobalNavRail
        model={model}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        iconOnly={collapsed}
        openTray={openTray}
        onOpenTrayChange={setOpenTray}
        onReportBug={model.onReportBug}
      />
    </NavLinkProvider>
  );
}

function renderRail(
  role: string,
  { policies = {}, path = "/dashboard" }: { policies?: PolicyValues; path?: string } = {},
) {
  const user = {
    id: "user-1",
    name: "Test User",
    email: "test@eduai.test",
    role,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;
  const onReportBug = vi.fn();
  // A data router so useCoreNavModel's useRouteLoaderData resolves. There is no
  // "root" route, so it falls back to the SSR-seeded policy gate.
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <PolicyProvider policies={policies}>
            <RailHarness user={user} onReportBug={onReportBug} />
          </PolicyProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return { onReportBug, rail: screen.getByRole("navigation", { name: "Global" }) };
}

/** Each rail entry's visible label, ignoring the decorative (aria-hidden) avatar initials. */
function railLabels(rail: HTMLElement): string[] {
  return within(rail)
    .getAllByRole("listitem")
    .map((item) => {
      const copy = item.cloneNode(true) as HTMLElement;
      for (const hidden of copy.querySelectorAll("[aria-hidden='true']")) hidden.remove();
      return copy.textContent?.trim() ?? "";
    });
}

describe("GlobalNavRail — entries", () => {
  it("lists the student's entries in Canvas order, with no Administration", () => {
    const { rail } = renderRail("STUDENT");
    expect(railLabels(rail)).toEqual(["Account", "Dashboard", "Courses", "Course Chat", "Help"]);
  });

  it("adds Administration and Admin Chatbot for ADMIN, in order", () => {
    const { rail } = renderRail("ADMIN");
    expect(railLabels(rail)).toEqual([
      "Account",
      "Dashboard",
      "Courses",
      "Administration",
      "Course Chat",
      "Admin Chatbot",
      "Help",
    ]);
  });

  it.each(["INSTRUCTOR", "TA", "UNIT_ADMIN"])("shows no Administration entry for %s", (role) => {
    renderRail(role);
    expect(screen.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("marks the current page's link with aria-current", () => {
    renderRail("STUDENT", { path: "/dashboard" });
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Course Chat" })).not.toHaveAttribute("aria-current");
  });

  it("shows the UNIT_ADMIN Invitations entry as a link when unitAdmins.canInvite is on", () => {
    renderRail("UNIT_ADMIN", { policies: { "unitAdmins.canInvite": true } });
    expect(screen.getByRole("link", { name: "Invitations" })).toHaveAttribute(
      "href",
      "/unit-admin/invitations",
    );
  });

  it("greys out the UNIT_ADMIN Invitations entry when the flag is off (#807)", () => {
    renderRail("UNIT_ADMIN", { policies: { "unitAdmins.canInvite": false } });
    const entry = screen.getByRole("link", { name: "Invitations" });
    expect(entry).toHaveAttribute("aria-disabled", "true");
    expect(entry).not.toHaveAttribute("href");
  });
});

describe("GlobalNavRail — trays", () => {
  it("opens the Administration tray with the admin links and focuses into it", async () => {
    renderRail("ADMIN");
    const trigger = screen.getByRole("button", { name: "Administration" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    const tray = await screen.findByRole("dialog", { name: "Administration" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    for (const name of ["User Management", "AI Management", "Bug Reports", "Cron Jobs"]) {
      expect(within(tray).getByRole("link", { name })).toBeInTheDocument();
    }
    await waitFor(() => expect(tray.contains(document.activeElement)).toBe(true));
  });

  it("closes on Escape and hands focus back to its trigger", async () => {
    renderRail("ADMIN");
    const trigger = screen.getByRole("button", { name: "Administration" });
    fireEvent.click(trigger);
    const tray = await screen.findByRole("dialog", { name: "Administration" });

    fireEvent.keyDown(tray, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Administration" })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes from its X button", async () => {
    renderRail("STUDENT");
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const tray = await screen.findByRole("dialog", { name: "Help" });
    fireEvent.click(within(tray).getByRole("button", { name: "Close Help menu" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("lists the user's courses plus All courses in the Courses tray", async () => {
    renderRail("STUDENT");
    fireEvent.click(screen.getByRole("button", { name: "Courses" }));
    const tray = await screen.findByRole("dialog", { name: "Courses" });

    const course = await within(tray).findByRole("link", { name: /BIOL 116/ });
    expect(course).toHaveAttribute("href", "/courses/c1");
    expect(course).toHaveTextContent("Intro Biology · 2026-27W1");
    expect(within(tray).getByRole("link", { name: "All courses" })).toHaveAttribute(
      "href",
      "/courses",
    );
  });

  it("offers Help & guide and Report a bug in the Help tray", async () => {
    const { onReportBug } = renderRail("STUDENT");
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const tray = await screen.findByRole("dialog", { name: "Help" });

    expect(within(tray).getByRole("link", { name: "Help & guide" })).toHaveAttribute(
      "href",
      "/help",
    );
    fireEvent.click(within(tray).getByRole("button", { name: "Report a bug" }));
    expect(onReportBug).toHaveBeenCalledOnce();
  });

  it("shows the user, settings, theme, and logout in the Account tray; Admin badge for admins only", async () => {
    renderRail("ADMIN");
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const tray = await screen.findByRole("dialog", { name: "Account" });

    expect(within(tray).getByText("Test User")).toBeInTheDocument();
    expect(within(tray).getByText("test@eduai.test")).toBeInTheDocument();
    expect(within(tray).getByText("Admin")).toBeInTheDocument();
    expect(within(tray).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(within(tray).getByRole("button", { name: /mode$/ })).toBeInTheDocument();
    expect(within(tray).getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("does not show a role badge for non-admins", async () => {
    renderRail("INSTRUCTOR");
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const tray = await screen.findByRole("dialog", { name: "Account" });
    expect(within(tray).queryByText("Instructor")).not.toBeInTheDocument();
  });
});

describe("GlobalNavRail — collapse", () => {
  it("toggles icon-only mode and keeps labels as accessible names", () => {
    const { rail } = renderRail("STUDENT");
    const toggle = screen.getByRole("button", { name: "Collapse navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);

    expect(rail).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByRole("button", { name: "Expand navigation" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });
});
