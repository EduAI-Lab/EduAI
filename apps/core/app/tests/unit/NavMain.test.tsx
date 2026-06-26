import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { IconDashboard, IconBooks, IconShieldLock, IconUsers, IconBrain } from "@tabler/icons-react";
import { NavMain } from "~/components/nav-main";
import type { NavMainItem } from "~/components/nav-main";
import type { NavGroupItem } from "~/components/nav-main";
import { SidebarProvider } from "@eduai/ui";

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

const adminGroup: NavGroupItem = {
  title: "Administration",
  icon: IconShieldLock,
  children: [
    { title: "User Management", url: "/admin/users", icon: IconUsers },
    { title: "AI Management", url: "/admin/ai-models", icon: IconBrain },
  ],
};

describe("NavMain — group collapsed by default", () => {
  it("renders the group header button but not child links", () => {
    renderWithSidebar(<NavMain items={[adminGroup]} />);
    expect(screen.getByRole("button", { name: /administration/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "User Management" })).not.toBeInTheDocument();
  });
});

describe("NavMain — group expand/collapse", () => {
  it("shows child links after clicking the group header", () => {
    renderWithSidebar(<NavMain items={[adminGroup]} />);
    fireEvent.click(screen.getByRole("button", { name: /administration/i }));
    expect(screen.getByRole("link", { name: "User Management" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AI Management" })).toBeInTheDocument();
  });

  it("hides child links after clicking the header twice", () => {
    renderWithSidebar(<NavMain items={[adminGroup]} />);
    const header = screen.getByRole("button", { name: /administration/i });
    fireEvent.click(header);
    fireEvent.click(header);
    expect(screen.queryByRole("link", { name: "User Management" })).not.toBeInTheDocument();
  });
});

describe("NavMain — group auto-expand for active child", () => {
  it("expands the group on mount when the current path matches a child", () => {
    renderWithSidebar(<NavMain items={[adminGroup]} />, { path: "/admin/users" });
    expect(screen.getByRole("link", { name: "User Management" })).toBeInTheDocument();
  });

  it("marks the active child with aria-current=page", () => {
    renderWithSidebar(<NavMain items={[adminGroup]} />, { path: "/admin/users" });
    expect(screen.getByRole("link", { name: "User Management" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "AI Management" })).not.toHaveAttribute("aria-current");
  });
});
