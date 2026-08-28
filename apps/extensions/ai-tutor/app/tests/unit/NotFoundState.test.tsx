/**
 * @file The generic 404 state has two shapes — `standalone` for boundaries that
 * sit above the app shell, and the in-shell default. Both are asserted here
 * because the difference is the whole point of the prop: the standalone form
 * centres itself on a bare page, the in-shell form must not, or it would push
 * the sidebar and header off-screen.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import NotFoundRoute, { NotFoundState } from "~/components/common/NotFoundState";

const TITLE = "404 — Page not found";

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("NotFoundState", () => {
  it("names the status and offers a way back to the dashboard", () => {
    renderInRouter(<NotFoundState />);

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("says nothing about whether the page exists", () => {
    renderInRouter(<NotFoundState />);

    // One sentence covers "no such page" and "not yours to open" alike, so the
    // app never confirms a record exists to someone who cannot see it.
    expect(screen.getByText(/doesn't exist, or you don't have access to it/i)).toBeInTheDocument();
  });

  it("centres itself on a bare page when standalone", () => {
    renderInRouter(<NotFoundState standalone />);

    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(main.className).toContain("min-h-dvh");
  });

  it("renders without the bare-page wrapper by default", () => {
    renderInRouter(<NotFoundState />);

    expect(screen.queryByRole("main")).toBeNull();
  });

  it("is what the catch-all route renders", () => {
    renderInRouter(<NotFoundRoute />);

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("main")).toBeNull();
  });
});
