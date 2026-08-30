/**
 * Unit tests for `QmRoleBanner` (#1546): role-derived copy, explicit variant
 * override, authorized-units display, and the signed-in-as footer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const useAuthMock = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));

import { QmRoleBanner } from "@/components/rbac/QmRoleBanner";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QmRoleBanner", () => {
  it("renders nothing when there is no authenticated user", () => {
    useAuthMock.mockReturnValue({ user: null });
    const { container } = render(<QmRoleBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("derives the admin view from the user's role", () => {
    useAuthMock.mockReturnValue({ user: { role: "ADMIN", email: "a@b.com" } });
    render(<QmRoleBanner />);
    expect(screen.getByTestId("qm-role-banner-admin")).toBeInTheDocument();
    expect(screen.getByText("Administrator view")).toBeInTheDocument();
    expect(screen.getByText(/a@b.com/)).toBeInTheDocument();
  });

  it("derives the unit-admin view and shows authorized units", () => {
    useAuthMock.mockReturnValue({
      user: { role: "UNIT_ADMIN", authorizedUnits: ["CS", "MATH"] },
    });
    render(<QmRoleBanner />);
    expect(screen.getByTestId("qm-role-banner-unit-admin")).toBeInTheDocument();
    expect(screen.getByText("CS, MATH")).toBeInTheDocument();
  });

  it("defaults to instructor view for any other role", () => {
    useAuthMock.mockReturnValue({ user: { role: "INSTRUCTOR" } });
    render(<QmRoleBanner />);
    expect(screen.getByTestId("qm-role-banner-instructor")).toBeInTheDocument();
  });

  it("respects an explicit variant override regardless of role", () => {
    useAuthMock.mockReturnValue({ user: { role: "INSTRUCTOR" } });
    render(<QmRoleBanner variant="admin" />);
    expect(screen.getByTestId("qm-role-banner-admin")).toBeInTheDocument();
  });

  it("omits authorized units for non unit-admin views even if present", () => {
    useAuthMock.mockReturnValue({ user: { role: "ADMIN", authorizedUnits: ["CS"] } });
    render(<QmRoleBanner />);
    expect(screen.queryByText(/Authorized units/)).toBeNull();
  });
});
