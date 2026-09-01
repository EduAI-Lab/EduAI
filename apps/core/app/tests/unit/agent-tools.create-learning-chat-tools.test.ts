// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const { webSearchMock, fetchPageMock } = vi.hoisted(() => ({
  webSearchMock: { description: "web search", execute: vi.fn() },
  fetchPageMock: { description: "fetch page", execute: vi.fn() },
}));

// getInformation's retrieval body (find -> cap -> fail-closed on throw) moved
// to the shared runCourseMaterialSearchTool (#1658 review — it was duplicated
// near-verbatim in this file, ai/chat-tools.ts, and admin chat's
// searchCourseMaterials); that logic's own tests now live in
// chat-rag.search-tool.test.ts. This file only needs to verify
// createLearningChatTools calls it with the right arguments and passes its
// result straight through.
vi.mock("~/lib/chat-rag", () => ({
  runCourseMaterialSearchTool: vi.fn(),
}));

vi.mock("~/lib/ai/tools", () => ({
  webSearch: webSearchMock,
  fetchPage: fetchPageMock,
}));

import { runCourseMaterialSearchTool } from "~/lib/chat-rag";
import { createLearningChatTools } from "~/lib/agent-tools/create-learning-chat-tools";
import type { ChatToolContext } from "~/lib/agent-tools/chat-mode";

const baseCtx: ChatToolContext = {
  user: { id: "u1", role: "STUDENT" },
  effectiveCourseId: "c1",
  restrictToStudentVisible: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createLearningChatTools", () => {
  it("passes through the shared webSearch and fetchPage tools unchanged", () => {
    const tools = createLearningChatTools(baseCtx);
    expect(tools.webSearch).toBe(webSearchMock);
    expect(tools.fetchPage).toBe(fetchPageMock);
  });

  it("invokes the shared webSearch tool's execute", async () => {
    vi.mocked(webSearchMock.execute).mockResolvedValue([{ url: "https://a.com" }]);
    const tools = createLearningChatTools(baseCtx);
    const result = await tools.webSearch.execute({ query: "loops", limit: 3 }, {} as never);
    expect(result).toEqual([{ url: "https://a.com" }]);
    expect(webSearchMock.execute).toHaveBeenCalledWith({ query: "loops", limit: 3 }, {} as never);
  });

  it("invokes the shared fetchPage tool's execute", async () => {
    vi.mocked(fetchPageMock.execute).mockResolvedValue({
      url: "https://a.com",
      title: "A",
      markdown: "hi",
    });
    const tools = createLearningChatTools(baseCtx);
    const result = await tools.fetchPage.execute(
      { url: "https://a.com", timeoutMs: 10000 },
      {} as never,
    );
    expect(result).toEqual({ url: "https://a.com", title: "A", markdown: "hi" });
  });

  describe("getInformation", () => {
    it("returns an error when no course is selected, without calling the search tool", async () => {
      const tools = createLearningChatTools({ ...baseCtx, effectiveCourseId: null });
      const result = await tools.getInformation.execute(
        { question: "what is a loop?" },
        {} as never,
      );
      expect(result).toEqual({ error: "No course selected for RAG search" });
      expect(runCourseMaterialSearchTool).not.toHaveBeenCalled();
    });

    it("delegates to the shared search tool with the course and visibility restriction", async () => {
      const hits = [
        { content: "loops are...", similarity: 0.9, materialTitle: "Ch1" },
        { content: "for-loops are...", similarity: 0.8, materialTitle: "Ch2" },
      ];
      vi.mocked(runCourseMaterialSearchTool).mockResolvedValue({ relevantContent: hits, count: 2 });

      const tools = createLearningChatTools(baseCtx);
      const result = await tools.getInformation.execute(
        { question: "what is a loop?" },
        {} as never,
      );

      expect(runCourseMaterialSearchTool).toHaveBeenCalledWith("what is a loop?", "c1", true);
      expect(result).toEqual({ relevantContent: hits, count: 2 });
    });

    it("passes an unset restrictToStudentVisible through as-is — the shared search tool defaults it to false", async () => {
      vi.mocked(runCourseMaterialSearchTool).mockResolvedValue({ relevantContent: [], count: 0 });

      const tools = createLearningChatTools({
        user: { id: "u1", role: "INSTRUCTOR" },
        effectiveCourseId: "c1",
      });
      await tools.getInformation.execute({ question: "what is a loop?" }, {} as never);

      expect(runCourseMaterialSearchTool).toHaveBeenCalledWith("what is a loop?", "c1", undefined);
    });

    it("passes the search tool's error result straight through", async () => {
      vi.mocked(runCourseMaterialSearchTool).mockResolvedValue({
        error: "Failed to search course materials",
      });

      const tools = createLearningChatTools(baseCtx);
      const result = await tools.getInformation.execute(
        { question: "what is a loop?" },
        {} as never,
      );

      expect(result).toEqual({ error: "Failed to search course materials" });
    });
  });
});
