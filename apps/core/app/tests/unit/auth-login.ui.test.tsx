// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));
vi.mock("~/lib/policy.server", () => ({ getPolicy: vi.fn() }));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

import LoginPage from "~/routes/auth/login";

function renderLogin() {
  const router = createMemoryRouter(
    [
      {
        path: "/auth/login",
        element: <LoginPage />,
        loader: () => ({
          redirectTo: "/dashboard",
          allowRegistration: true,
          forceReauth: false,
        }),
      },
    ],
    { initialEntries: ["/auth/login"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("login page demo-credential regression", () => {
  it("renders no demo controls or fixture credentials", async () => {
    renderLogin();

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(screen.queryByText(/demo accounts/i)).toBeNull();
    expect(screen.queryByText(/admin@eduai\.local/i)).toBeNull();
    expect(screen.queryByText(/EduAI2026!/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /admin/i })).toBeNull();
    expect(document.body.innerHTML).not.toContain("admin@eduai.local");
    expect(document.body.innerHTML).not.toContain("EduAI2026!");
    expect(document.body.innerHTML).not.toContain("test-password");
  });
});
