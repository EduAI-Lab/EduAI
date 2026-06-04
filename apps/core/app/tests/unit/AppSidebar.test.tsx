import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AppSidebar } from "~/components/app-sidebar";
import { SidebarProvider } from "~/components/ui/sidebar";
import type { User } from "~/lib/auth/types";

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

  return render(
    <SidebarProvider>
      <AppSidebar user={user} />
    </SidebarProvider>,
  );
}

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
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("hides admin links for PROFESSOR", () => {
    renderSidebar("PROFESSOR");
    expect(screen.queryByText("User Management")).not.toBeInTheDocument();
    expect(screen.getByText("Chatbot")).toBeInTheDocument();
  });
});
