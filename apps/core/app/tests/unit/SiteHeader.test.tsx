import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SiteHeader } from "~/components/site-header";
import { SidebarProvider } from "@eduai/ui";

function renderWithSidebar(ui: React.ReactElement, { path = "/" } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>
  );
}

describe("SiteHeader — rendering", () => {
  it("renders the default title as h1", () => {
    renderWithSidebar(<SiteHeader />);
    expect(screen.getByRole("heading", { level: 1, name: "EduAI" })).toBeInTheDocument();
  });

  it("renders a custom title as h1 when provided", () => {
    renderWithSidebar(<SiteHeader title="Courses" />);
    expect(screen.getByRole("heading", { level: 1, name: "Courses" })).toBeInTheDocument();
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

  it("derives title from route and renders as h1 when no title prop is passed", () => {
    renderWithSidebar(<SiteHeader />, { path: "/dashboard" });
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
  });

  it("renders breadcrumbs when breadcrumbs prop provided", () => {
    renderWithSidebar(
      <SiteHeader breadcrumbs={<nav aria-label="breadcrumb">Home</nav>} />,
    );
    expect(screen.getByRole("navigation", { name: "breadcrumb" })).toBeInTheDocument();
  });

  it("renders sr-only h1 for screen readers when breadcrumbs are shown", () => {
    renderWithSidebar(
      <SiteHeader breadcrumbs={<nav aria-label="breadcrumb">Home</nav>} />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "EduAI" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("sr-only");
  });

  it("uses custom title prop for sr-only h1 when both title and breadcrumbs are provided", () => {
    renderWithSidebar(
      <SiteHeader
        title="Introduction to CS"
        breadcrumbs={<nav aria-label="breadcrumb">Home &gt; Courses &gt; Introduction to CS</nav>}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Introduction to CS" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("sr-only");
  });

  it("does not render visible h1 when breadcrumbs are shown", () => {
    renderWithSidebar(
      <SiteHeader breadcrumbs={<nav aria-label="breadcrumb">Home</nav>} />,
    );
    const headings = screen.getAllByRole("heading", { level: 1 });
    const visibleHeadings = headings.filter((h) => !h.classList.contains("sr-only"));
    expect(visibleHeadings).toHaveLength(0);
  });
});
