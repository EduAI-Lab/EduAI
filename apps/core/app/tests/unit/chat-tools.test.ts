// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// getInformation's retrieval body (find -> cap -> fail-closed on throw) lives
// in the shared runCourseMaterialSearchTool (#1658 review — it was
// duplicated near-verbatim across this file, create-learning-chat-tools.ts,
// and admin chat's searchCourseMaterials); that logic's own tests live in
// chat-rag.search-tool.test.ts. This file only needs to verify
// buildChatToolRegistry calls it with the right arguments and passes its
// result straight through — mirroring
// agent-tools.create-learning-chat-tools.test.ts's getInformation coverage,
// which the patch-coverage bot flagged this file as missing (#1665 review).
vi.mock("~/lib/chat-rag", () => ({
  runCourseMaterialSearchTool: vi.fn(),
}));

import { runCourseMaterialSearchTool } from "~/lib/chat-rag";
import { buildChatToolRegistry, getChatToolNames } from "~/lib/ai/chat-tools";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildChatToolRegistry", () => {
  it("registers only getInformation when web tools are OFF", () => {
    const registry = buildChatToolRegistry({
      effectiveCourseId: "course-1",
      webToolsEnabled: false,
    });
    expect(getChatToolNames(registry)).toEqual(["getInformation"]);
  });

  it("adds web tools when web tools are ON", () => {
    const registry = buildChatToolRegistry({
      effectiveCourseId: "course-1",
      webToolsEnabled: true,
    });
    expect(getChatToolNames(registry)).toEqual(["fetchPage", "getInformation", "webSearch"]);
  });

  describe("getInformation", () => {
    it("returns an error when no course is selected, without calling the search tool", async () => {
      const registry = buildChatToolRegistry({
        effectiveCourseId: null,
        webToolsEnabled: false,
      });
      const result = await registry.getInformation.execute(
        { question: "what is a loop?" },
        {} as never,
      );
      expect(result).toEqual({ error: "No course selected for RAG search" });
      expect(runCourseMaterialSearchTool).not.toHaveBeenCalled();
    });

    it("delegates to the shared search tool with the course and visibility restriction", async () => {
      const hits = [{ content: "loops are...", similarity: 0.9, materialTitle: "Ch1" }];
      vi.mocked(runCourseMaterialSearchTool).mockResolvedValue({ relevantContent: hits, count: 1 });

      const registry = buildChatToolRegistry({
        effectiveCourseId: "course-1",
        webToolsEnabled: false,
        restrictToStudentVisible: true,
      });
      const result = await registry.getInformation.execute(
        { question: "what is a loop?" },
        {} as never,
      );

      expect(runCourseMaterialSearchTool).toHaveBeenCalledWith("what is a loop?", "course-1", true);
      expect(result).toEqual({ relevantContent: hits, count: 1 });
    });

    it("passes an unset restrictToStudentVisible through as-is — the shared search tool defaults it to false", async () => {
      vi.mocked(runCourseMaterialSearchTool).mockResolvedValue({ relevantContent: [], count: 0 });

      const registry = buildChatToolRegistry({
        effectiveCourseId: "course-1",
        webToolsEnabled: false,
      });
      await registry.getInformation.execute({ question: "what is a loop?" }, {} as never);

      expect(runCourseMaterialSearchTool).toHaveBeenCalledWith(
        "what is a loop?",
        "course-1",
        undefined,
      );
    });

    it("passes the search tool's error result straight through", async () => {
      vi.mocked(runCourseMaterialSearchTool).mockResolvedValue({
        error: "Failed to search course materials",
      });

      const registry = buildChatToolRegistry({
        effectiveCourseId: "course-1",
        webToolsEnabled: false,
      });
      const result = await registry.getInformation.execute(
        { question: "what is a loop?" },
        {} as never,
      );

      expect(result).toEqual({ error: "Failed to search course materials" });
    });
  });
});
