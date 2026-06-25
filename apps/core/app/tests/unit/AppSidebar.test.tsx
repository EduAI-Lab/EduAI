import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppSidebar } from "~/components/app-sidebar";
import { SidebarProvider } from "@eduai/ui";
import type { User } from "~/lib/auth/types";

vi.mock("~/hooks/api/use-policies", () => ({
  usePolicies: vi.fn(() => ({ policies: {} })),
}));
import { usePolicies } from "~/hooks/api/use-policies";

beforeEach(() => {
  vi.mocked(usePolicies).mockReturnValue({ policies: {} } as never);
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

function renderSidebar(role: string) {
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
  // component falls back to the mocked usePolicies for the canInvite flag.
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <SidebarProvider>
          <AppSidebar user={user} />
        </SidebarProvider>
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

  it("renders AI Tutor extension link", () => {
    renderSidebar("STUDENT");
    const link = screen.getByRole("link", { name: "AI Tutor" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "http://localhost:3001");
  });
});

describe("AppSidebar — role-gated nav", () => {
  it("shows admin links for ADMIN", () => {
    renderSidebar("ADMIN");
    expect(screen.getByText("User Management")).toBeInTheDocument();
    expect(screen.getByText("AI Management")).toBeInTheDocument();
    expect(screen.getByText("Bug Reports")).toBeInTheDocument();
  });

  it("hides admin links for STUDENT", () => {
    renderSidebar("STUDENT");
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Management")).not.toBeInTheDocument();
    expect(screen.queryByText("Bug Reports")).not.toBeInTheDocument();
    expect(screen.getByText("Courses")).toBeInTheDocument();
    expect(screen.getByText("AI Tutor")).toBeInTheDocument();
  });

  it("hides admin links for INSTRUCTOR", () => {
    renderSidebar("INSTRUCTOR");
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
    expect(screen.getByText("Chatbot")).toBeInTheDocument();
  });

  it("hides admin links for UNIT_ADMIN", () => {
    renderSidebar("UNIT_ADMIN");
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Management")).not.toBeInTheDocument();
    expect(screen.queryByText("Bug Reports")).not.toBeInTheDocument();
    expect(screen.getByText("Courses")).toBeInTheDocument();
  });

  it("shows the Invitations link for UNIT_ADMIN when unitAdmins.canInvite is on", () => {
    vi.mocked(usePolicies).mockReturnValue({ policies: { "unitAdmins.canInvite": true } } as never);
    renderSidebar("UNIT_ADMIN");
    const link = screen.getByRole("link", { name: "Invitations" });
    expect(link).toHaveAttribute("href", "/unit-admin/invitations");
  });

  it("hides the Invitations link for UNIT_ADMIN when the flag is off", () => {
    renderSidebar("UNIT_ADMIN");
    expect(screen.queryByRole("link", { name: "Invitations" })).not.toBeInTheDocument();
  });
});
