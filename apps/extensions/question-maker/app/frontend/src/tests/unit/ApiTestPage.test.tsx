/**
 * Minimal smoke coverage for ApiTestPage (#1544) — a dev-only diagnostic bench
 * (see file header) for exercising backend endpoints manually. Not a user
 * surface, so this only covers the auth gate and that it renders for an
 * authenticated user; it does not exercise every form.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const { useAuthMock, useEduAIStatusMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useEduAIStatusMock: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/hooks/useEduAIStatus", () => ({ useEduAIStatus: () => useEduAIStatusMock() }));

import { ApiTestPage } from "@/pages/ApiTestPage";

afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter>
      <ApiTestPage />
    </MemoryRouter>,
  );
}

describe("ApiTestPage (dev-only diagnostic bench)", () => {
  it("renders nothing while auth is loading", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: true });
    useEduAIStatusMock.mockReturnValue({ status: "idle", refresh: vi.fn() });
    const { container } = renderPage();
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("redirects unauthenticated users", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
    useEduAIStatusMock.mockReturnValue({ status: "idle", refresh: vi.fn() });
    renderPage();
    expect(screen.queryByText("API Test Bench")).not.toBeInTheDocument();
  });

  it("renders the bench for authenticated users", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    useEduAIStatusMock.mockReturnValue({ status: "idle", refresh: vi.fn() });
    renderPage();
    expect(screen.getByText("API Test Bench")).toBeInTheDocument();
    expect(screen.getByText("Fetch Courses")).toBeInTheDocument();
  });
});
