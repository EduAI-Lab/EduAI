import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SiteNavigation } from "~/components/site-navigation";

/**
 * The landing page is one scrolling document, so the header's nav items are
 * in-page anchors rather than routes. Nothing on this page links to the
 * auth-gated dashboard: the route's loader redirects anyone with a session, so
 * every reader of the header is signed out.
 */
describe("SiteNavigation — rendering", () => {
  it("renders the in-page section anchors", () => {
    render(
      <MemoryRouter>
        <SiteNavigation />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "#about");
    expect(screen.getByRole("link", { name: "Approach" })).toHaveAttribute("href", "#approach");
    expect(screen.getByRole("link", { name: "Products" })).toHaveAttribute("href", "#products");
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute("href", "#research");
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("href", "#team");
  });

  it("renders the wordmark linking back to the top of the site", () => {
    render(
      <MemoryRouter>
        <SiteNavigation />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "EduAI" })).toHaveAttribute("href", "/");
  });

  it("renders Log in and Sign up as real links, not imperative buttons", () => {
    render(
      <MemoryRouter>
        <SiteNavigation />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/auth/register");
  });

  it("hides the section anchors behind a toggle at mobile widths", () => {
    render(
      <MemoryRouter>
        <SiteNavigation />
      </MemoryRouter>,
    );

    // The desktop row is the only copy in the accessibility tree until the
    // disclosure is opened, so the anchors are not announced twice.
    const toggle = screen.getByRole("button", { name: "Open section menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("link", { name: "Team" })).toHaveLength(1);

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Close section menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getAllByRole("link", { name: "Team" })).toHaveLength(2);
  });

  it("carries no Dashboard action — every reader of this header is signed out", () => {
    render(
      <MemoryRouter>
        <SiteNavigation />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
  });
});
