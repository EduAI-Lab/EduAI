/**
 * @file Core's root `ErrorBoundary`. A 403 must render the same generic 404 page
 * as a 404 (matching AI Tutor's root), so a forbidden page is never told
 * apart from a missing one; any other status is still a plain error page.
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, data, RouterProvider, useRouteError } from "react-router";
import { describe, expect, it, vi } from "vitest";

// `root.tsx` reaches for the DB and better-auth at import time; only its
// `loader` uses them, so stub them for a render test of the boundary.
vi.mock("~/lib/prisma.server", () => ({
  default: { userPreference: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("~/lib/policy.server", () => ({ getPolicies: vi.fn() }));
vi.mock("~/lib/auth/password-expiry.server", () => ({
  getExpiredPasswordRedirect: vi.fn(),
}));

import { ErrorBoundary } from "~/root";

const TITLE = "404 — Page not found";

function renderThrowing(status: number) {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/users",
        loader: () => {
          throw data(null, { status, statusText: "Forbidden" });
        },
        Component: () => <p>admin page</p>,
        ErrorBoundary: () => <ErrorBoundary error={useRouteError()} params={{}} />,
      },
    ],
    { initialEntries: ["/admin/users"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("root ErrorBoundary", () => {
  it.each([404, 403])("renders the generic 404 page for a %i", async (status) => {
    renderThrowing(status);

    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByText("Forbidden")).toBeNull();
  });

  it("keeps any other status on the plain error page", async () => {
    renderThrowing(500);

    expect(await screen.findByText("Error")).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
