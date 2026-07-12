import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell, type AppShellProps } from "../app-shell";
import type { AppSidebarProps } from "../app-sidebar";

const sidebar: AppSidebarProps = {
  logo: <span>Test App</span>,
  navMain: [{ title: "Dashboard", url: "/dashboard" }],
  currentPath: "/dashboard",
  user: { name: "Ada Lovelace", email: "ada@example.com" },
};

function renderShell(overrides: Partial<Omit<AppShellProps, "sidebar">> = {}) {
  const { children, ...rest } = overrides;
  return render(
    <AppShell sidebar={sidebar} {...rest}>
      {children ?? <div>Page content</div>}
    </AppShell>,
  );
}

describe("AppShell", () => {
  it("renders the sidebar slot (logo and nav items)", () => {
    renderShell();
    expect(screen.getByText("Test App")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("renders the header slot (title, breadcrumbs, actions)", () => {
    renderShell({
      title: "Dashboard",
      breadcrumbs: <div>Home / Dashboard</div>,
      headerActions: <button>Save</button>,
    });
    const heading = screen.getByRole("heading", { level: 1, hidden: true });
    expect(heading).toHaveTextContent("Dashboard");
    expect(screen.getByText("Home / Dashboard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("renders children as the main content", () => {
    renderShell({ children: <div>Unique page body</div> });
    expect(screen.getByText("Unique page body")).toBeInTheDocument();
  });

  it("renders the commandPalette slot as a sibling after SidebarInset", () => {
    renderShell({ commandPalette: <div data-testid="palette">Palette</div> });
    expect(screen.getByTestId("palette")).toBeInTheDocument();
  });

  it("applies the default --sidebar-width and --header-height style variables", () => {
    const { container } = renderShell();
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement;
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("calc(var(--spacing) * 72)");
    expect(wrapper.style.getPropertyValue("--header-height")).toBe("calc(var(--spacing) * 12)");
  });

  it("applies custom sidebarWidth/headerHeight overrides", () => {
    const { container } = renderShell({ sidebarWidth: "20rem", headerHeight: "3.5rem" });
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement;
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("20rem");
    expect(wrapper.style.getPropertyValue("--header-height")).toBe("3.5rem");
  });
});
