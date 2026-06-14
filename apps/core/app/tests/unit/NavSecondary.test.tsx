import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconSettings, IconHelp } from "@tabler/icons-react";
import { MemoryRouter } from "react-router";
import { NavSecondary } from "~/components/nav-secondary";
import type { NavSecondaryItem } from "~/components/nav-secondary";
import { SidebarProvider } from "@eduai/ui";

const items: NavSecondaryItem[] = [
  { title: "Settings", url: "/settings", icon: IconSettings },
  { title: "Get Help", url: "#", icon: IconHelp },
];

function renderWithSidebar(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>
  );
}

describe("NavSecondary — rendering", () => {
  it("renders each item as a link with the correct href", () => {
    renderWithSidebar(<NavSecondary items={items} />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Get Help" })).toBeInTheDocument();
  });
});

describe("NavSecondary — missing data", () => {
  it("renders without throwing when there are no items", () => {
    const { container } = renderWithSidebar(<NavSecondary items={[]} />);
    expect(container).toBeTruthy();
  });
});
