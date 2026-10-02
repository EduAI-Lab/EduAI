/**
 * @file The generic 404 Core shows for an unknown URL, a missing record, and a
 * page the viewer may not open — matching AI Tutor's NotFoundState. A 404 thrown
 * through `notFound(user)` renders inside the app shell; a bare 404 (no viewer
 * attached) renders standalone; any other error is a load failure, not a 404.
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

import { NotFoundState } from "~/components/shared/not-found-state";
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

describe("NotFoundState", () => {
  it("names the status, never confirms the page exists, and links to the dashboard", () => {
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: "/", Component: () => <NotFoundState /> }])}
      />,
    );

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByText(/doesn't exist, or you don't have access to it/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("centres itself on a bare page when standalone", () => {
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: "/", Component: () => <NotFoundState standalone /> }])}
      />,
    );

    expect(screen.getByRole("main").className).toContain("min-h-dvh");
  });
});

describe("RouteErrorState", () => {
  it("renders notFound(user) inside the app shell without naming the forbidden page", async () => {
    renderThrowing(notFound(USER));

    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    const shell = screen.getByTestId("core-app-shell");
    expect(shell).toHaveAttribute("data-title", "Page not found");
    expect(screen.queryByText("course page")).toBeNull();
  });

  it("renders a 404 with no viewer attached standalone", async () => {
    renderThrowing(new Response(null, { status: 404 }));

    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByTestId("core-app-shell")).toBeNull();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("does not dress a real failure up as a 404", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderThrowing(new Error("db down"));

    expect(await screen.findByText("This page could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
