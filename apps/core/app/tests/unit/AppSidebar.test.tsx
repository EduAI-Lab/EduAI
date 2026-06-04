import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppSidebar } from "~/components/app-sidebar";
import { SidebarProvider } from "~/components/ui/sidebar";
import type { User } from "~/lib/auth/types";

const adminUser = {
  id: "u1",
  name: "Grace Hopper",
  email: "grace@example.com",
  role: "ADMIN",
  image: null,
} as unknown as User;

const studentUser = { ...adminUser, role: "STUDENT" } as unknown as User;

function renderSidebar(user: User) {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <AppSidebar user={user} />
      </SidebarProvider>
    </MemoryRouter>
  );
}

describe("AppSidebar — rendering", () => {
  it("renders the EduAI brand", () => {
    renderSidebar(adminUser);
    expect(screen.getByText("EduAI")).toBeInTheDocument();
  });

  it("renders the default Dashboard and Courses links", () => {
    renderSidebar(adminUser);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Courses" })).toBeInTheDocument();
  });

  it("shows admin-only links for an ADMIN user", () => {
    renderSidebar(adminUser);
    expect(screen.getByRole("link", { name: "AI Management" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "User Management" })).toBeInTheDocument();
  });
});

describe("AppSidebar — role gating", () => {
  it("hides admin-only links for a non-admin user", () => {
    renderSidebar(studentUser);
    expect(screen.queryByRole("link", { name: "AI Management" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "User Management" })).not.toBeInTheDocument();
  });
});
