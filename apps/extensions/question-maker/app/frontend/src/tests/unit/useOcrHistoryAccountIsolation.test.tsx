import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOCRHistory } from "@/hooks/use-ocr-history";

let currentUser: { id: string } | null = { id: "instructor-a" };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: currentUser }),
}));

describe("useOCRHistory account isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    currentUser = { id: "instructor-a" };
  });

  it("does not show user A question history after user B signs in", async () => {
    const renderedScopes: Array<{ userId: string | null; jobIds: string[] }> = [];
    const { result, rerender } = renderHook(() => {
      const history = useOCRHistory();
      renderedScopes.push({
        userId: currentUser?.id ?? null,
        jobIds: history.jobs.map((job) => job.id),
      });
      return history;
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.addJob({
        fileName: "student-exam.pdf",
        courseId: 7,
        courseName: "Private course",
        model: "google:gemini-2.5-flash",
        status: "success",
        storedQuestions: [
          {
            id: "q1",
            text: "A confidential draft question",
            type: "short_answer",
            answer: "Private answer",
          },
        ],
      });
    });
    expect(result.current.jobs).toHaveLength(1);

    currentUser = { id: "instructor-b" };
    rerender();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.jobs).toEqual([]);
    expect(renderedScopes).not.toContainEqual({
      userId: "instructor-b",
      jobIds: [expect.any(String)],
    });
    expect(localStorage.getItem("ocr-upload-history")).toBeNull();
  });
});
