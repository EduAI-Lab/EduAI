/**
 * Unit tests for `QmHomeShell` (#1546): role-aware wrapper around the
 * question-bank/assessments workspace. Renders children bare when signed out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const useAuthMock = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));

const roleBannerSpy = vi.fn();
vi.mock("@/components/rbac/QmRoleBanner", () => ({
  QmRoleBanner: (props: { variant: string }) => {
    roleBannerSpy(props);
    return <div data-testid="role-banner">{props.variant}</div>;
  },
}));

import { QmHomeShell } from "@/components/home/QmHomeShell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QmHomeShell", () => {
  it("renders only children when there is no authenticated user", () => {
    useAuthMock.mockReturnValue({ user: null });
    render(
      <QmHomeShell>
        <p>content</p>
      </QmHomeShell>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByTestId("role-banner")).toBeNull();
  });

  it("wraps children with a role banner for an authenticated user", () => {
    useAuthMock.mockReturnValue({ user: { role: "ADMIN" } });
    render(
      <QmHomeShell>
        <p>content</p>
      </QmHomeShell>,
    );
    expect(screen.getByTestId("role-banner")).toHaveTextContent("admin");
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("maps UNIT_ADMIN to the unit-admin banner variant", () => {
    useAuthMock.mockReturnValue({ user: { role: "UNIT_ADMIN" } });
    render(
      <QmHomeShell>
        <p>content</p>
      </QmHomeShell>,
    );
    expect(roleBannerSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "unit-admin" }));
  });

  it("defaults to the instructor banner variant for other roles", () => {
    useAuthMock.mockReturnValue({ user: { role: "INSTRUCTOR" } });
    render(
      <QmHomeShell>
        <p>content</p>
      </QmHomeShell>,
    );
    expect(roleBannerSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "instructor" }));
  });
});
