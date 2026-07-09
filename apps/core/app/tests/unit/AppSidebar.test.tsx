import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppSidebar } from "~/components/app-sidebar";
import { SidebarProvider } from "@eduai/ui";
import type { User } from "~/lib/auth/types";
import {
  PolicyProvider,
  type PolicyValues,
} from "~/components/policy/policy-gate";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function renderSidebar(role: string, policies: PolicyValues = {}) {
  const user = {
    id: "user-1",
    name: "Test User",
    email: "test@eduai.test",
    role,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  // A data router (not plain MemoryRouter) so AppSidebar's useRouteLoaderData
  // call resolves. No "root" route is defined, so it returns undefined and the
  // component falls back to the SSR-seeded policy gate for the canInvite flag.
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <PolicyProvider policies={policies}>
          <SidebarProvider>
            <AppSidebar user={user} />
          </SidebarProvider>
        </PolicyProvider>
      ),
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe("AppSidebar — rendering", () => {
  it("renders the EduAI brand", () => {
    renderSidebar("ADMIN");
    expect(screen.getByText("EduAI")).toBeInTheDocument();
  });

  it("renders Dashboard and Courses links", () => {
    renderSidebar("ADMIN");
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Courses" })).toBeInTheDocument();
  });

  it("renders the app switcher (cross-app links moved into the switcher popover)", () => {
    // AI Tutor / Question Maker are no longer sidebar nav links — they live in
    // the header app switcher (BrandSwitcher). Its popover contents aren't
    // rendered under happy-dom (Radix), so assert the trigger is present; the
    // RBAC gate on the popover is covered in @eduai/ui's app-launcher.test.tsx.
    renderSidebar("STUDENT");
    expect(
      screen.getByRole("button", { name: "Switch app" }),
    ).toBeInTheDocument();
  });
});

describe("AppSidebar — role-gated nav", () => {
  it("shows admin links for ADMIN after expanding Administration", () => {
    renderSidebar("ADMIN");
    fireEvent.click(screen.getByRole("button", { name: /administration/i }));
    expect(screen.getByText("User Management")).toBeInTheDocument();
    expect(screen.getByText("AI Management")).toBeInTheDocument();
    expect(screen.getByText("Bug Reports")).toBeInTheDocument();
    expect(screen.getByText("Admin Chatbot")).toBeInTheDocument();
  });

  it("hides admin links for STUDENT", () => {
    renderSidebar("STUDENT");
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Management")).not.toBeInTheDocument();
    expect(screen.queryByText("Bug Reports")).not.toBeInTheDocument();
    expect(screen.getByText("Courses")).toBeInTheDocument();
  });

  it("hides admin links for INSTRUCTOR", () => {
    renderSidebar("INSTRUCTOR");
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
    expect(screen.getByText("Course Chat")).toBeInTheDocument();
  });

  it("hides admin links for UNIT_ADMIN", () => {
    renderSidebar("UNIT_ADMIN");
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Management")).not.toBeInTheDocument();
    expect(screen.queryByText("Bug Reports")).not.toBeInTheDocument();
    expect(screen.getByText("Courses")).toBeInTheDocument();
  });

  it("shows the Invitations link for UNIT_ADMIN when unitAdmins.canInvite is on", () => {
    renderSidebar("UNIT_ADMIN", { "unitAdmins.canInvite": true });
    const link = screen.getByRole("link", { name: "Invitations" });
    expect(link).toHaveAttribute("href", "/unit-admin/invitations");
  });

  it("shows the Invitations item greyed-out (not a link) for UNIT_ADMIN when the flag is off (#807)", () => {
    renderSidebar("UNIT_ADMIN");
    // §807: the item stays visible but is no longer a navigable link.
    expect(screen.queryByRole("link", { name: "Invitations" })).not.toBeInTheDocument();
    const disabled = screen.getByText("Invitations");
    expect(disabled).toBeInTheDocument();
    expect(disabled.closest('[aria-disabled="true"]')).not.toBeNull();
  });
});
