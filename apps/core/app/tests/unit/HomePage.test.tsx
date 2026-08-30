import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

// home.tsx imports its loader's server-only session helper at module scope.
vi.mock("~/lib/auth/request-session.server", () => ({
  getRequestSession: vi.fn(),
}));

import HomePage from "~/routes/home";
import { teamMembers } from "~/config/team";

/**
 * Regression guard for the landing-page merge: the standalone /team route was
 * deleted and its roster now lives on this one scrolling page.
 */
function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage — single-scroll layout", () => {
  it("renders every section of the merged page", () => {
    renderHome();
    expect(screen.getByRole("heading", { name: /What is EduAI Lab\?/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What makes EduAI different" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What we build" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Research at the lab" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Meet our research team" })).toBeInTheDocument();
  });

  it("renders the full team roster inline", () => {
    renderHome();
    for (const member of teamMembers) {
      expect(screen.getByRole("heading", { name: member.name })).toBeInTheDocument();
    }
  });

  it("pairs a sign-up and a log-in CTA in the hero and the closing band", () => {
    renderHome();
    expect(screen.getAllByRole("link", { name: /Create an account/ })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Log in" }).length).toBeGreaterThanOrEqual(2);
  });

  it("never points a signed-out reader at the auth-gated dashboard", () => {
    renderHome();
    const dashboardLinks = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href") === "/dashboard");
    // The loader redirects anyone with a session, so every reader here is
    // signed out and a /dashboard link would only bounce them through /login.
    expect(dashboardLinks).toHaveLength(0);
  });

  it("carries the anchor targets the header links to", () => {
    const { container } = renderHome();
    expect(container.querySelector("#about")).toBeInTheDocument();
    expect(container.querySelector("#approach")).toBeInTheDocument();
    expect(container.querySelector("#products")).toBeInTheDocument();
    expect(container.querySelector("#research")).toBeInTheDocument();
    expect(container.querySelector("#team")).toBeInTheDocument();
  });
});
