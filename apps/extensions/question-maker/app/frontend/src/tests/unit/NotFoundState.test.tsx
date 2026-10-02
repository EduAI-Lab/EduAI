/**
 * @file Question Maker's generic 404 — same copy and way back as AI Tutor's and
 * Core's, so an unknown URL looks the same on all three platforms.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { NotFoundState } from "@/components/common/NotFoundState";

describe("NotFoundState", () => {
  it("names the status, never confirms the page exists, and links to the dashboard", () => {
    render(
      <MemoryRouter>
        <NotFoundState />
      </MemoryRouter>,
    );

    expect(screen.getByText("404 — Page not found")).toBeInTheDocument();
    expect(screen.getByText(/doesn't exist, or you don't have access to it/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
