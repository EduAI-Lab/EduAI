import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SiteHeader } from "~/components/site-header";
import { SidebarProvider } from "~/components/ui/sidebar";

function renderWithSidebar(ui: React.ReactElement, { path = "/" } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>
  );
}

describe("SiteHeader — rendering", () => {
  it("renders the default title", () => {
    renderWithSidebar(<SiteHeader />);
    expect(screen.getByRole("heading", { name: "EduAI" })).toBeInTheDocument();
  });

  it("renders a custom title when provided", () => {
    renderWithSidebar(<SiteHeader title="Courses" />);
    expect(screen.getByRole("heading", { name: "Courses" })).toBeInTheDocument();
  });

  it("renders optional actions on the right side of the header", () => {
    renderWithSidebar(
      <SiteHeader
        title="Chat"
        actions={<button type="button">Test Action</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Test Action" })).toBeInTheDocument();
  });

  it("derives title from route when no title prop is passed", () => {
    renderWithSidebar(<SiteHeader />, { path: "/dashboard" });
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("renders breadcrumbs instead of h1 when breadcrumbs prop provided", () => {
    renderWithSidebar(
      <SiteHeader breadcrumbs={<nav aria-label="breadcrumb">Home</nav>} />,
    );
    expect(screen.getByRole("navigation", { name: "breadcrumb" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
