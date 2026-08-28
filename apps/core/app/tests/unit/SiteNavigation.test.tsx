import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SiteNavigation } from "~/components/site-navigation";

/**
 * The landing page is one scrolling document, so the header's nav items are
 * in-page anchors rather than routes, and the Dashboard entry point moved into
 * the page body (hero + closing CTA band).
 */
describe("SiteNavigation — rendering", () => {
  it("renders the in-page section anchors", () => {
    render(
      <MemoryRouter>
        <SiteNavigation />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "#about");
    expect(screen.getByRole("link", { name: "Products" })).toHaveAttribute("href", "#products");
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute("href", "#research");
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("href", "#team");
  });

  it("renders the wordmark linking back to the top of the site", () => {
    render(
      <MemoryRouter>
        <SiteNavigation />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "EduAI Lab" })).toHaveAttribute("href", "/");
  });

  it("renders Log in and Sign up as real links, not imperative buttons", () => {
    render(
      <MemoryRouter>
        <SiteNavigation />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/auth/register"
    );
  });

  it("no longer carries a Dashboard action — that lives on the page now", () => {
    render(
      <MemoryRouter>
        <SiteNavigation />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
  });
});
