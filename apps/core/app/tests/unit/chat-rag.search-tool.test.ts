// @vitest-environment node
//
// #1658 review: runCourseMaterialSearchTool is the shared retrieval body
// (find -> cap -> fail-closed on throw) three RAG-search tools previously
// duplicated near-verbatim — learning chat's getInformation
// (create-learning-chat-tools.ts, ai/chat-tools.ts) and admin chat's
// searchCourseMaterials (#1658). Those call sites now only test that they
// delegate to this function with the right arguments; the actual retrieval
// behavior is covered once, here.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/ai/embedding", () => ({
  findRelevantContent: vi.fn(),
}));

import { findRelevantContent } from "~/lib/ai/embedding";
import { runCourseMaterialSearchTool, HYBRID_RAG_MAX_CHUNKS } from "~/lib/chat-rag";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runCourseMaterialSearchTool", () => {
  it("retrieves, caps, and counts hits on success", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([
      { content: "Loops repeat a block of code.", similarity: 0.9, materialTitle: "Ch1" },
    ]);

    const result = await runCourseMaterialSearchTool("what is a loop?", "course-1", false);

    expect(findRelevantContent).toHaveBeenCalledWith(
      "what is a loop?",
      "course-1",
      HYBRID_RAG_MAX_CHUNKS,
      undefined,
      false,
    );
    expect(result).toMatchObject({ count: 1 });
    if ("relevantContent" in result) {
      // capRagHitsForTool wraps content in the untrusted-material fence
      // (#86) — assert the substance survived, not the exact wrapper text.
      expect(result.relevantContent[0]?.content).toContain("Loops repeat a block of code.");
    } else {
      expect.unreachable("expected a success result");
    }
  });

  it("passes restrictToStudentVisible through unchanged", async () => {
    vi.mocked(findRelevantContent).mockResolvedValue([]);

    await runCourseMaterialSearchTool("q", "course-1", true);

    expect(findRelevantContent).toHaveBeenCalledWith(
      "q",
      "course-1",
      HYBRID_RAG_MAX_CHUNKS,
      undefined,
      true,
    );
  });

  it("fails closed with a typed error, not a thrown exception, when retrieval throws", async () => {
    vi.mocked(findRelevantContent).mockRejectedValue(new Error("embedding provider down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runCourseMaterialSearchTool("q", "course-1", false);

    expect(result).toEqual({ error: "Failed to search course materials" });
    consoleSpy.mockRestore();
  });
});
