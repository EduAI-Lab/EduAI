/**
 * @file The catch-all (`*`) route renders the shared `@eduai/ui` 404 in its
 * in-shell form (its copy and layout are tested in packages/ui), with the way
 * back routed through react-router rather than a full page load.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import NotFoundRoute from "~/routes/not-found";

describe("not-found route", () => {
  it("renders the shared 404 inside the shell with a way back to the dashboard", () => {
    render(
      <MemoryRouter>
        <NotFoundRoute />
      </MemoryRouter>,
    );

    expect(screen.getByText("404 — Page not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.queryByRole("main")).toBeNull();
  });
});
