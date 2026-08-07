import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "../site-header";
import { SidebarProvider } from "../ui/sidebar";

describe("SiteHeader", () => {
  it("renders a header element", () => {
    render(
      <SidebarProvider>
        <SiteHeader title="Test Page" />
      </SidebarProvider>,
    );
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();
  });

  it("renders title as h1 when no breadcrumbs are provided", () => {
    render(
      <SidebarProvider>
        <SiteHeader title="Dashboard" />
      </SidebarProvider>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Dashboard");
  });

  it("renders title as sr-only h1 when breadcrumbs are provided", () => {
    render(
      <SidebarProvider>
        <SiteHeader title="Dashboard" breadcrumbs={<div>Home / Dashboard</div>} />
      </SidebarProvider>,
    );
    const heading = screen.getByRole("heading", { level: 1, hidden: true });
    expect(heading).toHaveTextContent("Dashboard");
    expect(heading).toHaveClass("sr-only");
  });

  it("renders breadcrumbs content when provided", () => {
    render(
      <SidebarProvider>
        <SiteHeader breadcrumbs={<div>Home / Courses / Physics</div>} />
      </SidebarProvider>,
    );
    expect(screen.getByText("Home / Courses / Physics")).toBeInTheDocument();
  });

  it("renders actions in the right slot when provided", () => {
    render(
      <SidebarProvider>
        <SiteHeader title="Page" actions={<button>Action</button>} />
      </SidebarProvider>,
    );
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
  });

  it("renders leadingActions in the center slot when provided", () => {
    render(
      <SidebarProvider>
        <SiteHeader title="Page" leadingActions={<button>Filter</button>} />
      </SidebarProvider>,
    );
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
  });

  it("renders both actions and leadingActions together", () => {
    render(
      <SidebarProvider>
        <SiteHeader
          title="Page"
          leadingActions={<button>Filter</button>}
          actions={<button>Save</button>}
        />
      </SidebarProvider>,
    );
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("does not render leadingActions div when not provided", () => {
    const { container } = render(
      <SidebarProvider>
        <SiteHeader title="Page" />
      </SidebarProvider>,
    );
    const leadingActionsDiv = container.querySelector(
      ".flex.h-full.shrink-0.items-center.gap-1\\.5",
    );
    expect(leadingActionsDiv).not.toBeInTheDocument();
  });

  it("lets the actions row scroll horizontally instead of overflowing the header", () => {
    const { container } = render(
      <SidebarProvider>
        <SiteHeader title="Page" actions={<button>Action</button>} />
      </SidebarProvider>,
    );
    const actionsRow = container.querySelector(".ml-auto.flex.h-full.items-center");
    expect(actionsRow).toHaveClass("overflow-x-auto");
  });
});
