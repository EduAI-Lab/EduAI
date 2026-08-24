/**
 * @file The in-shell route boundary sorts a thrown error into exactly two
 * answers, and getting that split wrong is what this pins:
 *
 *   - 404/400/403 all become the same generic 404, so a forbidden page is
 *     indistinguishable from a missing one;
 *   - anything else stays a visible failure, rather than being dressed up as a
 *     404 the reader would wrongly read as "this never existed".
 *
 * The rendering cases go through a real router so `useRouteError` receives what
 * it receives in the app, not a hand-mocked stand-in.
 */
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ApiHttpError } from "~/lib/api";
import { RouteErrorState, isNotFoundStatus, statusOf } from "~/components/common/RouteErrorState";

const NOT_FOUND_TITLE = "404 — Page not found";
const FAILURE_TITLE = "This page could not be loaded";

/** Mount the boundary as the app does: a route whose loader throws. */
function renderThrowing(thrown: unknown) {
  const router = createMemoryRouter(
    [
      {
        path: "/instructor/courses/1",
        loader: () => {
          throw thrown;
        },
        element: <p>loaded</p>,
        errorElement: <RouteErrorState />,
      },
    ],
    { initialEntries: ["/instructor/courses/1"] },
  );

  return render(<RouterProvider router={router} />);
}

// A thrown `Response` only becomes a route error response once the router has
// converted it, and that conversion is not reachable from a unit call — the
// render cases below cover that branch.
describe("statusOf", () => {
  it("reads the status off an ApiHttpError", () => {
    expect(statusOf(new ApiHttpError(403, "Forbidden"))).toBe(403);
  });

  it("has no status for a plain error", () => {
    expect(statusOf(new Error("boom"))).toBeNull();
    expect(statusOf("boom")).toBeNull();
  });
});

describe("isNotFoundStatus", () => {
  it("treats missing, malformed and forbidden alike", () => {
    // 400 is here because a malformed id (`/courses/not-a-number`) must not
    // read as a server fault, and 403 so the app never confirms a record
    // exists to someone who cannot open it.
    expect(isNotFoundStatus(404)).toBe(true);
    expect(isNotFoundStatus(400)).toBe(true);
    expect(isNotFoundStatus(403)).toBe(true);
  });

  it("leaves every other status to the failure state", () => {
    expect(isNotFoundStatus(500)).toBe(false);
    expect(isNotFoundStatus(null)).toBe(false);
  });
});

describe("RouteErrorState", () => {
  it("shows the generic 404 for a thrown 404 response", async () => {
    renderThrowing(new Response(null, { status: 404 }));

    expect(await screen.findByText(NOT_FOUND_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(FAILURE_TITLE)).toBeNull();
  });

  it("shows the same 404 for a forbidden API error", async () => {
    renderThrowing(new ApiHttpError(403, "Forbidden"));

    expect(await screen.findByText(NOT_FOUND_TITLE)).toBeInTheDocument();
  });

  it("shows a real failure — not a 404 — for a server error", async () => {
    renderThrowing(new ApiHttpError(500, "Server error"));

    expect(await screen.findByText(FAILURE_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_TITLE)).toBeNull();
  });

  it("shows a real failure for an error carrying no status", async () => {
    renderThrowing(new Error("network down"));

    expect(await screen.findByText(FAILURE_TITLE)).toBeInTheDocument();
  });

  it("offers a retry that reloads the page", async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });

    try {
      renderThrowing(new Error("network down"));

      const retry = await screen.findByRole("button", { name: /try again/i });
      retry.click();

      expect(reload).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
