import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SiteFooter } from "~/components/site-footer";

describe("SiteFooter — rendering", () => {
  it("renders the About section", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
  });

  it("renders the Quick Links section", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Quick links" })).toBeInTheDocument();
  });

  it("renders the current year in the copyright line", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>
    );
    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
  });
});
