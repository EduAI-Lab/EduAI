import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useAiReviewHistory } from "@/hooks/use-ai-review-history";
import { getAiReviewHistoryStorageKey } from "@/services/aiReviewHistoryStorage";
import { getOCRHistoryStorageKey } from "@/types/ocr";

const { testUser, getCurrentUser } = vi.hoisted(() => ({
  testUser: {
    id: "instructor-a",
    email: "instructor-a@example.test",
    name: "Instructor A",
    role: "INSTRUCTOR",
  },
  getCurrentUser: vi.fn(),
}));

vi.mock("@/services/authService", () => ({
  authService: {
    getCurrentUser,
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("AuthContext logout failure", () => {
  beforeEach(() => {
    localStorage.clear();
    getCurrentUser.mockReset().mockResolvedValue(testUser);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable" }),
    );
  });

  it("surfaces an authentication dependency outage without treating it as logout", async () => {
    getCurrentUser.mockRejectedValueOnce(new Error("Core unavailable"));
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.authError).toBe("Authentication service unavailable");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears account browser data but keeps the session visible and propagates non-OK", async () => {
    const historyKey = getOCRHistoryStorageKey(testUser.id);
    const reviewHistoryKey = getAiReviewHistoryStorageKey(testUser.id);
    expect(historyKey).not.toBeNull();
    expect(reviewHistoryKey).not.toBeNull();
    localStorage.setItem(historyKey!, JSON.stringify([{ id: "private-ocr-history" }]));
    localStorage.setItem(reviewHistoryKey!, JSON.stringify([{ id: "private-ai-review-history" }]));
    const { result } = renderHook(
      () => ({ auth: useAuth(), reviewHistory: useAiReviewHistory() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.auth.user?.id).toBe(testUser.id));
    await waitFor(() =>
      expect(result.current.reviewHistory.items.map((item) => item.id)).toEqual([
        "private-ai-review-history",
      ]),
    );
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.auth.logout();
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("503");
    expect(result.current.auth.user?.id).toBe(testUser.id);
    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.reviewHistory.items).toEqual([]);
    expect(localStorage.getItem(historyKey!)).toBeNull();
    expect(localStorage.getItem(reviewHistoryKey!)).toBeNull();
  });

  it("propagates a network failure without presenting logout success", async () => {
    const networkError = new Error("logout network unavailable");
    vi.mocked(fetch).mockRejectedValueOnce(networkError);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.user?.id).toBe(testUser.id));
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.logout();
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBe(networkError);
    expect(result.current.user?.id).toBe(testUser.id);
    expect(result.current.isAuthenticated).toBe(true);
  });
});
