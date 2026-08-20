import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const useLocalUser = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => useLocalUser(),
}));

import Home from "~/routes/home";

describe("AI Tutor home authentication outage", () => {
  beforeEach(() => {
    navigate.mockReset();
    useLocalUser.mockReturnValue({
      user: null,
      isInitializing: false,
      authError: "Authentication service unavailable",
    });
  });

  it("shows a recoverable outage instead of redirecting or spinning forever", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "Authentication service unavailable" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });
});
