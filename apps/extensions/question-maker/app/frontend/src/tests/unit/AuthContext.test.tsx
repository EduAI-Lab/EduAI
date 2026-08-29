/**
 * Unit tests for `AuthContext` (#1546, explicit "Done when" surface): the
 * app-wide auth provider that loads the current user on mount and exposes
 * logout(). Covers the loading -> authenticated/anonymous transitions and the
 * useAuth() outside-provider guard.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import React from "react";

const getCurrentUser = vi.fn();

vi.mock("@/services/authService", () => ({
  authService: { getCurrentUser: (...args: unknown[]) => getCurrentUser(...args) },
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthProvider / useAuth", () => {
  it("starts in a loading, unauthenticated state", () => {
    getCurrentUser.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("resolves the current user and flips to authenticated", async () => {
    getCurrentUser.mockResolvedValue({ id: "1", email: "a@b.com", role: "instructor" });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({ id: "1", email: "a@b.com", role: "instructor" });
  });

  it("stays unauthenticated (without throwing) when getCurrentUser rejects (e.g. 401)", async () => {
    getCurrentUser.mockRejectedValue(new Error("401 unauthorized"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("throws when useAuth is called outside an AuthProvider", () => {
    const Consumer = () => {
      useAuth();
      return null;
    };
    // Suppress React's expected error boundary console noise for this case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow("useAuth must be used within an AuthProvider");
    spy.mockRestore();
  });

  it("logout() posts to the auth logout endpoint and redirects to Core login", async () => {
    getCurrentUser.mockResolvedValue({ id: "1", email: "a@b.com", role: "student" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const originalLocation = window.location;
    // @ts-expect-error -- jsdom location override for assertion
    delete window.location;
    // @ts-expect-error -- minimal stub, only `.href` is used by logout()
    window.location = { href: "" };

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.logout();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/logout"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(window.location.href).toContain("/login");

    window.location = originalLocation;
    vi.unstubAllGlobals();
  });

  it("logout() propagates error and does not redirect when the fetch call fails", async () => {
    getCurrentUser.mockResolvedValue({ id: "1", email: "a@b.com", role: "student" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const originalLocation = window.location;
    // @ts-expect-error -- jsdom location override for assertion
    delete window.location;
    // @ts-expect-error -- minimal stub, only `.href` is used by logout()
    window.location = { href: "" };

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let error: Error | undefined;
    await act(async () => {
      try {
        await result.current.logout();
      } catch (err: any) {
        error = err;
      }
    });

    expect(error?.message).toBe("network down");
    expect(window.location.href).toBe("");

    window.location = originalLocation;
    vi.unstubAllGlobals();
  });
});
