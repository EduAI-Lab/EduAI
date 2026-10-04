/**
 * @file Core's route boundary around the shared `@eduai/ui` 404 (whose own copy
 * and layout are tested in packages/ui). A 404 thrown
 * through `notFound(user)` renders inside the app shell; a bare 404 (no viewer
 * attached) renders standalone, as does a 403; any other error is a load
 * failure, not a 404.
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, data, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/layout/core-app-shell", () => ({
  CoreAppShell: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div data-testid="core-app-shell" data-title={title}>
      {children}
    </div>
  ),
}));

import { RouteErrorState } from "~/components/shared/route-error-state";
import { notFound } from "~/lib/not-found.server";
import type { User } from "~/lib/auth/types";

const TITLE = "404 — Page not found";
const USER = { id: "u1", role: "STUDENT" } as User;

function renderThrowing(thrown: Response | ReturnType<typeof data> | Error) {
  const router = createMemoryRouter(
    [
      {
        path: "/courses/:courseId",
        loader: () => {
          throw thrown;
        },
        Component: () => <p>course page</p>,
        ErrorBoundary: RouteErrorState,
      },
    ],
    { initialEntries: ["/courses/missing"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("RouteErrorState", () => {
  it("renders notFound(user) inside the app shell without naming the forbidden page", async () => {
    renderThrowing(notFound(USER));

    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    const shell = screen.getByTestId("core-app-shell");
    expect(shell).toHaveAttribute("data-title", "Page not found");
    expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.queryByText("course page")).toBeNull();
  });

  it("renders a 404 with no viewer attached standalone", async () => {
    renderThrowing(new Response(null, { status: 404 }));

    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByTestId("core-app-shell")).toBeNull();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("renders a 403 as the same standalone 404, so forbidden is never told apart from missing", async () => {
    renderThrowing(new Response(null, { status: 403 }));

    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByText("This page could not be loaded")).toBeNull();
  });

  it("does not dress a real failure up as a 404", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderThrowing(new Error("db down"));

    expect(await screen.findByText("This page could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
