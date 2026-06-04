import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconDashboard, IconBooks } from "@tabler/icons-react";
import { NavMain } from "~/components/nav-main";
import type { NavMainItem } from "~/components/nav-main";
import { SidebarProvider } from "~/components/ui/sidebar";

const items: NavMainItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: IconDashboard },
  { title: "Courses", url: "/courses", icon: IconBooks },
];

function renderWithSidebar(ui: React.ReactElement) {
  return render(<SidebarProvider>{ui}</SidebarProvider>);
}

describe("NavMain — rendering", () => {
  it("renders each nav item with its link", () => {
    renderWithSidebar(<NavMain items={items} />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute("href", "/courses");
  });

  it("always renders the Quick Create button", () => {
    renderWithSidebar(<NavMain items={items} />);
    expect(screen.getByText("Quick Create")).toBeInTheDocument();
  });
});

describe("NavMain — missing data", () => {
  it("renders without throwing when there are no items", () => {
    renderWithSidebar(<NavMain items={[]} />);
    expect(screen.getByText("Quick Create")).toBeInTheDocument();
  });
});
