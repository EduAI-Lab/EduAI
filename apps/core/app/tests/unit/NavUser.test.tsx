import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NavUser } from "~/components/nav-user";
import { SidebarProvider } from "~/components/ui/sidebar";
import type { User } from "~/lib/auth/types";

const user = {
  id: "u1",
  name: "Grace Hopper",
  email: "grace@example.com",
  role: "ADMIN",
  image: null,
} as unknown as User;

function renderNavUser(u: User) {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <NavUser user={u} />
      </SidebarProvider>
    </MemoryRouter>
  );
}

describe("NavUser — rendering", () => {
  it("renders the user's name and email", () => {
    renderNavUser(user);
    expect(screen.getAllByText("Grace Hopper").length).toBeGreaterThan(0);
    expect(screen.getAllByText("grace@example.com").length).toBeGreaterThan(0);
  });

  it("renders the role badge for an admin", () => {
    renderNavUser(user);
    expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
  });

  it("renders initials in the avatar fallback", () => {
    renderNavUser(user);
    expect(screen.getAllByText("GH").length).toBeGreaterThan(0);
  });
});

describe("NavUser — missing data", () => {
  it("falls back to a Student badge when role is missing", () => {
    const noRole = { ...user, role: undefined } as unknown as User;
    renderNavUser(noRole);
    expect(screen.getAllByText("Student").length).toBeGreaterThan(0);
  });
});
