import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { IconDashboard, IconBooks } from "@tabler/icons-react";
import { NavMain } from "~/components/nav-main";
import type { NavMainItem } from "~/components/nav-main";
import { SidebarProvider } from "~/components/ui/sidebar";

const items: NavMainItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: IconDashboard },
  { title: "Courses", url: "/courses", icon: IconBooks },
];

function renderWithSidebar(ui: React.ReactElement, { path = "/" } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>
  );
}

describe("NavMain — rendering", () => {
  it("renders each nav item with its link", () => {
    renderWithSidebar(<NavMain items={items} />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute("href", "/courses");
  });
});

describe("NavMain — missing data", () => {
  it("renders without throwing when there are no items", () => {
    renderWithSidebar(<NavMain items={[]} />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});

describe("NavMain — active state", () => {
  it("marks the current route link as aria-current=page", () => {
    renderWithSidebar(<NavMain items={items} />, { path: "/dashboard" });
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Courses" })).not.toHaveAttribute("aria-current");
  });

  it("marks a child route as active when path starts with item url", () => {
    renderWithSidebar(<NavMain items={items} />, { path: "/courses/abc123" });
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });
});
