import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { AppSidebar } from "~/components/app-sidebar";
import { SidebarProvider } from "@eduai/ui";
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
    <MemoryRouter>
      <SidebarProvider>
        <AppSidebar user={user} />
      </SidebarProvider>
    </MemoryRouter>,
  );
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
    expect(screen.getByText("Settings")).toBeInTheDocument();
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
});
