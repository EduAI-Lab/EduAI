import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiReviewHistory, type AiReviewHistoryItem } from "@/hooks/use-ai-review-history";

let currentUser: { id: string } | null = { id: "instructor-a" };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: currentUser }),
}));

const reviewItem: AiReviewHistoryItem = {
  id: "review-a",
  createdAt: "2026-08-10T08:00:00.000Z",
  courseId: 7,
  baselineAssessmentId: 10,
  baselineName: "Private midterm",
  variantAssessmentId: 11,
  variantName: "Private midterm variant",
  model: "google:gemini-2.5-flash",
  result: {
    overallSummary: {
      summaryText: "Confidential review details",
      strengths: [],
      weaknesses: [],
    },
  } as AiReviewHistoryItem["result"],
};

describe("useAiReviewHistory account isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    currentUser = { id: "instructor-a" };
  });

  it("never renders or saves user A review history in user B scope", async () => {
    localStorage.setItem(
      "assessmentVariant.aiReview.history.v1",
      JSON.stringify([{ ...reviewItem, id: "owner-unknown" }]),
    );
    const renderedScopes: Array<{ userId: string | null; itemIds: string[] }> = [];
    const { result, rerender } = renderHook(() => {
      const history = useAiReviewHistory();
      renderedScopes.push({
        userId: currentUser?.id ?? null,
        itemIds: history.items.map((item) => item.id),
      });
      return history;
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.items).toEqual([]);
    expect(localStorage.getItem("assessmentVariant.aiReview.history.v1")).toBeNull();

    act(() => {
      result.current.setItems([reviewItem]);
    });
    expect(result.current.items.map((item) => item.id)).toEqual(["review-a"]);

    currentUser = { id: "instructor-b" };
    rerender();

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.items).toEqual([]);
    expect(renderedScopes).not.toContainEqual({
      userId: "instructor-b",
      itemIds: ["review-a"],
    });
  });
});
