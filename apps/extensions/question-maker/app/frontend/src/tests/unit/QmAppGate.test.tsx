/**
 * Unit tests for `QmAppGate` (#1546): loading/redirect/access-denied/children
 * branches. The authError outage branch is covered separately in
 * `QmAppGateAuthOutage.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const useAuthMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/components/layout/QmAppLayout", () => ({
  QmAccessShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { QmAppGate } from "@/components/auth/QmAppGate";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // @ts-expect-error -- restore between tests
  delete window.location;
  // @ts-expect-error -- minimal stub
  window.location = { href: "https://qm.example.com/dashboard" };
});

describe("QmAppGate", () => {
  it("shows a loader while auth is resolving", () => {
    useAuthMock.mockReturnValue({
      user: null,
      isLoading: true,
      authError: null,
    });
    render(
      <QmAppGate>
        <p>private content</p>
      </QmAppGate>,
    );
    expect(screen.queryByText("private content")).not.toBeInTheDocument();
  });

  it("redirects to Core login when loading finishes with no user and no error", async () => {
    useAuthMock.mockReturnValue({
      user: null,
      isLoading: false,
      authError: null,
    });
    render(
      <QmAppGate>
        <p>private content</p>
      </QmAppGate>,
    );
    await waitFor(() => expect(window.location.href).toContain("/login"));
    expect(screen.queryByText("private content")).not.toBeInTheDocument();
  });

  it("shows access denied for a role that cannot use QM", () => {
    useAuthMock.mockReturnValue({
      user: { id: "u1", role: "GUEST" },
      isLoading: false,
      authError: null,
    });
    render(
      <QmAppGate>
        <p>private content</p>
      </QmAppGate>,
    );
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.queryByText("private content")).not.toBeInTheDocument();
  });

  it.each(["INSTRUCTOR", "STUDENT"])("renders children for an authorized %s role", (role) => {
    useAuthMock.mockReturnValue({
      user: { id: "u1", role },
      isLoading: false,
      authError: null,
    });
    render(
      <QmAppGate>
        <p>private content</p>
      </QmAppGate>,
    );
    expect(screen.getByText("private content")).toBeInTheDocument();
  });
});
