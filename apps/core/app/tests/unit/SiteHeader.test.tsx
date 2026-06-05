import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "~/components/site-header";
import { SidebarProvider } from "~/components/ui/sidebar";

function renderWithSidebar(ui: React.ReactElement) {
  return render(<SidebarProvider>{ui}</SidebarProvider>);
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
});
