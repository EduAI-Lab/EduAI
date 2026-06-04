import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SiteNavigation } from "~/components/site-navigation";

describe("SiteNavigation — rendering", () => {
  it("renders Home and Team links", () => {
    render(
      <MemoryRouter>
        <SiteNavigation currentPage="home" />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
  });

  it("renders the Dashboard button", () => {
    render(
      <MemoryRouter>
        <SiteNavigation currentPage="home" />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("marks the current page link as active", () => {
    render(
      <MemoryRouter>
        <SiteNavigation currentPage="team" />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Team" })).toHaveClass("border-green-500");
  });
});

describe("SiteNavigation — missing data", () => {
  it("renders without throwing when currentPage matches nothing", () => {
    render(
      <MemoryRouter>
        <SiteNavigation currentPage="" />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  });
});
